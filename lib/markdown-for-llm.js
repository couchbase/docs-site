'use strict'

const { NodeHtmlMarkdown } = require('node-html-markdown')
const YAML = require('yaml')

let nhm
const customTranslators = {
  DIV:  ({ visitor }) => ({
    surroundingNewlines: 2,
    postprocess: ({ content, nodeMetadata, node }) => {
      // <div class="admonitionblock note">
      if (node.classList.contains('admonitionblock')) {

        const type = (node
            .classList.values().
            find(v => v != 'admonitionblock') || 'NOTE'
            ).toUpperCase()

        const admonition = node.querySelector('td:nth-child(2)')?.innerHTML || `BAD ADMONITION ${content}`
        const body = (
          nhm.translate(admonition).replace(/^/mg, '> '))

        return `> [!${type}]\n${body}`
      }
    }
  })
}
nhm = new NodeHtmlMarkdown({}, customTranslators)

const File = require('vinyl')

function markdownify(page, pubDate) {
  const title = page.title
  const html = page.contents.toString()
  const markdown = nhm.translate(html)

  // haha, we now have to translate the .md link back to .html just for this link
  const orig = page.pub.url.replace(/\.md$/, '.html')

  let output = 
    `[View original HTML](${orig})\n\n` +
    `# ${title}\n\n${markdown}`

  const frontmatter = {
    title,
    description: page.asciidoc.attributes.description,
    editUrl: page.src.editUrl,
    pubDate,
  }

  output = `---\n${YAML.stringify(frontmatter)}---\n\n${output}`

  page.contents = Buffer.from(output)
}

module.exports.register = function ({ playbook, config }) {
  this.once('contextStarted', () => {
    const { createPageComposer: _delegate } = this.getFunctions()

    this.replaceFunctions({
      // see https://gitlab.com/antora/antora/-/blob/v3.1.x/packages/page-composer/lib/create-page-composer.js
      createPageComposer (playbook, contentCatalog, uiCatalog) {
        function composePage (file, _contentCatalog, _navigationCatalog) {
          // instead of wrapping the file in a layout, just
          // return the file as-is
          return file
        }
        const create404Page = (siteAsciiDocConfig) =>
          composePage({
            asciidoc: siteAsciiDocConfig,
            mediaType: 'text/html',
            out: { path: '404.html' },
            pub: {},
            src: { stem: '404' },
            title: siteAsciiDocConfig?.attributes['404-page-title'] || 'PageNot Found',
        })

        const ret = Object.assign(composePage, {composePage, create404Page} )
        return ret
      }
    })
  })

  this.once('contentClassified', async ({ playbook, contentCatalog, siteCatalog }) => {
    const logger = this.getLogger('llm-summaries')

    const pages = contentCatalog.getPages((page) => page.pub && page.out)

    for (const page of pages) {
        page.pub.url = page.pub.url.replace(/\.html$/, '.md')
        page.out.path = page.out.path.replace(/\.html$/, '.md')
    }
  })

  this.once('documentsConverted', async ({ playbook, contentCatalog, siteCatalog }) => {
    const logger = this.getLogger('llm-summaries')

    const pubDate = new Date().toISOString()

    const pages = contentCatalog.getPages(
      (page) =>
        page.mediaType === 'text/html'
        && page.pub
        && page.out)

    for (const page of pages) {
      page.mediaType = 'text/markdown'
      markdownify(page, pubDate)
    }
  })

 this.once('beforePublish', async ({ siteCatalog }) => {
    const nav = siteCatalog.getFiles().find(
      file => file.path === '_/js/site-navigation-data.js').contents.toString()
    const match = nav.match(/^siteNavigationData=(.+)$/s);
    // This file is created by @antora/site-generator-ms
    // eslint-disable-next-line no-eval
    const navObj = eval(match[1])

    let output = ''

    output+=`# Couchbase

> This is the official documentation for Couchbase, a leading NoSQL distributed database platform
> designed for high performance, scalability, and flexibility.
> The documentation covers comprehensive guides for developers and operations
> teams, including installation and configuration, development tutorials, API
> references, administration, security, cloud deployment, and integration with
> various  programming languages and frameworks.
> Couchbase enables applications to handle massive data volumes and high
> concurrency with its memory-first architecture and flexible JSON document
> model.


## Docs\n`

    for (const c of navObj) {
      const v = c.versions[0]
      if (! v.sets.length) { continue }

      const version = v.version.match(/\d\.\d/) ? `(${v.version})` : ''
      output += `\n\n### ${c.title} ${version}\n`

      function process(item, level=0) {
        if (item.content) {

          const content = item.url ?
            `[${item.content}](${item.url})` :
            nhm.translate(item.content)

          // above is due to a quirk in the way the navigation data is generated:
          // in the case of a link with `^` created with `rel="noopener" target="_blank"`
          // something in the antora -> antora-site-generator-ms pipeline causes the content 
          // to be the HTML node, with no url extracted. This still *works* because Markdown
          // allows HTML snippets, but it's ugly for readers of the raw markdown, so we translate 
          // the HTML link to markdown ourselves here.

          output+=`${' '.repeat(4*(level))}- ${content}\n`
        }
        const indent = item.content ? 1 : 0

        for (const i of item.items || []) {
          process(i, level+indent)
        }
      }

      process({ items: v.sets })
      const file = new File({
        contents: Buffer.from(output),
        mediaType: 'text/markdown',
        out: { path: 'llms.txt' },
        path: 'llms.txt',
        pub: { url: `/llms.txt`, rootPath: '' },
        src: { stem: 'llms' },
      })
      siteCatalog.addFile(file)
    }
  })
}
