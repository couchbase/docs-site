const md = require('markdown-it')()
  
module.exports = function (registry) {
  registry.block(function () {
    var self = this
    self.named('markdown')
    self.onContext(['open', 'listing'])
    self.process(function (parent, reader) {

      var lines = reader.getLines()
      const source = lines.join('\n')
      const html = md.render(source)

      return self.createOpenBlock(parent, `\n\n++++\n${html}\n++++\n\n`)
    })
  })
}
