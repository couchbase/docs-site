'use strict'

/**
 * Configure an Asciidoc extension from Antora
 *
 * Usage:

  in antora-playbook.yml
  antora:
    extensions:
    - require: './lib/wrap-asciidoc-extension.js'
      extension: '../lib/inline-jira-macro.js'
      data: ....

 * The Asciidoc extension must accept an optional 3rd parameter for configuration data.
 * see inline-jira-macro.js for an example
 *
 * @author Hakim Cassimally <hakim.cassimally@couchbase.com>
 */

module.exports.register = (context, {config}) => {

    const resolved = require.resolve(config.extension)
    const extension = context.require(resolved)
    const data = config.data
    
    context.on('beforeProcess', async (context) => {
        const extensions = context.siteAsciiDocConfig.extensions
        
        // Usually Asciidoc extensions `register` function accepts only a registry and a context.
        // As we want to configure the extension, our Asciidoc extension must provide an optional 3rd parameter for the configuration.
        // Here, we simply provide a wrapper function which does this translation.
        const configuredRegister =
            function register (registry, context) {
                extension.register(registry, context, data)
            }
        
        extensions.push({register: configuredRegister})
    })
}
