'use strict'

/*
 * Lets a component publish under a different URL segment than its registered
 * component name, without renaming the component itself. xrefs, includes, and
 * nav all keep resolving against the real component name (e.g. `analytics:`);
 * only the published out/pub paths (and therefore the site URLs) change.
 *
 * Opt in per component version by setting :override-url-component: in antora.yml:
 *
 *   asciidoc:
 *     attributes:
 *       override-url-component: operational-insights
 *
 * Sketch for the Analytics -> Operational Insights rename. See discussion:
 * https://antora.zulipchat.com/#narrow/channel/282400-users/topic/.22Fun.22.20renaming.20components/with/619594674
 *
 * Requires Antora >= 3.2.0 (ContentCatalog#createFile).
 */

module.exports.register = function () {
  this.once('contentClassified', ({ contentCatalog }) => {
    contentCatalog.getComponents().forEach((component) => {
      component.versions.forEach((componentVersion) => {
        const overrideComponent = componentVersion.asciidoc?.attributes?.['override-url-component']
        if (!overrideComponent) return
        const oldStartPageUrl = componentVersion.url
        const files = contentCatalog.findBy({ component: component.name, version: componentVersion.version })
        files.forEach((file) => {
          const family = file.src.family
          // only page, image, and attachment families get an out/pub path; leave
          // alias, nav, partial, and example files alone
          if (family !== 'page' && family !== 'image' && family !== 'attachment') return
          const wasStartPage = file.pub && file.pub.url === oldStartPageUrl
          // ContentCatalog#createFile only computes out/pub when the file doesn't
          // already have them, so build a throwaway mock with the overridden
          // component and lift its computed out/pub onto the real file instead of
          // mutating file.src.component (which would break xref/include resolution)
          const mockSrc = Object.assign({}, file.src, { component: overrideComponent })
          delete mockSrc.componentVersion
          const mock = contentCatalog.createFile({ src: mockSrc })
          file.out = mock.out
          file.pub = mock.pub
          // componentVersion.url is captured from the start page at registration
          // time, before this handler runs, so it still points at the old URL
          if (wasStartPage) componentVersion.url = file.pub.url
        })
      })
    })
  })
}
