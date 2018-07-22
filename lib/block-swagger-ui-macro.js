const SWAGGER_UI_TEMPLATE = `<link rel="stylesheet" href="https://cb-docs-swagger.s3.amazonaws.com/dist3/swagger-ui.css">
<script src="https://cb-docs-swagger.s3.amazonaws.com/dist3/swagger-ui-bundle.js"></script>
<script src="https://cb-docs-swagger.s3.amazonaws.com/dist3/swagger-ui-standalone-preset.js"></script>
<script>
window.ui = SwaggerUIBundle({
  url: "%URL%",
  dom_id: "#swagger-ui",
  deepLinking: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  plugins: [SwaggerUIBundle.plugins.DownloadUrl],
  layout: "StandaloneLayout",
  tagsSorter: "alpha",
  operationsSorter: "alpha",
  docExpansion: "none",
})
</script>`

function blockSwaggerUiMacro () {
  this.process((parent, target, attrs) => {
    const headerAttrs = parent.getDocument().header_attributes
    Opal.hash_put(headerAttrs, 'page-content-scripts', SWAGGER_UI_TEMPLATE.replace('%URL%', target))
    return this.createBlock(parent, 'open', [], { id: 'swagger-ui' })
  })
}

function register (registry, context) {
  registry.blockMacro('swagger_ui', blockSwaggerUiMacro)
}

module.exports.register = register
