#!/usr/bin/env node
'use strict'

/*
 * Builds search records from a built site and writes them as NDJSON
 * (one JSON record per line).
 *
 *   node scripts/search-index.js --dir public --out search-records.ndjson
 *
 * Options:
 *   --dir <path>       Built site root (Antora's output dir). Default: public
 *   --site-url <url>   Public URL the site is served from.
 *                      Default: https://docs.couchbase.com
 *   --out <path>       NDJSON file to write. Default: search-records.ndjson
 *   --include <glob>   Only index paths matching this glob, relative to --dir.
 *                      Repeatable. Default: everything.
 *   --exclude <glob>   Skip paths matching this glob. Repeatable.
 *                      Default: tutorials/** (the crawler skips it too).
 *   --compare          After writing, compare the records against the live
 *                      Algolia index for the same pages. Reads the app ID,
 *                      search key and index name from ALGOLIA_APP_ID,
 *                      ALGOLIA_API_KEY_SEARCH and ALGOLIA_IDX_NAME.
 *
 * Nothing here talks to a search engine except --compare, which only reads.
 */

const fs = require('fs')
const path = require('path')
const cheerio = require('cheerio')
const picomatch = require('picomatch')
const { extractRecords, isIndexable } = require('../lib/search-records')

function parseArgs (argv) {
  const opts = {
    dir: 'public',
    siteUrl: 'https://docs.couchbase.com',
    out: 'search-records.ndjson',
    include: [],
    exclude: [],
    compare: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`)
      return argv[++i]
    }
    if (arg === '--dir') opts.dir = next()
    else if (arg === '--site-url') opts.siteUrl = next()
    else if (arg === '--out') opts.out = next()
    else if (arg === '--include') opts.include.push(next())
    else if (arg === '--exclude') opts.exclude.push(next())
    else if (arg === '--compare') opts.compare = true
    else throw new Error(`Unknown option: ${arg}`)
  }
  if (!opts.exclude.length) opts.exclude = ['tutorials/**']
  opts.siteUrl = opts.siteUrl.replace(/\/$/, '')
  return opts
}

function * walkHtml (root, rel = '') {
  const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) yield * walkHtml(root, relPath)
    else if (entry.name.endsWith('.html')) yield relPath
  }
}

function buildRecords (opts) {
  const included = opts.include.length ? picomatch(opts.include) : () => true
  const excluded = picomatch(opts.exclude)
  const out = fs.openSync(opts.out, 'w')
  const stats = { pages: 0, skipped: 0, empty: 0, records: 0, largest: 0, largestId: '' }
  const pageRecords = new Map()

  try {
    for (const relPath of walkHtml(opts.dir)) {
      if (!included(relPath) || excluded(relPath)) continue
      const $ = cheerio.load(fs.readFileSync(path.join(opts.dir, relPath), 'utf8'))
      if (!isIndexable($)) {
        stats.skipped++
        continue
      }
      const url = `${opts.siteUrl}/${relPath}`
      const records = extractRecords({ url, $ })
      stats.pages++
      if (!records.length) stats.empty++
      pageRecords.set(url, records)
      for (const record of records) {
        const line = JSON.stringify(record)
        const size = Buffer.byteLength(line)
        if (size > stats.largest) {
          stats.largest = size
          stats.largestId = record.objectID
        }
        fs.writeSync(out, line + '\n')
        stats.records++
      }
    }
  } finally {
    fs.closeSync(out)
  }
  return { stats, pageRecords }
}

// The public search key can only filter on facet attributes, and the index
// returns at most LIVE_LIMIT hits per query. So fetch the live records one
// component version at a time and group them by page afterwards.
const LIVE_LIMIT = 1000

async function fetchLiveRecords ({ appId, apiKey, indexName }, componentVersion) {
  const res = await fetch(`https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query`, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': appId,
      'X-Algolia-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: '',
      distinct: false,
      hitsPerPage: LIVE_LIMIT,
      facetFilters: [`component_version:${componentVersion}`],
      attributesToRetrieve: ['*'],
      attributesToHighlight: [],
      attributesToSnippet: [],
    }),
  })
  if (!res.ok) throw new Error(`Algolia ${res.status} for ${componentVersion}: ${await res.text()}`)
  const { hits, nbHits } = await res.json()
  return { hits, complete: nbHits <= hits.length, total: nbHits }
}

const sameRecord = (a, b) =>
  a.content === b.content && a.type === b.type &&
  JSON.stringify(a.hierarchy) === JSON.stringify(b.hierarchy)

async function compare (pageRecords) {
  const algolia = {
    appId: process.env.ALGOLIA_APP_ID,
    apiKey: process.env.ALGOLIA_API_KEY_SEARCH,
    indexName: process.env.ALGOLIA_IDX_NAME,
  }
  if (!algolia.appId || !algolia.apiKey || !algolia.indexName) {
    throw new Error('--compare needs ALGOLIA_APP_ID, ALGOLIA_API_KEY_SEARCH and ALGOLIA_IDX_NAME')
  }

  // group local pages by component version
  const byVersion = new Map()
  for (const [url, records] of pageRecords) {
    if (!records.length) continue
    const key = records[0].component_version
    if (!byVersion.has(key)) byVersion.set(key, new Map())
    byVersion.get(key).set(url, records)
  }

  const totals = { pages: 0, identical: 0, local: 0, live: 0, matched: 0 }
  const differing = []
  const partial = []

  for (const [componentVersion, pages] of byVersion) {
    const { hits, complete, total } = await fetchLiveRecords(algolia, componentVersion)
    if (!complete) {
      // can't tell a missing record from one beyond the limit, so don't judge
      partial.push(`${componentVersion} (${total} live records)`)
      continue
    }
    const liveByUrl = new Map()
    for (const hit of hits) {
      if (!liveByUrl.has(hit.url_without_anchor)) liveByUrl.set(hit.url_without_anchor, new Map())
      liveByUrl.get(hit.url_without_anchor).set(hit.objectID, hit)
    }
    for (const [url, records] of pages) {
      const live = liveByUrl.get(url) || new Map()
      const matched = records.filter((r) => live.has(r.objectID) && sameRecord(r, live.get(r.objectID))).length
      totals.pages++
      totals.local += records.length
      totals.live += live.size
      totals.matched += matched
      if (matched === records.length && records.length === live.size) totals.identical++
      else differing.push({ url, local: records.length, live: live.size, matched })
    }
  }

  console.log()
  console.log('Compared with the live index')
  console.log(`  pages compared:     ${totals.pages}`)
  console.log(`  identical pages:    ${totals.identical}`)
  console.log(`  records here/live:  ${totals.local} / ${totals.live}`)
  console.log(`  records matching:   ${totals.matched}`)
  if (partial.length) {
    console.log()
    console.log(`  Not compared, more than ${LIVE_LIMIT} live records (needs a key that can browse the index):`)
    for (const p of partial) console.log(`    ${p}`)
  }
  if (differing.length) {
    console.log()
    console.log('  Pages that differ (here / live / matching):')
    for (const d of differing.slice(0, 25)) {
      console.log(`    ${d.local} / ${d.live} / ${d.matched}  ${d.url}`)
    }
    if (differing.length > 25) console.log(`    ... and ${differing.length - 25} more`)
  }
}

async function main () {
  const opts = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(opts.dir)) throw new Error(`No such directory: ${opts.dir}`)

  const { stats, pageRecords } = buildRecords(opts)
  console.log(`Wrote ${opts.out}`)
  console.log(`  pages indexed:      ${stats.pages}`)
  console.log(`  pages skipped:      ${stats.skipped} (redirects or noindex)`)
  console.log(`  pages with no records: ${stats.empty}`)
  console.log(`  records:            ${stats.records}`)
  console.log(`  largest record:     ${stats.largest} bytes (${stats.largestId})`)

  if (opts.compare) await compare(pageRecords)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
