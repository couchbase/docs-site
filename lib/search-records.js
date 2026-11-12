'use strict'

/*
 * Turns one built docs page into search records.
 *
 * This is the recordExtractor from the hosted crawler config
 * (docs-infra/docsearch/crawlers/docs-search-v2.js), lifted out so it can run
 * over the HTML that Antora has already written to disk instead of over pages
 * fetched by a crawler. The logic is deliberately unchanged: the records it
 * produces should match what the crawler puts in the live index, which is what
 * scripts/search-index.js --compare checks.
 *
 * The records are plain JSON with no engine-specific fields, so the same
 * output can be loaded into any search engine.
 *
 * Usage:
 *   const cheerio = require('cheerio')
 *   const { extractRecords } = require('./lib/search-records')
 *   const records = extractRecords({ url, $: cheerio.load(html) })
 */

const MAX_RECORD_SIZE = 50000

const SELECTORS = {
  lvl1: '.doc > .page-heading-title > h1.page, .landing-page-doc > h1:first-of-type.sect0',
  lvl2: '.doc .sect1 > h2:first-child',
  lvl3: '.doc .sect2 > h3:first-child',
  lvl4: '.doc .sect3 > h4:first-child, .doc h4.discrete',
  lvl5: '.doc .tabs .tabpanel',
  lvl6: '.doc dt',
  content: '.doc p:not(:empty), .doc .abstract blockquote',
  listing_content: '.doc pre code, .doc .sectionbody > pre',
}

const WEIGHTS = {
  lvl1: 90,
  lvl2: 80,
  lvl3: 70,
  lvl4: 60,
  lvl5: 50,
  lvl6: 40,
  content: 0,
  listing_content: 0,
}

const TYPES = Object.keys(SELECTORS)
const typeToClass = (type) => `extract-${type}`
const isContent = (type) => type === 'content' || type === 'listing_content'

// Every <meta name="docsearch:X"> becomes field X on each record from the page.
function readDocsearchMetas ($) {
  const metas = {}
  $('meta').each((i, el) => {
    const attr = $(el).attr()
    const match = attr.name && attr.name.match(/^docsearch:(.*)/)
    if (match) metas[match[1]] = attr.content || ''
  })
  return metas
}

function nodeToRecord (node, $) {
  const type = TYPES.find((t) => node.hasClass(typeToClass(t)))
  const anchor = node.attr('id')
  let text = (node.text() || '').trim()

  // a tab panel has no heading of its own; its title is the tab's label
  if (type === 'lvl5') {
    const label = node.attr('aria-labelledby')
    text = $(`#${label}`).text().trim() || ''
  }

  return {
    ...(anchor ? { anchor } : {}),
    type,
    [type]: text,
    weight: WEIGHTS[type],
  }
}

// Join consecutive paragraphs into one record, up to MAX_RECORD_SIZE.
// Code listings are never joined.
function aggregateContent (stack, item) {
  if (!stack.length) return [item]
  if (item.type === 'content') {
    if (!item.content) return stack
    const latest = stack.at(-1)
    if (latest.type === 'content') {
      const newContent = `${latest.content}\n${item.content}`
      if (newContent.length > MAX_RECORD_SIZE) return [...stack, item]
      latest.content = newContent
      return [...stack.slice(0, -1), latest]
    }
  }
  return [...stack, item]
}

function compareLevels (a, b) {
  if (isContent(a)) return false
  if (isContent(b)) return true
  return a < b
}

function closeTo (stack, level) {
  if (stack.length === 1) return stack
  const top = stack.at(-1)
  if (compareLevels(top.type, level)) return stack

  const rest = stack.slice(0, -1)
  const parent = rest.at(-1)
  const closedParent = { ...parent, children: [...(parent.children || []), top] }
  return closeTo([...rest.slice(0, -1), closedParent], level)
}

function toTree (items) {
  const root = { type: 'lvl0', lvl0: 'Root', children: [] }
  const stack = items.reduce((stack, item) => [...closeTo(stack, item.type), item], [root])
  const [finalRoot] = closeTo(stack, 1)
  return finalRoot
}

function flatten (hnode, context = {}) {
  const { children, type, anchor, weight, ...rest } = hnode
  const newContext = {
    ...context,
    weight: weight || context.weight, // content takes its parent heading's weight
    anchor: anchor || context.anchor,
    [type]: hnode[type],
  }
  return [
    { ...rest, type, ...newContext },
    ...(children || []).flatMap((c) => flatten(c, newContext)),
  ]
}

function extractRecords ({ url, $ }) {
  const baseURI = typeof url === 'string' ? url : url.href
  const dsmetas = readDocsearchMetas($)

  const edition = /ENTERPRISE/i.test($('meta[name=edition]').attr('content') || '')
    ? 'Enterprise Edition'
    : ''
  const description = $('meta[name=description]').attr('content')
  const keywords = $('meta[name=keywords]').attr('content')
  const title = $(SELECTORS.lvl1).text() || dsmetas.component_title

  // Tag each match with its type, then select them all at once: cheerio
  // returns a combined selector in document order, so headings and content
  // come back interleaved exactly as they appear on the page.
  for (const type of TYPES) $(SELECTORS[type]).addClass(typeToClass(type))
  const nodes = $(TYPES.map((t) => `.${typeToClass(t)}`).join(','))

  const items = Array.from(nodes)
    .map((n) => nodeToRecord($(n), $))
    .reduce(aggregateContent, [])

  return flatten(toTree(items))
    .filter((r) => isContent(r.type))
    .map((rec, index) => {
      const { content, listing_content: listing, type, anchor, weight } = rec
      return {
        objectID: `${index}-${baseURI}`,
        url: `${baseURI}${anchor ? '#' + anchor : ''}`,
        url_without_anchor: baseURI,
        anchor,
        content: content || listing,
        is_listing: !!listing,
        lang: 'en',
        language: 'en',
        type: listing ? 'content' : type,
        ...dsmetas,
        title,
        description,
        edition,
        weight: {
          pageRank: parseInt(dsmetas.page_rank),
          level: weight,
          position: index,
        },
        keywords,
        hierarchy: {
          lvl0: null,
          lvl1: rec.lvl1 || null,
          lvl2: rec.lvl2 || null,
          lvl3: rec.lvl3 || null,
          lvl4: rec.lvl4 || null,
          lvl5: rec.lvl5 || null,
          lvl6: rec.lvl6 || null,
        },
        recordVersion: 'v3',
      }
    })
}

// Pages the crawler would not index: redirect stubs and anything marked noindex.
function isIndexable ($) {
  if ($('meta[http-equiv=refresh]').length) return false
  const robots = $('meta[name=robots]').attr('content') || ''
  return !/noindex/i.test(robots)
}

module.exports = { extractRecords, isIndexable, MAX_RECORD_SIZE }
