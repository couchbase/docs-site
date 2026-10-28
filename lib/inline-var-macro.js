const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c])

function register (registry, context) {
  registry.inlineMacro('var', function () {
    // short format: no target, so `placeholder:[...]` is allowed
    this.matchFormat('short')
    // take the bracket content verbatim as `attrs.text`, not as a parsed attribute list
    this.parseContentAs('text')
    this.process(function (parent, target, attrs) {
      const subs = parent.getSubstitutions ? parent.getSubstitutions() : []
      const escaped = subs.includes('specialcharacters')
      const text = attrs.text ? (escaped ? attrs.text : escapeHtml(attrs.text)) : escapeHtml("<PLACEHOLDER>")
      return this.createInlinePass(
        parent,
        `<span class="editable-field" contenteditable="plaintext-only">${text}</span>`)
    })
  })
}

module.exports.register = register
