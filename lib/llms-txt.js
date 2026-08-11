'use strict'

const { NodeHtmlMarkdown } = require('node-html-markdown')
const nhm = new NodeHtmlMarkdown()
const fs = require('fs')
const picomatch = require('picomatch')

const File = require('vinyl')
const { navigationDataPath, jsonPathFor } = require('./site-navigation-data-json')

module.exports.register = function ({ playbook, config }) {

  this.once('beforePublish', async ({ siteCatalog }) => {

    const siteUrl = playbook.site.url.replace(/\/$/, '')
    // TODO: check playbook.asciidoc.attributes['absolute-path-llms-txt'] for whether to include this or not

    // IF we definitely DON'T want the `/markdown` subdirectory prefix, then we could purge this,
    // and the `if (prefix)` block below.
    const prefix = playbook.asciidoc.attributes['llms-txt-prefix']

    // requires ./site-navigation-data-json.js to have already run, so the nav data is
    // available here as clean JSON rather than eval-able JS
    let navObj
    try {
      const navJsonPath = jsonPathFor(navigationDataPath(playbook))
      const navJson = siteCatalog.getFiles().find(file => file.path === navJsonPath).contents.toString()
      navObj = JSON.parse(navJson)
    }
    catch(e) {
      console.log("Error fetching navigation data, skipping llms.txt generation", e)
      return
    }

    // nav_groups (see antora-playbook.yml, keys.nav_groups) is the same grouping used to build
    // the top nav bar, and doubles as a Good Enough categorisation for splitting llms.txt into
    // per-category sub-indexes. The playbook builder camelCases snake_case keys, so this shows
    // up as `navGroups` here even though it's `nav_groups` in the YAML.
    let navGroups
    try {
      navGroups = JSON.parse(playbook.site.keys.navGroups)
    }
    catch(e) {
      console.log("Error parsing nav_groups, skipping llms.txt generation", e)
      return
    }

    // a group with `subGroups` (e.g. "Develop") is just a heading for its subGroups and has no
    // components/content of its own, so it's the subGroups (e.g. "Operational SDKs",
    // "Analytics SDKs") that become their own llms-<slug>.txt files, not the parent.
    const leafGroups = navGroups.flatMap(g => g.subGroups || [g])

    const slugify = (title) => title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    const matchers = leafGroups.map(g => ({
      title: g.title,
      slug: slugify(g.title),
      isMatch: picomatch(g.components || []),
    }))

    const partial = fs.readFileSync('home/modules/ROOT/partials/llms-txt.md').toString()
    const fullPartial = fs.readFileSync('home/modules/ROOT/partials/llms-full-txt.md').toString()

    function renderComponent(c) {
      // select only the most recent version
      const v = c.versions[0]
      if (! v.sets.length) { return '' }

      const version = v.version.match(/\d\.\d/) ? `(${v.version})` : ''
      let out = `\n\n### ${c.title} ${version}\n`

      function process(item, level=0) {
        if (item.content) {
          let content = item.url ?
            `[${item.content}](${siteUrl}${item.url})` :
            nhm.translate(item.content)

          // above translate is due to a quirk in the way the navigation data is generated:
          // in the case of a link with `^` created with `rel="noopener" target="_blank"`
          // something in the antora -> antora-site-generator-ms pipeline causes the content
          // to be the HTML node, with no url extracted. This still *works* because Markdown
          // allows HTML snippets, but it's ugly for readers of the raw markdown, so we translate
          // the HTML link to markdown ourselves here.

          if (prefix) {
            content = content.replace(/\]\(/, `](${prefix}`)
          }

          out += `${' '.repeat(4*(level))}- ${content}\n`
        }
        const indent = item.content ? 1 : 0

        for (const i of item.items || []) {
          process(i, level+indent)
        }
      }

      process({ items: v.sets })
      return out
    }

    function addTxtFile(name, contents) {
      siteCatalog.addFile(new File({
        contents: Buffer.from(contents),
        mediaType: 'text/markdown',
        out: { path: name },
        path: name,
        pub: { url: `/${name}`, rootPath: '' },
        src: { stem: name.replace(/\.txt$/, '') },
      }))
    }

    // bucket each component under the first leaf group whose `components` glob patterns match
    // its name; anything that doesn't match any group still gets published, under "Other",
    // rather than silently dropped.
    const byGroup = new Map(matchers.map(m => [m, []]))
    const unmatched = []
    for (const c of navObj) {
      const m = matchers.find(m => m.isMatch(c.name))
      if (m) byGroup.get(m).push(c)
      else unmatched.push(c)
    }
    if (unmatched.length) {
      console.log(`llms-txt: component(s) not matched by any nav_groups entry, filing under "Other": ${unmatched.map(c => c.name).join(', ')}`)
    }

    const categories = [...matchers.map(m => ({ title: m.title, slug: m.slug, components: byGroup.get(m) }))]
    if (unmatched.length) categories.push({ title: 'Other', slug: 'other', components: unmatched })

    const hasContent = new Set()
    for (const { title, slug, components } of categories) {
      const body = components.map(renderComponent).join('')
      if (!body) continue
      addTxtFile(`llms-${slug}.txt`, `# ${title}\n${body}`)
      hasContent.add(slug)
    }

    // walk navGroups (not the flattened leafGroups/matchers) so branches like "Develop" ->
    // "Operational SDKs" / "Analytics SDKs" are preserved as a heading with nested links,
    // rather than flattened to the same level as "Server", "Capella", etc.
    let output = `# Couchbase\n\n${partial}\n\n\n## Docs\n`
    for (const g of navGroups) {
      if (g.subGroups) {
        const subLinks = g.subGroups
          .map(sg => ({ title: sg.title, slug: slugify(sg.title) }))
          .filter(({ slug }) => hasContent.has(slug))
        if (!subLinks.length) continue
        output += `\n- ${g.title}`
        for (const { title, slug } of subLinks) {
          output += `\n    - [${title}](${siteUrl}/llms-${slug}.txt)`
        }
      }
      else {
        const slug = slugify(g.title)
        if (!hasContent.has(slug)) continue
        output += `\n- [${g.title}](${siteUrl}/llms-${slug}.txt)`
      }
    }
    if (hasContent.has('other')) {
      output += `\n- [Other](${siteUrl}/llms-other.txt)`
    }
    addTxtFile('llms.txt', output)

    // NOT a concatenation of every category's markdown - we tried that, and the sheer size of
    // the resulting file broke the build (and wasn't something an LLM would want to read anyway).
    // Instead this just points readers at the full Markdown corpus's own git repo.
    addTxtFile('llms-full.txt', fullPartial)

    // now create the new sitemap
    const url = playbook.site.url.replace(/\/?$/, '/')

    const llmsUrls = ['llms.txt', 'llms-full.txt', ...categories.filter(({ slug }) => hasContent.has(slug)).map(c => `llms-${c.slug}.txt`)]
    const lastmod = new Date().toISOString()
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${llmsUrls.map(path => `<url>
<loc>${url}${path}</loc>
<lastmod>${lastmod}</lastmod>
</url>`).join('\n')}
</urlset>`

    siteCatalog.addFile(new File({
        contents: Buffer.from(sitemap),
        mediaType: 'text/xml',
        out: { path: 'sitemap-llms.xml' },
        path: 'sitemap-llms.xml',
        pub: { url: `/sitemap-llms.xml`, rootPath: '' },
        src: { stem: 'sitemap-llms' },
    }))

    const mainSiteMap = siteCatalog.getFiles().find(f => f?.out?.path === 'sitemap.xml')
    if (mainSiteMap) {
      let xml = mainSiteMap.contents.toString()
      xml = xml.replace(/<\/sitemapindex>/,
        `<sitemap>
<loc>${url}sitemap-llms.xml</loc>
</sitemap>
</sitemapindex>`)

      mainSiteMap.contents = Buffer.from(xml)
    }
  })
}
