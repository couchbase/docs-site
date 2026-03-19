'use strict'

const { NodeHtmlMarkdown } = require('node-html-markdown')
const nhm = new NodeHtmlMarkdown()
const fs = require('fs')

const File = require('vinyl')

module.exports.register = function ({ playbook, config }) {

 this.once('beforePublish', async ({ siteCatalog }) => {

    // this should be inferred from the site.url, but that doesn't seem to factor in the site nav.
    const prefix = playbook.asciidoc.attributes['llms-txt-prefix']

    const nav = siteCatalog.getFiles().find(
      file => file.path === '_/js/site-navigation-data.js').contents.toString()
    const match = nav.match(/^siteNavigationData=(.+)$/s);
    // This file is created by @antora/site-generator-ms
    // eslint-disable-next-line no-eval
    const navObj = eval(match[1])

    const partial = fs.readFileSync('home/modules/ROOT/partials/llms-txt.md').toString()

    let output = `# Couchbase\n\n${partial}\n\n\n## Docs\n`

    for (const c of navObj) {

      // select only the most recent version
      const v = c.versions[0]
      if (! v.sets.length) { continue }

      const version = v.version.match(/\d\.\d/) ? `(${v.version})` : ''
      output += `\n\n### ${c.title} ${version}\n`

      function process(item, level=0) {
        if (item.content) {

          let content = item.url ?
            `[${item.content}](${item.url})` :
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
