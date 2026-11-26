'use strict'

/*
 * Typesense equivalents of the Algolia index settings in
 * docs-infra/docsearch/indexes/docs-search-v2.json.
 *
 * Kept in one place because the loader, the comparison script and (later)
 * the search page all need the same schema and the same search parameters.
 */

// The name readers' searches go to. It is an alias: each load builds a fresh
// collection and then repoints the alias, so a search never sees a half-built
// index.
const ALIAS = 'docs-search'

const SYNONYM_SET = 'docs-search'
const STOPWORD_SET = 'docs-search'

// Algolia: synonyms
const SYNONYMS = [
  ['.net', 'dotnet', 'csharp'],
  ['javascript', 'js', 'node.js'],
  ['paginate', 'pagination'],
  ['cbl', 'couchbase lite'],
  ['sgw', 'sync gateway'],
  ['ttl', 'time to live'],
  ['cng', 'cloud native gateway'],
  ['cluster', 'database'],
  ['create', 'provision', 'provisioning'],
  ['debugging', 'troubleshooting'],
]

// Algolia: optionalWords
const STOPWORDS = ['a', 'an', 'it', 'the', 'and']

const facet = (name, type = 'string') => ({ name, type, facet: true, optional: true })
const text = (name) => ({ name, type: 'string', optional: true })

function collectionSchema (name) {
  return {
    name,
    enable_nested_fields: true,
    synonym_sets: [SYNONYM_SET],
    fields: [
      // Algolia: searchableAttributes
      text('keywords'),
      text('hierarchy.lvl1'),
      text('hierarchy.lvl2'),
      text('hierarchy.lvl3'),
      text('hierarchy.lvl4'),
      text('hierarchy.lvl5'),
      text('hierarchy.lvl6'),
      text('content'),
      text('breadcrumbs'),
      // Algolia: attributeForDistinct (group_by needs a facet)
      { name: 'url_without_anchor', type: 'string', facet: true },
      // Algolia: attributesForFaceting
      facet('component'),
      facet('component_title'),
      facet('component_version'),
      facet('edition'),
      facet('is_listing', 'bool'),
      facet('status'),
      facet('topic_type'),
      facet('type'),
      // Algolia: asc(version_rank) in ranking
      { name: 'version_rank', type: 'int32' },
      // Algolia: customRanking, folded into one number (see toDocument)
      { name: 'rank', type: 'int64' },
    ],
  }
}

const QUERY_BY = [
  'keywords',
  'hierarchy.lvl1',
  'hierarchy.lvl2',
  'hierarchy.lvl3',
  'hierarchy.lvl4',
  'hierarchy.lvl5',
  'hierarchy.lvl6',
  'content',
  'breadcrumbs',
]

// Search parameters every query uses. The caller adds q, filter_by, page etc.
const SEARCH_PARAMS = {
  query_by: QUERY_BY.join(','),
  // earlier attributes matter more, as in Algolia's searchableAttributes order
  query_by_weights: '9,8,7,6,5,4,3,2,1',
  // Algolia: distinct on url_without_anchor -- one hit per page
  group_by: 'url_without_anchor',
  group_limit: 1,
  // Algolia: typo, words, filters, asc(version_rank), proximity, attribute,
  // exact, custom. Typesense allows three sort fields. Newest version first
  // came closest to Algolia's results, because Algolia puts version_rank ahead
  // of everything except typos and word count. Then text relevance, then the
  // folded custom ranking.
  sort_by: 'version_rank:asc,_text_match:desc,rank:desc',
  // Algolia: the "attribute" criterion -- a match in a heading beats a match
  // in body text, however many other fields also matched.
  text_match_type: 'max_weight',
  prioritize_num_matching_fields: false,
  // Algolia: minWordSizefor1Typo / minWordSizefor2Typos
  num_typos: 2,
  min_len_1typo: 4,
  min_len_2typo: 7,
  // Algolia: queryType prefixLast
  prefix: true,
  // Algolia: removeWordsIfNoResults allOptional
  drop_tokens_threshold: 1,
  stopwords: STOPWORD_SET,
  // Algolia: attributesToSnippet content:25
  highlight_affix_num_tokens: 12,
  per_page: 20,
}

const MAX_POSITION = 9999

// Turn a search record (see lib/search-records.js) into a Typesense document.
// The record keeps its shape so the search page can read the same fields; this
// only adds what Typesense needs.
function toDocument (record) {
  const weight = record.weight || {}
  const pageRank = Number.isFinite(weight.pageRank) ? weight.pageRank : 0
  const level = Number.isFinite(weight.level) ? weight.level : 0
  const position = Math.min(Number.isFinite(weight.position) ? weight.position : MAX_POSITION, MAX_POSITION)
  const versionRank = parseInt(record.version_rank, 10)

  return {
    ...record,
    id: record.objectID,
    weight: { pageRank, level, position },
    version_rank: Number.isFinite(versionRank) ? versionRank : 99,
    // desc(pageRank), desc(level), asc(position) as a single sortable number
    rank: pageRank * 1e7 + level * 1e4 + (MAX_POSITION - position),
  }
}

module.exports = {
  ALIAS,
  SYNONYM_SET,
  STOPWORD_SET,
  SYNONYMS,
  STOPWORDS,
  SEARCH_PARAMS,
  collectionSchema,
  toDocument,
}
