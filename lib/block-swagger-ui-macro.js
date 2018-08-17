const buildSwaggerUi = ({ specUrl, bundleUrl }) => `<link rel="stylesheet" href="${bundleUrl}/swagger-ui.css">
<script src="${bundleUrl}/swagger-ui-bundle.js"></script>
<script src="${bundleUrl}/swagger-ui-standalone-preset.js"></script>
<script>
window.ui = SwaggerUIBundle({
  url: "${specUrl}",
  dom_id: "#swagger-ui",
  deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset.slice(1)],
  plugins: [SwaggerUIBundle.plugins.DownloadUrl],
  layout: "StandaloneLayout",
  tagsSorter: "alpha",
  operationsSorter: "alpha",
  docExpansion: "none",
})
</script>`

function blockSwaggerUiMacro () {
  this.process((parent, specUrl, attrs) => {
    const doc = parent.getDocument()
    if (~specUrl.indexOf('{')) {
      specUrl = doc.$sub_attributes(specUrl, Opal.hash({ attribute_missing: 'drop-line' }))
      if (!specUrl) return
    }
    const headerAttrs = doc.header_attributes
    const bundleUrl = specUrl.startsWith('https://s3.amazonaws.com/cb-docs-swagger/')
      ? 'https://cb-docs-swagger.s3.amazonaws.com/dist3'
      : 'https://couchbase-docs.s3.amazonaws.com/assets/swagger-ui-3.7'
    Opal.hash_put(headerAttrs, 'page-content-scripts', buildSwaggerUi({ specUrl, bundleUrl }))
    return this.createBlock(parent, 'open', [], { id: 'swagger-ui' })
  })
}

function register (registry, context) {
  registry.blockMacro('swagger_ui', blockSwaggerUiMacro)
}

module.exports.register = register
