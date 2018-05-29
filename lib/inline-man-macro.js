const { posix: path } = require('path')

function initInlineManMacro (context) {
  return function () {
    this.process((parent, target, attrs) => {
      const text = target.startsWith('couchbase-cli-') ? target.substr(14) : target
      const pageId = path.join(path.dirname(context.file.src.relative), target)
      // NOTE the value of the path attribute is never used, so we can fake it
      const attributes = Opal.hash2(['refid', 'path'], { refid: pageId, path: pageId })
      return this.createInline(parent, 'anchor', text, { type: 'xref', target, attributes })
    })
  }
}

function register (registry, context) {
  registry.inlineMacro('man', initInlineManMacro(context))
}

module.exports.register = register
