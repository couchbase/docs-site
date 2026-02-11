'use strict'

const {convertHtmlToMarkdown} = require('dom-to-semantic-markdown')
const {JSDOM} = require('jsdom')

function overrideElementProcessing (element) {

  if (element.tagName?.toLowerCase() === 'a') {
    if (element.className === 'anchor') {
      return [{type: 'custom', blank: true}]
    }
    let href = element.getAttribute('href')
    const hasProtocol = /^[a-z]+:\/\//i
    if (href && !href.match(hasProtocol)) {
      href = href.replace(/\.html/, '.md')
      const content = toMarkdown(element.innerHTML || href)
      return [{type: 'link', href, content}]
    }
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

function markdownify(page) {
  const html = page.contents.toString()
  const markdown = toMarkdown(html)

  page.out.path = page.out.path.replace(/\.html$/, '.md')
  if (page.pub.url) {
    page.pub.url = page.pub.url.replace(/\.html$/, '.md')
  }

  page.contents = Buffer.from(markdown)
}

module.exports.register = function ({ playbook, config }) {
  this.once('contextStarted', () => {
    const { createPageComposer: _createPageComposerDelegate } = this.getFunctions()

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

    for (const page of pages) {
      markdownify(page)
    }
  })
}
