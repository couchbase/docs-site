const buildSwaggerUi = ({ specUrl, bundleUrl }) => `<link rel="stylesheet" href="${bundleUrl}/swagger-ui.css">
<script src="${bundleUrl}/swagger-ui-bundle.js"></script>
<script src="${bundleUrl}/swagger-ui-standalone-preset.js"></script>
<script id="swagger-ui-script" data-url="${specUrl}">
;(function (config) {
  var initialHash = window.location.hash
  var jumpToAnchorOnLoad = function () {
    if (this.querySelector('.swagger-ui .swagger-ui')) {
      var targetHash, targetId
      if (initialHash.charAt(1) === '/') {
        targetId = 'operations' + (initialHash.lastIndexOf('/') === 1 ? '-tag' : '') + initialHash.slice(1).replace(/[/]/g, '-')
      } else {
        targetHash = initialHash
      }
      Array.prototype.slice.call(this.querySelectorAll('.opblock-tag[id], .opblock[id]')).forEach(function (el) {
        var id = el.id
        el.removeAttribute('id')
        if (targetId === id) targetHash = '#' + targetId
        if (el.tagName === 'H4') {
          el.parentNode.id = id
        } else {
          var wrapper = document.createElement('div')
          wrapper.id = id
          el.parentNode.insertBefore(wrapper, el)
          wrapper.appendChild(el)
        }
      })
      if (targetHash) {
        setTimeout(function () {
          window.location.hash = targetHash
          if (targetId) window.history.pushState(null, null, initialHash)
        }, 1250)
      }
    } else {
      requestAnimationFrame(jumpToAnchorOnLoad)
    }
  }.bind(document.getElementById('swagger-ui'))
  SwaggerUIBundle({
    url: config.url,
    dom_id: '#swagger-ui',
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    plugins: [SwaggerUIBundle.plugins.DownloadUrl],
    layout: 'StandaloneLayout',
    tagsSorter: 'alpha',
    operationsSorter: 'alpha',
    docExpansion: 'none',
  })
  if (initialHash && (initialHash.charAt(1) !== '/' || initialHash.length > 2)) {
    if (initialHash.charAt(1) !== '/') window.location.hash = ''
    jumpToAnchorOnLoad()
  }
})(document.getElementById('swagger-ui-script').dataset)
</script>`

function blockSwaggerUiMacro ({ file }) {
  return function () {
    this.process((parent, specUrl, attrs) => {
      const doc = parent.getDocument()
      if (~specUrl.indexOf('{')) {
        specUrl = doc.$sub_attributes(specUrl, Opal.hash({ attribute_missing: 'drop-line' }))
        if (!specUrl) return
      }
      const bundleUrl = specUrl.startsWith('https://s3.amazonaws.com/cb-docs-swagger/')
        ? 'https://cb-docs-swagger.s3.amazonaws.com/dist3'
        : 'https://couchbase-docs.s3.amazonaws.com/assets/swagger-ui-3.7'
      const contentScripts = buildSwaggerUi({ specUrl, bundleUrl })
      file.asciidoc.attributes['page-content-scripts'] = contentScripts
      return this.createBlock(parent, 'pass', '<div id="swagger-ui"></div>')
    })
  }
}

function register (registry, context) {
  registry.blockMacro('swagger_ui', blockSwaggerUiMacro(context))
}

module.exports.register = register
