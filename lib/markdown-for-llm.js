'use strict'

const { NodeHtmlMarkdown } = require('node-html-markdown')
const nhm = new NodeHtmlMarkdown()

const File = require('vinyl')

function markdownify(page) {
  const html = page.contents.toString()

  const link = `[View original HTML](${page.pub.url})\n\n`

  const markdown = link + nhm.translate(html)

  page.out.path = page.out.path.replace(/\.html$/, '.md')
  page.pub.url = page.pub.url.replace(/\.html$/, '.md')

  page.contents = Buffer.from(markdown)
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

  this.once('documentsConverted', async ({ playbook, contentCatalog, siteCatalog }) => {
    const logger = this.getLogger('llm-summaries')

    const pages = contentCatalog.getPages(
      (page) =>
        page.mediaType === 'text/html'
        && page.pub
        && page.out)

    const CHUNK_SIZE = 100

    for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
      const chunk = pages.slice(i, i + CHUNK_SIZE)

      for (const page of chunk) {
        markdownify(page)
      }

      if (i + CHUNK_SIZE < pages.length) {
        await new Promise(resolve => setImmediate(resolve))
      }
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
> designed for high performance, scalability, and flexibility. The documentation covers comprehensive
> guides for developers and operations teams, including installation and configuration, development
> tutorials, API references, administration, security, cloud deployment, and integration with various
> programming languages and frameworks. Couchbase enables applications to handle massive data volumes
> and high concurrency with its memory-first architecture and flexible JSON document model.\n\n`

    output+=`\n## Docs\n`

    for (const c of navObj) {
      const v = c.versions[0]
      if (! v.sets.length) { continue }

      const version = v.version.match(/\d\.\d/) ? `(${v.version})` : ''
      output += `\n\n### ${c.title} ${version}\n`

      function process(item, level=0) {
        if (item.content) {
          const content = item.url ?
            `[${item.content}](${item.url})` :
            item.content

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
