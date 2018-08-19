const BUNDLE_BASE_URL = 'https://couchbase-docs.s3.amazonaws.com/assets'
const buildJsonConfigUi = ({ configUrl, version, bundleBaseUrl }) =>
  `<link rel="stylesheet" href="${bundleBaseUrl}/json-config-ui/json-config-ui-vnext.css">
<script src="${bundleBaseUrl}/json-config-ui/json-config-ui-bundle-vnext.js"></script>
<script>
;(function (url, version) {
  JSONConfigUIBundle({
    specs: [{ version: version, url: url }],
    current: version
  })
})('${configUrl}', '${version}')
</script>`

function blockJsonConfigUiMacro () {
  this.process((parent, configUrl, attrs) => {
    const doc = parent.getDocument()
    if (~configUrl.indexOf('{')) {
      configUrl = doc.$sub_attributes(configUrl, Opal.hash({ attribute_missing: 'drop-line' }))
      if (!configUrl) return
    }
    const version = Opal.hash_get(attrs, 'version')
    const contentScripts = buildJsonConfigUi({ configUrl, version, bundleBaseUrl: BUNDLE_BASE_URL })
    Opal.hash_put(doc.header_attributes, 'page-content-scripts', contentScripts)
    return this.createBlock(parent, 'pass', '<div id="swagger-ui"></div>')
  })
}

function register (registry, context) {
  registry.blockMacro('json_config_ui', blockJsonConfigUiMacro)
}

module.exports.register = register
