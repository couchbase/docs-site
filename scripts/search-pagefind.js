#!/usr/bin/env node
'use strict'

/**
 * Search POC: builds a Pagefind index from the search records (the NDJSON
 * written by scripts/search-index.js), so no page markup or site build is
 * needed.
 *
 * Pagefind normally reads built HTML. Here each page is rebuilt from its
 * records as a minimal HTML document: the page title, then each section's
 * heading (with the anchor the record points at) followed by its text. That
 * keeps Pagefind's per-heading sub-results, which give section-level hits
 * like Algolia's. Page-level fields the search UI shows (product, version,
 * breadcrumbs and so on) are attached as Pagefind metadata, and the fields
 * it filters on as Pagefind filters.
 *
 * Usage:
 *   node scripts/search-pagefind.js search-records.ndjson --out pagefind
 *   node scripts/search-pagefind.js compare test/fixtures/search-queries.txt --dir pagefind
 *
 * compare runs the same comparison with Algolia as search-typesense.js
 * compare (same queries, same scoring, same ALGOLIA_* settings), searching
 * the index in --dir the way the docs-ui client does: current versions first,
 * then everything else.
 */

const fs = require('node:fs')
const readline = require('node:readline')

const LEVELS = ['lvl2', 'lvl3', 'lvl4', 'lvl5', 'lvl6']

// Copied onto every page as Pagefind metadata (strings only)
const META_FIELDS = [
  'url_without_anchor', 'component', 'component_title', 'cversion', 'component_version',
  'module', 'nav_group', 'breadcrumbs', 'description', 'keywords', 'version_rank', 'title',
]
// Filterable in the search UI
const FILTER_FIELDS = ['component_version', 'version_rank']

function parseArgs (argv) {
  const args = { input: undefined, out: 'pagefind' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i]
    else args.input = argv[i]
  }
  if (!args.input) throw new Error('usage: search-pagefind.js <records.ndjson> [--out dir]')
  return args
}

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Records arrive grouped by page, in page order (search-index.js writes them
// that way), so pages can be streamed without holding every record.
async function * pagesOf (file) {
  const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  let page
  for await (const line of lines) {
    if (!line.trim()) continue
    const record = JSON.parse(line)
    if (page && page.url !== record.url_without_anchor) {
      yield page
      page = undefined
    }
    if (!page) page = { url: record.url_without_anchor, records: [] }
    page.records.push(record)
  }
  if (page) yield page
}

function pageHtml ({ records }) {
  const first = records[0]
  const head = []
  const meta = (key, value) => {
    if (value === undefined || value === null || value === '') return
    head.push(`<meta data-pagefind-meta="${key}[content]" content="${escapeHtml(value)}">`)
  }
  const filter = (key, value) => {
    if (value === undefined || value === null) return
    head.push(`<meta data-pagefind-filter="${key}[content]" content="${escapeHtml(value)}">`)
  }
  META_FIELDS.forEach((field) => meta(field, first[field]))
  meta('lvl0', first.hierarchy?.lvl0)
  FILTER_FIELDS.forEach((field) => filter(field, first[field]))

  // anchor -> the headings above it, which the search UI shows as the
  // result's in-page breadcrumb. Pagefind's sub-results only give the
  // nearest heading.
  const sections = {}
  const body = [`<h1>${escapeHtml(first.hierarchy?.lvl1 || first.title || '')}</h1>`]
  if (first.keywords) body.push(`<p data-pagefind-weight="9">${escapeHtml(first.keywords)}</p>`)

  let currentAnchor
  for (const record of records) {
    const levels = LEVELS.filter((lvl) => record.hierarchy?.[lvl])
    if (record.anchor && record.anchor !== currentAnchor && levels.length) {
      currentAnchor = record.anchor
      const deepest = levels[levels.length - 1]
      const tag = `h${LEVELS.indexOf(deepest) + 2}`
      sections[record.anchor] = levels.map((lvl) => record.hierarchy[lvl])
      body.push(`<${tag} id="${escapeHtml(record.anchor)}">${escapeHtml(record.hierarchy[deepest])}</${tag}>`)
    }
    const text = record.content || ''
    if (record.is_listing) body.push(`<pre>${escapeHtml(text)}</pre>`)
    else text.split('\n').filter(Boolean).forEach((line) => body.push(`<p>${escapeHtml(line)}</p>`))
  }
  meta('sections', JSON.stringify(sections))

  return `<!doctype html><html lang="en"><head>${head.join('')}</head>` +
    `<body><main data-pagefind-body>${body.join('\n')}</main></body></html>`
}

async function main () {
  const args = parseArgs(process.argv.slice(2))
  const pagefind = await import('pagefind')
  const { errors: createErrors, index } = await pagefind.createIndex({ forceLanguage: 'en' })
  if (createErrors.length) throw new Error(createErrors.join('\n'))

  let pages = 0
  let failed = 0
  let batch = []
  const flush = async () => {
    const results = await Promise.all(batch)
    for (const { errors } of results) {
      if (errors.length) {
        failed++
        if (failed <= 10) console.error(errors.join('\n'))
      }
    }
    batch = []
  }
  for await (const page of pagesOf(args.input)) {
    batch.push(index.addHTMLFile({ url: page.url, content: pageHtml(page) }))
    pages++
    if (batch.length === 100) await flush()
    if (pages % 2000 === 0) console.log(`${pages} pages added`)
  }
  await flush()

  const { errors } = await index.writeFiles({ outputPath: args.out })
  if (errors.length) throw new Error(errors.join('\n'))
  await pagefind.close()

  console.log(`pages indexed: ${pages - failed} of ${pages}`)
  console.log(`index written to ${args.out}`)
  // As with the Typesense load, a partial index must not replace a good one
  if (failed > pages * 0.01) {
    console.error(`${failed} pages failed to index`)
    process.exit(1)
  }
}

// Pagefind's search runs in the browser; in Node it works the same once its
// files are served over HTTP, which is how it fetches them.
async function pagefindEngine (dir) {
  const http = require('node:http')
  const path = require('node:path')
  const { pathToFileURL } = require('node:url')
  const root = path.resolve(dir)
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]))
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end() }
    fs.readFile(file, (err, data) => {
      if (err) res.statusCode = 404
      res.end(err ? undefined : data)
    })
  }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.on('listening', resolve))
  const pagefind = await import(pathToFileURL(path.join(root, 'pagefind.js')).href)
  await pagefind.options({ basePath: `http://127.0.0.1:${server.address().port}/` })
  await pagefind.init()

  return {
    name: 'Pagefind',
    async components () {
      const { component_version: versions = {} } = await pagefind.filters()
      return [...new Set(Object.keys(versions).map((v) => v.split('@')[0]))]
    },
    // Every component is in the index, so there is nothing to restrict
    async search (q) {
      const [latest, all] = await Promise.all([
        pagefind.search(q, { filters: { version_rank: '1' } }),
        pagefind.search(q),
      ])
      const seen = new Set()
      const ordered = [...latest.results, ...all.results].filter((r) => !seen.has(r.id) && seen.add(r.id))
      const pages = await Promise.all(ordered.slice(0, 10).map((r) => r.data()))
      return pages.map((page) => page.meta.url_without_anchor || page.url)
    },
    async close () {
      server.close()
    },
  }
}

async function compareCommand (argv) {
  const file = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--dir')
  const dir = argv[argv.indexOf('--dir') + 1] || 'pagefind'
  const engine = await pagefindEngine(dir)
  try {
    await require('./search-typesense').compare(file, argv.includes('--verbose'), argv.includes('--summary'), engine)
  } finally {
    await engine.close()
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2)
  const run = argv[0] === 'compare' ? compareCommand(argv.slice(1)) : main()
  run.catch((err) => {
    console.error(err.message || err)
    process.exit(1)
  })
}

module.exports = { pageHtml, pagesOf }
