#!/usr/bin/env node
'use strict'

/*
 * Loads search records into Typesense, and compares its results with Algolia.
 *
 *   node scripts/search-typesense.js load search-records.ndjson
 *   node scripts/search-typesense.js compare test/fixtures/search-queries.txt
 *
 * Typesense connection (defaults suit a local container):
 *   TYPESENSE_URL       default http://localhost:8108
 *   TYPESENSE_API_KEY   default local-poc-key
 *
 * To start a local Typesense:
 *   docker run -d --name typesense-poc -p 8108:8108 -v typesense-poc-data:/data \
 *     typesense/typesense:30.2 --data-dir /data --api-key=local-poc-key --enable-cors
 *
 * load
 *   Builds a new collection, imports the records, then repoints the
 *   "docs-search" alias at it and drops the previous collection. Searches keep
 *   hitting the old collection until the new one is complete.
 *
 * compare
 *   Runs each query in the file (one per line, # for comments) against both
 *   engines and reports how far the top results agree. Algolia is limited to
 *   the components that are loaded in Typesense, so a partial load is still a
 *   fair comparison. Reads ALGOLIA_APP_ID, ALGOLIA_API_KEY_SEARCH and
 *   ALGOLIA_IDX_NAME. Add --verbose to list both result sets for each query,
 *   or --summary to print only the totals.
 */

const fs = require('fs')
const readline = require('readline')
const config = require('../lib/search-typesense-config')

const TYPESENSE_URL = (process.env.TYPESENSE_URL || 'http://localhost:8108').replace(/\/$/, '')
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY || 'local-poc-key'
const IMPORT_BATCH = 2000

// For tuning: a JSON object of search parameters that override the ones in
// lib/search-typesense-config.js for this run, e.g.
//   TYPESENSE_SEARCH_PARAMS='{"sort_by":"_text_match:desc"}'
const PARAM_OVERRIDES = process.env.TYPESENSE_SEARCH_PARAMS ? JSON.parse(process.env.TYPESENSE_SEARCH_PARAMS) : {}

async function typesense (method, path, body, { raw = false, allow404 = false } = {}) {
  const res = await fetch(`${TYPESENSE_URL}${path}`, {
    method,
    headers: {
      'X-TYPESENSE-API-KEY': TYPESENSE_API_KEY,
      ...(body !== undefined && { 'Content-Type': raw ? 'text/plain' : 'application/json' }),
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  if (res.status === 404 && allow404) return null
  const text = await res.text()
  if (!res.ok) throw new Error(`Typesense ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`)
  return raw ? text : JSON.parse(text)
}

async function importBatch (collection, docs) {
  const body = docs.map((d) => JSON.stringify(d)).join('\n')
  const out = await typesense('POST', `/collections/${collection}/documents/import?action=upsert`, body, { raw: true })
  const failures = out.split('\n').filter((line) => line && !line.startsWith('{"success":true'))
  if (failures.length) {
    throw new Error(`${failures.length} of ${docs.length} records were rejected, first: ${failures[0].slice(0, 400)}`)
  }
}

async function load (file) {
  if (!file) throw new Error('load needs the NDJSON file to import')

  await typesense('PUT', `/synonym_sets/${config.SYNONYM_SET}`, {
    items: config.SYNONYMS.map((synonyms, i) => ({ id: `synonym-${i}`, synonyms })),
  })
  await typesense('PUT', `/stopwords/${config.STOPWORD_SET}`, { stopwords: config.STOPWORDS, locale: 'en' })

  const collection = `${config.ALIAS}-${Date.now()}`
  await typesense('POST', '/collections', config.collectionSchema(collection))

  let count = 0
  let batch = []
  try {
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line.trim()) continue
      batch.push(config.toDocument(JSON.parse(line)))
      if (batch.length >= IMPORT_BATCH) {
        await importBatch(collection, batch)
        count += batch.length
        batch = []
      }
    }
    if (batch.length) {
      await importBatch(collection, batch)
      count += batch.length
    }
    if (!count) throw new Error(`${file} has no records`)
  } catch (err) {
    // leave the live alias alone and don't keep a half-built collection around
    await typesense('DELETE', `/collections/${collection}`)
    throw err
  }

  const previous = await typesense('GET', `/aliases/${config.ALIAS}`, undefined, { allow404: true })
  await typesense('PUT', `/aliases/${config.ALIAS}`, { collection_name: collection })
  if (previous && previous.collection_name !== collection) {
    await typesense('DELETE', `/collections/${previous.collection_name}`, undefined, { allow404: true })
  }

  console.log(`Loaded ${count} records into ${collection}`)
  console.log(`Alias ${config.ALIAS} now points at it${previous ? `; dropped ${previous.collection_name}` : ''}`)
}

async function searchTypesense (q, components) {
  const params = new URLSearchParams({
    ...config.SEARCH_PARAMS,
    ...PARAM_OVERRIDES,
    q,
    per_page: 10,
    filter_by: `component:=[${components.map((c) => '`' + c + '`').join(',')}]`,
    include_fields: 'url_without_anchor',
  })
  const res = await typesense('GET', `/collections/${config.ALIAS}/documents/search?${params}`)
  return (res.grouped_hits || []).map((g) => g.hits[0].document.url_without_anchor)
}

async function searchAlgolia (algolia, q, components) {
  const url = `https://${algolia.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(algolia.indexName)}/query`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': algolia.appId,
      'X-Algolia-API-Key': algolia.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: q,
      hitsPerPage: 10,
      facetFilters: [components.map((c) => `component:${c}`)],
      attributesToRetrieve: ['url_without_anchor'],
      attributesToHighlight: [],
      attributesToSnippet: [],
      analytics: false,
    }),
  })
  if (!res.ok) throw new Error(`Algolia ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).hits.map((h) => h.url_without_anchor)
}

const overlap = (a, b, n) => {
  const want = a.slice(0, n)
  if (!want.length) return b.length ? 0 : 1
  const got = new Set(b.slice(0, n))
  return want.filter((u) => got.has(u)).length / want.length
}

const pct = (x) => `${Math.round(x * 100)}%`.padStart(4)
const short = (u) => u.replace(/^https?:\/\/[^/]+\//, '')

async function compare (file, verbose, summary) {
  if (!file) throw new Error('compare needs a file of queries, one per line')
  const algolia = {
    appId: process.env.ALGOLIA_APP_ID,
    apiKey: process.env.ALGOLIA_API_KEY_SEARCH,
    indexName: process.env.ALGOLIA_IDX_NAME,
  }
  if (!algolia.appId || !algolia.apiKey || !algolia.indexName) {
    throw new Error('compare needs ALGOLIA_APP_ID, ALGOLIA_API_KEY_SEARCH and ALGOLIA_IDX_NAME')
  }

  const queries = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))

  // compare like with like: only the components that are actually loaded
  const facets = await typesense('GET', `/collections/${config.ALIAS}/documents/search?q=*&facet_by=component&max_facet_values=500&per_page=0`)
  const components = facets.facet_counts[0].counts.map((c) => c.value)
  console.log(`Components loaded: ${components.join(', ')}\n`)
  console.log('top1  top5 top10  query')

  const totals = { top1: 0, top5: 0, top10: 0, empty: 0 }
  for (const q of queries) {
    const [a, t] = await Promise.all([searchAlgolia(algolia, q, components), searchTypesense(q, components)])
    const top1 = a.length && t.length && a[0] === t[0] ? 1 : (!a.length && !t.length ? 1 : 0)
    const top5 = overlap(a, t, 5)
    const top10 = overlap(a, t, 10)
    totals.top1 += top1
    totals.top5 += top5
    totals.top10 += top10
    if (a.length && !t.length) totals.empty++
    if (!summary) console.log(`${top1 ? ' yes' : '  no'}  ${pct(top5)}  ${pct(top10)}  ${q}`)
    if (verbose) {
      for (let i = 0; i < Math.max(a.length, t.length, 0) && i < 5; i++) {
        console.log(`        A ${short(a[i] || '-')}`)
        console.log(`        T ${short(t[i] || '-')}`)
      }
    }
  }

  const n = queries.length
  console.log(`\n${n} queries`)
  console.log(`  same first result:        ${pct(totals.top1 / n)}`)
  console.log(`  Algolia top 5 also in ours:  ${pct(totals.top5 / n)}`)
  console.log(`  Algolia top 10 also in ours: ${pct(totals.top10 / n)}`)
  console.log(`  queries Algolia answers and we don't: ${totals.empty}`)
}

async function main () {
  const [command, ...rest] = process.argv.slice(2)
  const verbose = rest.includes('--verbose')
  const file = rest.find((a) => !a.startsWith('--'))
  if (command === 'load') await load(file)
  else if (command === 'compare') await compare(file, verbose, rest.includes('--summary'))
  else throw new Error('Usage: search-typesense.js load <records.ndjson> | compare <queries.txt> [--verbose]')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
