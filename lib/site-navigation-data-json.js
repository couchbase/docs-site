'use strict'

// Antora core (@antora/site-generator-ms/lib/export-site-navigation-data.js) writes the
// site's navigation data as a `siteNavigationData=[...]` JS assignment, so the browser can
// load it straight off a <script> tag. That means anything that wants the underlying data
// server-side (llms.txt generation, merging a partial build's nav with the primary site's,
// or any future consumer) has to `eval` that JS to get it back out.
//
// We do that eval exactly once, here, immediately after Antora writes the file - so we're
// evaling Antora's own freshly-generated output from this same build, not third-party or
// network content - and republish the result as a clean, boring JSON file. Everything
// downstream should read *that* instead, and never need to eval anything.
//
// Must be registered after "@antora/site-generator-ms" (so the .js file already exists) and
// before any extension that wants to consume the .json it produces here, e.g. ./llms-txt.js
// or ./site-dependencies.js.

module.exports.register = function ({ playbook }) {
  this.once('beforePublish', ({ siteCatalog }) => {
    const navPath = navigationDataPath(playbook)
    const navFile = findFile(siteCatalog, navPath)
    if (!navFile) return // e.g. export-site-navigation-data isn't enabled for this build

    const navigationData = parseNavigationJs(navFile.contents.toString())
    siteCatalog.addFile(buildJsonFile(navPath, navigationData))
  })
}

function navigationDataPath (playbook) {
  return playbook.asciidoc.attributes['site-navigation-data-path'] || '_/js/site-navigation-data.js'
}

function jsonPathFor (navPath) {
  return navPath.replace(/\.js$/, '.json')
}

function findFile (siteCatalog, path) {
  return siteCatalog.getFiles().find((f) => f.out && f.out.path === path)
}

function parseNavigationJs (js) {
  const match = js.match(/^siteNavigationData\s*=\s*(.+)$/s)
  if (!match) throw new Error('unexpected site-navigation-data.js format')
  // eslint-disable-next-line no-eval -- safe: this is Antora's own output, generated moments
  // ago in this same process, not network or user-supplied content
  return eval(match[1])
}

function buildJsonFile (navPath, navigationData) {
  const path = jsonPathFor(navPath)
  return {
    contents: Buffer.from(JSON.stringify(navigationData) + '\n'),
    mediaType: 'application/json',
    out: { path },
    path,
    pub: { url: '/' + path, rootPath: '' },
    src: { stem: path.slice(0, path.lastIndexOf('.')) },
  }
}

module.exports.navigationDataPath = navigationDataPath
module.exports.jsonPathFor = jsonPathFor
module.exports.findFile = findFile
module.exports.buildJsonFile = buildJsonFile
