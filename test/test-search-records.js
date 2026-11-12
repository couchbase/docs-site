'use strict'

const assert = require('assert')
const cheerio = require('cheerio')
const { extractRecords, isIndexable } = require('../lib/search-records')

const URL = 'https://docs.example.com/widget/current/intro.html'

const page = (body, head = '') => `<!DOCTYPE html>
<html><head>
<meta name="description" content="About widgets.">
<meta name="docsearch:component" content="widget">
<meta name="docsearch:component_version" content="widget@1.0">
<meta name="docsearch:page_rank" content="50">
${head}
</head><body><article class="doc">
<div class="page-heading-title"><h1 class="page">Widgets</h1></div>
${body}
</article></body></html>`

describe('search records', () => {
  it('groups paragraphs under their heading, in page order', () => {
    const $ = cheerio.load(page(`
      <p>Intro one.</p><p>Intro two.</p>
      <div class="sect1"><h2 id="install">Install</h2>
        <div class="sectionbody"><p>Run the installer.</p>
          <div class="sect2"><h3 id="linux">Linux</h3><p>Use the package.</p></div>
        </div>
      </div>`))
    const records = extractRecords({ url: URL, $ })

    assert.deepStrictEqual(records.map((r) => r.content), [
      'Intro one.\nIntro two.',
      'Run the installer.',
      'Use the package.',
    ])
    assert.deepStrictEqual(records.map((r) => r.objectID), [0, 1, 2].map((i) => `${i}-${URL}`))
    assert.strictEqual(records[0].url, URL)
    assert.strictEqual(records[1].url, `${URL}#install`)
    assert.strictEqual(records[2].url, `${URL}#linux`)
    assert.strictEqual(records[2].hierarchy.lvl1, 'Widgets')
    assert.strictEqual(records[2].hierarchy.lvl2, 'Install')
    assert.strictEqual(records[2].hierarchy.lvl3, 'Linux')
    // content inherits the weight of the heading it sits under
    assert.deepStrictEqual(records.map((r) => r.weight.level), [90, 80, 70])
  })

  it('copies docsearch meta tags onto every record', () => {
    const $ = cheerio.load(page('<p>Hello.</p>'))
    const [record] = extractRecords({ url: URL, $ })
    assert.strictEqual(record.component, 'widget')
    assert.strictEqual(record.component_version, 'widget@1.0')
    assert.strictEqual(record.weight.pageRank, 50)
    assert.strictEqual(record.description, 'About widgets.')
    assert.strictEqual(record.title, 'Widgets')
  })

  it('keeps code listings as their own records', () => {
    const $ = cheerio.load(page('<p>Before.</p><pre><code>cbq -e localhost</code></pre><p>After.</p>'))
    const records = extractRecords({ url: URL, $ })
    assert.deepStrictEqual(records.map((r) => [r.content, r.is_listing]), [
      ['Before.', false],
      ['cbq -e localhost', true],
      ['After.', false],
    ])
  })

  it('skips redirect stubs and noindex pages', () => {
    assert.strictEqual(isIndexable(cheerio.load(page('<p>x</p>'))), true)
    assert.strictEqual(isIndexable(cheerio.load(page('', '<meta name="robots" content="noindex">'))), false)
    assert.strictEqual(isIndexable(cheerio.load(page('', '<meta http-equiv="refresh" content="0; url=a.html">'))), false)
  })
})
