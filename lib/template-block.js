module.exports.register = function (registry, config) {
const handlebars = require("handlebars")
  
// [template,example$foo.json]

  registry.block(function () {
    var self = this
    
    self.named('template')
    self.positionalAttributes('resourceId')
    self.onContext(['listing', 'open', 'paragraph'])
    
    self.process(function (parent, reader,attributes) {
      const target = config.contentCatalog.resolveResource(
        attributes.resourceId, config.file.src)
      
      if (target) {
        var data = JSON.parse(target.contents)
        var source = reader.getLines().join('\n')
        
        var template = handlebars.compile(source)
        
        var output = template(data)
        return self.createOpenBlock(parent, output)
      }
      else {
        return self.createOpenBlock(parent, `Data file ${attributes.resourceId} not resolved`)
      }
    })
  })
}

