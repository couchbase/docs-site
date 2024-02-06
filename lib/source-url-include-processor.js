const resolveIncludeFile = (() => {
  try {
    return require('@antora/asciidoc-loader/include/resolve-include-file')
  } catch (e) {
    return require(require.resolve('@antora/asciidoc-loader/include/resolve-include-file', { paths: module.parent.paths }))
  }
})()

const NEWLINE_RX = /\r\n?|\n/
const TAG_DIRECTIVE_RX = /\b(?:tag|(e)nd)::(\S+?)\[\](?=$|[ \r])/m
const INDENT_RX = /^ */m

function initSourceUrlIncludeProcessor ({ file, contentCatalog }) {
  return function () {
    this.$option('position', '>>')
    this.process((doc, reader, target, attrs) => {
      let remainingLines
      const includeStackSize = reader.include_stack.length
      const embedSourceUrl = !target.endsWith('.adoc') && ((remainingLines = reader.getLines())[0] === '----' ||
          (remainingLines[0] === '...' && remainingLines[1] === '----'))
      const defaultProcessor = doc.getExtensions().$include_processors().find((it) => it.instance !== this)
      defaultProcessor.process_method['$[]'](doc, reader, target, Opal.hash(attrs))
      const includeFile = embedSourceUrl && resolveIncludeFile(target, file, reader.$cursor_at_prev_line(), contentCatalog)
      if (!includeFile || reader.include_stack.length === includeStackSize) return
      const includeFileSrc = includeFile.src || includeFile.context
      const includeContents = includeFile.contents
      let sourceUrl = (includeFileSrc.fileUri || includeFileSrc.editUrl.replace(`/edit/${includeFileSrc.origin.branch}`, `/blob/${includeFileSrc.origin.refhash}`)) + resolveLineRangeFragment(includeContents, attrs)
      reader.pushInclude(`${computeIndent(reader.lines)}[data-source-url=${sourceUrl}]\n`, target, target, 1, attrs)
      // NOTE: this assignment works since the attribute is only used internally by this extension
      Opal.hash_put(doc.header_attributes, 'promote-data-source-url', '')
    })
  }
}

function promoteSourceUrlPostprocessor () {
  this.process((doc, html) =>
    doc.hasAttribute('promote-data-source-url')
      ? html.replace(/<pre([^>]*)(><code[^>]*)?> *\[data-source-url=(.+?)\]\n/g, '<pre$1$2 data-source-url="$3">')
      : html
  )
}

function computeIndent (lines) {
  let indent, currentIndent
  for (const line of lines) {
    const currentIndent = (line.match(INDENT_RX) || [''])[0].length
    if ((indent == null || indent > currentIndent) && (indent = currentIndent) === 0) break
  }
  return indent ? ' '.repeat(indent) : ''
}

function resolveLineRangeFragment (contents, attrs) {
  const tagName = attrs.tag
  if (!tagName) return ''
  const range = []
  let lineNum = 0
  contents.split(NEWLINE_RX).some((line) => {
    lineNum++
    let m
    if (~line.indexOf('::') && (m = line.match(TAG_DIRECTIVE_RX))) {
      const thisTagName = m[2]
      if (thisTagName !== tagName) return false
      if (m[1]) {
        if (range[0]) {
          range[1] = `L${lineNum - 1}`
          return true
        }
      } else {
        range[0] = `L${lineNum + 1}`
      }
    }
  })
  return range.length === 2 ? `#${[...new Set(range)].join('-')}` : ''
}

function register (registry, context) {
  registry.includeProcessor(initSourceUrlIncludeProcessor(context))
  registry.postprocessor(promoteSourceUrlPostprocessor)
}

module.exports.register = register
