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

function register (registry, config) {
    const logger = global.Opal.Asciidoctor.Logging.getLogger()

    registry.block(function () {
        const self = this
    
        self.named('template')
        self.positionalAttributes('resourceId')
        self.onContext('open')
        
        self.process(function (parent, reader, attributes) {   
            try {
                const data = resolveData(attributes.resourceId, config)

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

function resolveData (resourceId, config) {
    const target = config.contentCatalog.resolveResource(
        resourceId, config.file.src)

    if (! target) {
        throw `Data file ${resourceId} not resolved`
    }

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

module.exports = { register }
