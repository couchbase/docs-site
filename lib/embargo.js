module.exports.register = function ({ config }) {
  const logger = this.getLogger('embargo-extension')
  this
    .on('navigationBuilt', ({ contentCatalog }) => {
      console.log("navigationBuilt")
      const components = contentCatalog.getComponents()
      console.log("components", components)
      components.forEach(({ versions }) => {
        console.log("versions", versions)
        versions.forEach(({ name: component, version }) => {
          console.log("Version", component, version)
          contentCatalog
            .findBy({ component, version, family: 'page' })
            .filter((page) => page.out)
            .filter((page) => page.pub)
            .forEach((page) => {
              console.log("Page", page)
              if (page.asciidoc.attributes['page-embargo'] != null) {
                console.log("Embargoed!")
                if (page.pub) {
                    console.log("Embargo", page.pub.url, page.asciidoc.attributes['page-embargo'])
                } else {
                    console.log("Embargo (unknown page?)")
                }
                delete page.pub
                delete page.out
                // contentCatalog.removeFile(page)
              }

            })
        })
      })
    })
}




