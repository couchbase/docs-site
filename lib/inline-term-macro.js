/**
 * Extends the AsciiDoc syntax to add support for the inline term macro.
 *
 * Usage:
 *
 *  term:[frobnitz]
 *  term:[frobnitz,frobnitzer]  // override the display of the term
 *
 * @author Hakim Cassimally <hakim.cassimally@couchbase.com>
 */

const slugify = t => t.toLowerCase().replace(/\W+/, '-')

function inlineTermMacro () {
  this.parseContentAs('text')
  this.matchFormat('short')
  this.process((parent, attrs) => {
    console.log(attrs)

    const [term, opttext] = attrs.split(',')
    const text = opttext || term
    const prefix = "https://docs.couchbase.com/sync-gateway/current/glossary.html" // TODO
    const url = `${prefix}#${slugify(term)}`

    return this.createInline(parent, 'anchor', text, { type: 'link', target: url })
  })
}

function register (registry, context) {
  const { config: { attributes } } = context

  registry.inlineMacro('term', inlineTermMacro)
}

module.exports.register = register
