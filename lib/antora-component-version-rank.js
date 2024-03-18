/*
 * set the :page-version-rank: variable for each component, such that:
 *
 * current = 1
 * older   = 2
 * older   = 3
 * ...
 * 
 * This variable will be composited into <meta name="docsearch:version-rank">
 * and picked up by Algolia, to configure search results to prefer more recent 
 * versions.
 */

module.exports.register = function () {
  this.once('contentClassified', ({ playbook, contentCatalog }) => {
    contentCatalog.getComponents().forEach((component) => {
      component.versions.forEach((componentVersion, index) => {
        const version_rank = index + 1
        // console.log(`${componentVersion.version}@${componentVersion.name}version-rank ${version_rank}`)

        // replace .asciidoc with a version that contains the new variable.
        // (because by default, the .asciidoc instance is shared.)
        componentVersion.asciidoc = { 
          ...componentVersion.asciidoc, 
          attributes: {
            ...componentVersion.asciidoc.attributes,
            'page-version-rank': version_rank
          }
        }
      })
    })
  })
}
