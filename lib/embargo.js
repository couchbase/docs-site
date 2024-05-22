module.exports.register = function ({ config }) {
  const logger = this.getLogger('embargo-extension')
  this
    .on('navigationBuilt', ({ contentCatalog }) => {
      contentCatalog.getComponents().forEach(({ versions }) => {
        versions.forEach(({ name: component, version, navigation: nav, url: defaultUrl }) => {
          contentCatalog
            .findBy({ component, version, family: 'page' })
            .filter((page) => page.out)
            .forEach((page) => {
              if (page.asciidoc.attributes['page-embargo'] != null) {
                console.log("Embargoed", page.pub.url, page.asciidoc.attributes['page-embargo'])
                contentCatalog.removeFile(page)
              }
            })
        })
      })
    })
}




