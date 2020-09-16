const BUNDLE_BASE_URL = 'https://couchbase-docs.s3.amazonaws.com/assets'
const buildJsonConfigUi = ({ configUrl, version, bundleBaseUrl }) =>
  `<link rel="stylesheet" href="${bundleBaseUrl}/json-config-ui/json-config-ui.css">
<script src="${bundleBaseUrl}/json-config-ui/json-config-ui-bundle.js"></script>
<script>
;(function (url, version) {
  JSONConfigUIBundle({
    specs: [{ version: version, url: url }],
    current: version
  })
})('${configUrl}', '${version}')
</script>`

function blockJsonConfigUiMacro ({ file }) {
  return function () {
    this.process((parent, configUrl, attrs) => {
      const doc = parent.getDocument()
      if (~configUrl.indexOf('{')) {
        configUrl = doc.$sub_attributes(configUrl, Opal.hash({ attribute_missing: 'drop-line' }))
        if (!configUrl) return
      }
      const version = attrs.$$is_hash ? Opal.hash_get(attrs, 'version') : attrs.version
      const contentScripts = buildJsonConfigUi({ configUrl, version, bundleBaseUrl: BUNDLE_BASE_URL })
      if ((file.asciidoc || {}).attributes) file.asciidoc.attributes['page-content-scripts'] = contentScripts
      Opal.hash_put(doc.header_attributes, 'page-content-scripts', contentScripts) // Antora 2.2
      return this.createBlock(parent, 'pass', '<div id="swagger-ui"></div>')
    })
  }
}

function register (registry, context) {
  registry.blockMacro('json_config_ui', blockJsonConfigUiMacro(context))
}

module.exports.register = register
