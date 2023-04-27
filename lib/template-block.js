/* template-block.js

This extension processes Handlebars templates with data imported in JSON format.
For example:

  [template, example$foo.json]
  --
  {{#each item}}
  * {{name}}
  {{/each}}
  --

The positional parameter `resourceId` is resolved to the data-file using Antora's
usual rules for include:: and xref::.

See also

 * https://handlebarsjs.com/
 * https://docs.antora.org/antora/latest/page/resource-id-coordinates/

*/

const handlebars = require("handlebars")
const YAML = require('yaml')

module.exports.register = function (registry, config) {

  const Opal = global.Opal
  const loggerManager = Opal.module(null, 'Asciidoctor').LoggerManager
  const logger = loggerManager.getLogger()
  
  registry.block(function () {
    const self = this
    
    self.named('template')
    self.positionalAttributes('resourceId')
    self.onContext('open')
    
    self.process(function (parent, reader, attributes) {

      const resolveData = function(resourceId) {
        const target = config.contentCatalog.resolveResource(
          resourceId, config.file.src)

        if (target) {

          if (/\.jsonc?$/.test(resourceId)) {
            return JSON.parse(target.contents)
          }
          else if (/\.ya?ml$/.test(resourceId)) {
            return YAML.parse(target.contents.toString())
          }
          else {
            throw `Don't know how to handle ${resourceId}`
          }
        }
        else {
          throw `Data file ${attributes.resourceId} not resolved`
        }
      }
      
      try {
        const data = resolveData(attributes.resourceId)

        const source = reader.getLines().join('\n')
        const template = handlebars.compile(source)

        const output = template(data)
        return self.createOpenBlock(parent, output)
      }
      catch(err) {
        const errstr = `ERROR (template-block): ${err}`
        logger.error(errstr)
        return self.createOpenBlock(parent, errstr)
      }
    })
  })
}
