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

const textReplace = [
  [ /[“”]/g, `"` ],
  [ /[‘’]/g, `'` ]
]
nhm = new NodeHtmlMarkdown(
  { textReplace },
  customTranslators
)

function markdownify(page, pubDate) {
  const title = page.title
  const html = page.contents.toString()
  const markdown = nhm.translate(html)

  // haha, we now have to translate the .md link back to .html just for this link
  const orig = page.pub.url.replace(/\.md$/, '.html')

  let output = 
    '[Consult the llms.txt file for a full list of contents](/llms.txt)\n' +
    `[View original HTML](${orig})\n\n` +
    `# ${title}\n\n${markdown}`

  const link = antoraLink(page)

  const frontmatter = {
    title,
    description: page.asciidoc.attributes.description,
    editUrl: page.src.editUrl,
    pubDate,
    link,
  }

  output = `---\n${YAML.stringify(frontmatter)}---\n\n${output}`

  page.contents = Buffer.from(output)
}

function antoraLink({src, asciidoc}) {
  const { relative, version, component, module } = src
  const vpart = 'page-component-version-is-latest' in asciidoc.attributes ? '' : `${version}@`
  const coordpart = `${component}:${module}:${relative}`.replace(':ROOT:', '::')
  return `xref:${vpart}${coordpart}[]`
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

}
