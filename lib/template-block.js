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
"use strict";

const handlebars = require("handlebars")
const YAML = require('yaml')
const logger = global.Opal.Asciidoctor.Logging.getLogger()
const asciidoctor = require('@asciidoctor/core')()
const fs = require('node:fs')

// declare the [template, ...] block extension
function register (registry, config) {
    registry.block(function () {
        const self = this
    
        self.named('template')
        self.positionalAttributes(['dataResourceId', 'withMetadata'])
        self.onContext('open')
        
        self.process((parent, reader, attributes) => process(parent, reader, attributes, config, self));
    })
}

// handler called for each [template] block
function process (parent, reader, attributes, config, block) {
    try {
        // resolve json or .yml data
        var data = getResource(attributes.dataResourceId, config)

        // compile .hbs template
        setupHandlebars(attributes, config)
        const source = reader.getLines().join('\n')

        const template = handlebars.compile(source)

        if (attributes.withMetadata) {
          data = { ...attributes, data }
        }

        // output
        const output = template(data)
        const parsed = asciidoctor.load(output)
        parent.append(parsed)
    }
    catch(err) {
        const errstr = `ERROR (template-block): ${err}`
        logger.error(errstr)
        return block.createOpenBlock(parent, errstr)
    }
}

// also split on $ for Antora, which isn't handled by node:path
const basename = path => path.split(/[/$]/).pop().replace(/\.\w+$/, '')

function setupHandlebars(attributes, config) {
    
    global.handlebars = handlebars
    
    for (var file of fs.readdirSync(`${__dirname}/helpers/`)) {
        if (!file.endsWith('.js')) {
            continue // skip non-js files
        }
        const code = require(`${__dirname}/helpers/${file}`)
        handlebars.registerHelper(basename(file), code)
    }
    
    // handle anything passed via Antora resourceId as helpers=... or partials=...
    const _register = (resourceIds, config, register) => {
        const items = resourceIds
            .split(',')
            .filter(x=>x) // strip out empty strings
            
        for (var item of items) {
            const thing = getResource(item, config)
            const name = basename(item)
            register.apply(handlebars, [name, thing])
        }
    }
    _register(attributes.helpers || '', config, handlebars.registerHelper)
    _register(attributes.partials || '', config, handlebars.registerPartial)
}

// get a resource from the Antora contentCatalog
// This is called from the context of the current page,
// and attempts to process known filetypes:
//    .json / .yml    (parse)
//    .js             (require)
//    everything else (just return string)
//  
//
function getResource (resourceId, config) {
    const target = config.contentCatalog.resolveResource(
        resourceId, config.file.src)

    if (! target) {
        throw `Data file ${resourceId} not resolved`
    }

    if (/\.jsonc?$/.test(resourceId)) {
        return JSON.parse(target.contents)
    }
    else if (/\.ya?ml$/.test(resourceId)) {
        return YAML.parse(target.contents.toString(), {maxAliasCount: -1} )
    }
    else if (/\.js$/.test(resourceId)) {
        return requireFromString(target.contents.toString(), resourceId)
    }
    else {
        return target.contents.toString()
    }
}

// Helper functions

// https://stackoverflow.com/questions/17581830/load-node-js-module-from-string-in-memory
function requireFromString(src, filename) {
    var Module = module.constructor;
    var m = new Module();
    m._compile(src, filename);
    return m.exports;
  }

module.exports = { register }
