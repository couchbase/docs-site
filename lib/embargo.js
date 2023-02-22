module.exports.register = function ({ config }) {
  const logger = this.getLogger('embargo-extension')
  this
    .on('navigationBuilt', ({ contentCatalog }) => {
      contentCatalog.getComponents().forEach(({ versions }) => {
        versions.forEach(({ name: component, version, navigation: nav, url: defaultUrl }) => {
          contentCatalog
            .findBy({ component, version, family: 'page' })
            .filter((page) => page.out)
            .filter((page) => page.pub)
            .forEach((page) => {
              if (page.asciidoc.attributes['page-embargo'] != null) {
                const url = page.pub ? page.pub.url : '(unknown url)'
                console.log("Embargoed", url, page.asciidoc.attributes['page-embargo'])
                delete page.pub
                delete page.out
                // contentCatalog.removeFile(page)
              }

            })
        })
      })
    })
}




