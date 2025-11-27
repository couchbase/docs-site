'use strict'

const {convertHtmlToMarkdown} = require('dom-to-semantic-markdown')
const {JSDOM} = require('jsdom')

function overrideElementProcessing (element) {

  if (element.tagName?.toLowerCase() === 'a' 
   && element.className === 'anchor' ) {
      return [{type: 'custom', blank: true}]
  }

  if (element.classList?.contains("admonitionblock")) {
    element.classList.remove('admonitionblock')
    const admonition = element.className.toUpperCase()
    const content = toMarkdown(
      element.querySelector("td.content").innerHTML)

    return [{
      type: 'custom', 
      admonition,
      content
    }]
  }
}

function renderCustomNode (node) {
  if (node.blank) {
    return ''
  }
  if (node.admonition) {
    const body = node.content.split('\n').map(line => `> ${line}`).join('\n')
    return `\n> [!${node.admonition}]\n${body}\n\n`
  }
}

function toMarkdown (html) {
  const dom = new JSDOM(html)
  const markdown = convertHtmlToMarkdown(
    html,
    {
      overrideDOMParser: new dom.window.DOMParser(),
      overrideElementProcessing,
      renderCustomNode
    }
  )
  return markdown
}

function markdownify(page, siteCatalog) {
    const html = page.contents.toString()
    const markdown = `# ${page.asciidoc.doctitle}\n\n` + toMarkdown(html)

    const path = page.out.path.replace(/\.html$/, '.md')
    
    // tell docs-ui to output <link rel="alternate" ...> for the markdown page.
    page.asciidoc.attributes["page-markdown-alt"] = `${page.out.rootPath}/${path}`

    siteCatalog.addFile({
      contents: Buffer.from(markdown),
      out: { path }
    })
}

module.exports.register = function ({ playbook, config }) {
    const logger = this.getLogger('markdown-for-llm')

    this.on('navigationBuilt', async ({ playbook, siteAsciiDocConfig, siteCatalog, uiCatalog, contentCatalog }) => {

        logger.info('Compiling Markdown summaries')

        for (const page of contentCatalog.getPages()) {
          if (page.pub) {
            markdownify(page, siteCatalog)
          }
        }
    })
}
