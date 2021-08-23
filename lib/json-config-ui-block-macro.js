const BUNDLE_BASE_URL = 'https://couchbase-docs.s3.amazonaws.com/assets'
const buildJsonConfigUi = ({ configUrl, version, bundleBaseUrl }) =>
  `<link rel="stylesheet" href="${bundleBaseUrl}/json-config-ui/json-config-ui.css">
<script src="${bundleBaseUrl}/json-config-ui/json-config-ui-bundle.js"></script>
<script id="json-config-ui-script" data-url="${configUrl}" data-version="${version || ''}">
;(function (config) {
  JSONConfigUIBundle({
    specs: [{ version: config.version, url: config.url }],
    current: config.version,
  })
})(document.getElementById('json-config-ui-script').dataset)
</script>`

function blockJsonConfigUiMacro ({ file }) {
  return function () {
    this.process((parent, configUrl, attrs) => {
      const doc = parent.getDocument()
      if (~configUrl.indexOf('{')) {
        configUrl = doc.$sub_attributes(configUrl, Opal.hash({ attribute_missing: 'drop-line' }))
        if (!configUrl) return
      }
      const contentScripts = buildJsonConfigUi({ configUrl, version: attrs.version, bundleBaseUrl: BUNDLE_BASE_URL })
      file.asciidoc.attributes['page-content-scripts'] = contentScripts
      return this.createBlock(parent, 'pass', '<div id="swagger-ui"></div>')
    })
  }
}

function register (registry, context) {
  registry.blockMacro('json_config_ui', blockJsonConfigUiMacro(context))
}

module.exports.register = register
