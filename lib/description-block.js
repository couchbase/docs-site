/* description-block.js

This extension processes a `[description]` block, letting a page write its
description once, as real AsciiDoc (multiple paragraphs, emphasis, xrefs,
document attributes), rather than as a single-line `:description:` header
attribute stitched together with ` + \` continuations and `pass:q[]`.

  [description]
  --
  _Couchbase is the modern database for enterprise applications._

  Couchbase is a distributed document database with a powerful search
  engine and in-built operational and analytical capabilities.
  --

The block is rendered in place, exactly as written (blank lines still mean
new paragraphs, `_..._` still means emphasis, `{page-attribute}` refs still
resolve). It also copies a plain *text* (not HTML/entities - see
decodeEntities below) rendering of its content onto the page's
`description` attribute, for reuse in <meta> tags and in the Markdown/
llms.txt export (see markdown-for-llm.js), decoupled from the
richly-formatted on-page version.

Add `abstract` as a second positional attribute to also apply the standard
`[abstract]` block styling to the on-page content:

  [description,abstract]
  --
  ...
  --

Why this writes to `file.asciidoc.attributes` instead of just setting a
document attribute: Antora pre-computes each page's metadata (the
`page.asciidoc.attributes` that UI templates read for things like <meta>
tags) with a *separate, header-only, extension-free* parse that runs before
the real per-page conversion - see @antora/document-converter's
convertDocuments(), which truncates the source to everything above the
first blank line and passes `extensions: []`. That pass never sees this
block, and a plain `doc.setAttribute()` from inside it wouldn't survive
anyway (Document#parse() ends by restoring `attributes` to the snapshot
taken right after the header). `file.asciidoc` is already populated with
that pre-pass metadata by the time our block runs during the *real*
conversion, so we patch it directly - the same trick json-config-ui-block-macro.js
uses for `page-content-scripts`.

See also

 * https://docs.asciidoctor.org/asciidoctor.js/latest/extend/extensions/block/

*/
'use strict'

const striptags = require('striptags')

function register (registry, { file } = {}) {
  registry.block(function () {
    const self = this
    self.named('description')
    // 'open' is the multi-paragraph `--`-delimited form. 'paragraph' covers
    // the common one-paragraph case with no delimiter at all - the same
    // shape as the site's existing `[abstract]` usage (see pages.adoc) -
    // so refactoring one of those into `[description]` is a straight
    // swap of the attribute line, not a rewrite into a delimited block.
    self.onContext(['open', 'paragraph'])
    self.positionalAttributes(['variant'])
    self.process((parent, reader, attrs) => process(self, parent, reader, attrs, file))
  })
}

function process (self, parent, reader, attrs, file) {
  // Style has to land in the attributes hash *before* createBlock() builds
  // the node - AbstractBlock reads its style from attributes.style at
  // construction time. Setting it after via block.setStyle() looks like it
  // works (getStyle() reflects it immediately) but is silently lost by the
  // time the document tree is finalized and converted.
  if (attrs.variant === 'abstract') attrs.style = 'abstract'

  const block = self.createBlock(parent, 'open', undefined, attrs, { content_model: 'compound' })
  self.parseContent(block, reader)

  const text = toPlainText(block)

  // Belt-and-suspenders for non-Antora (plain Asciidoctor) conversion: see
  // the setHeaderAttribute note above for why this - and not setAttribute -
  // is the call that actually survives to the end of the document.
  parent.getDocument().setHeaderAttribute('description', text)

  // What Antora/the UI actually read back as the page's `description`.
  if (file && file.asciidoc) file.asciidoc.attributes.description = text

  return block
}

// Render the block's children and strip them back down to plain text, for
// use somewhere that can't render AsciiDoc/HTML (a <meta> tag, a YAML
// frontmatter string).
//
// child.getContent() has already been through Asciidoctor's specialchars/
// quotes/replacements subs, so it's HTML: literal `&` is `&amp;`, smart
// quotes and em/en dashes are numeric entities (e.g. a lone ` -- ` becomes
// `&#8201;&#8212;&#8201;`). striptags only strips tags, not entities - and
// leaving them in produces double-escaped junk like `&amp;#8212;` once the
// UI template's own HTML-escaping runs over our value a second time (see
// columnar-sdk.adoc's "--" in its description for a real example). Decode
// back to plain Unicode text so this value is safe for *any* consumer,
// escaping or not.
function toPlainText (block) {
  return decodeEntities(striptags(collectContent(block))).replace(/\s+/g, ' ').trim()
}

// Covers every entity Asciidoctor's HTML5 converter can produce from
// specialchars (&amp; &lt; &gt;), quotes (curly quotes) and replacements
// (dashes, ellipsis, (C)/(R)/(TM), arrows) subs - see the REPLACEMENTS and
// QUOTE_TAGS tables in asciidoctor's converter/substitutors source. All of
// those are numeric character references except the specialchars trio.
function decodeEntities (str) {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(amp|lt|gt);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>' }[name]))
}

function collectContent (block) {
  return block.getBlocks()
    .map((child) => {
      const nested = child.getBlocks()
      return nested.length ? collectContent(child) : (child.getContent() || '')
    })
    .join(' ')
}

module.exports = { register }
