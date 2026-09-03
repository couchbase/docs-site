'use strict'

/*
 * Redirects legacy/renamed component names to a current component's URL, driven
 * entirely by playbook config - no antora.yml change needed in the content repo,
 * so a rename doesn't require touching every branch/version of it. We don't
 * support redirecting individual versions of a component: if a single version
 * needed a different URL, that's a new product in a new component, not a rename.
 *
 * Configure as:
 *
 *   antora:
 *     extensions:
 *     - require: ./lib/override-url-component.js
 *       map:
 *         operational-insights: [analytics, columnar]
 *
 * Every `from` name always gets a whole-prefix redirect, `/<from>/* -> /<to>/*`,
 * with no attempt to distinguish versions - see addLegacyAlias() below. This is
 * the moral equivalent of ContentCatalog#addSplatAlias, inlined because
 * addSplatAlias requires a non-empty version segment on the "from" side
 * (content-catalog.js: "cannot map splat alias from empty version segment"),
 * which a retired/unversioned name doesn't have - and since we're redirecting
 * the whole component regardless of version anyway, we don't need any of its
 * version bookkeeping.
 *
 * If `from` is ALSO still a live, registered component in this build (e.g.
 * `analytics`, mid-rename, still producing real content), its own
 * page/image/attachment files are republished under the target URL segment on
 * top of that, without touching the component's registered name - so
 * xrefs/includes against it keep resolving normally. This is Dan Allen's
 * ContentCatalog#createFile trick - see remapLiveComponent() below, and
 * https://antora.zulipchat.com/#narrow/channel/282400-users/topic/.22Fun.22.20renaming.20components/with/619594674
 * Both apply together because remapping a live component's files moves them to
 * new URLs outright, rather than aliasing the old ones - so the whole-prefix
 * redirect is still the only thing that catches a bookmark to one of its old
 * per-page URLs.
 *
 * Nothing needs to change here when a name flips from live to retired - e.g.
 * once `analytics` itself is retired in favour of a real `operational-insights`
 * component, this same map entry keeps working, just via the whole-prefix
 * redirect alone.
 *
 * The whole-prefix redirects only take effect for redirect facilities that
 * support wildcard rules (nginx, netlify, gitlab, httpd) - not the default
 * `static` facility, which can only produce one bounce page per exact URL. Local
 * preview builds use `static`, so they won't see these; the public/test builds
 * use nginx, so they will.
 */

module.exports.register = function ({ config }) {
  const map = config.map || {}

  this.once('contentClassified', ({ contentCatalog }) => {
    for (const [to, froms] of Object.entries(map)) {
      for (const from of Array.isArray(froms) ? froms : [froms]) {
        if (contentCatalog.getComponent(from)) remapLiveComponent(contentCatalog, from, to)
        addLegacyAlias(contentCatalog, from, to)
      }
    }
  })
}

function remapLiveComponent (contentCatalog, from, to) {
  contentCatalog.getComponent(from).versions.forEach((componentVersion) => {
    const oldStartPageUrl = componentVersion.url
    const files = contentCatalog.findBy({ component: from, version: componentVersion.version })
    files.forEach((file) => {
      const family = file.src.family
      // only page, image, and attachment families get an out/pub path; leave
      // alias, nav, partial, and example files alone
      if (family !== 'page' && family !== 'image' && family !== 'attachment') return
      const wasStartPage = file.pub && file.pub.url === oldStartPageUrl
      // ContentCatalog#createFile only computes out/pub when the file doesn't
      // already have them, so build a throwaway mock with the swapped component
      // and lift its computed out/pub onto the real file instead of mutating
      // file.src.component (which would break xref/include resolution)
      const mockSrc = Object.assign({}, file.src, { component: to })
      delete mockSrc.componentVersion
      const mock = contentCatalog.createFile({ src: mockSrc })
      file.out = mock.out
      file.pub = mock.pub
      // componentVersion.url is captured from the start page at registration
      // time, before this handler runs, so it still points at the old URL
      if (wasStartPage) componentVersion.url = file.pub.url
    })
  })
}

function addLegacyAlias (contentCatalog, from, to) {
  const baseSrc = { module: 'ROOT', family: 'alias', relative: '', basename: '', stem: '', extname: '' }
  const fromSrc = Object.assign({ component: from, version: '' }, baseSrc)
  const toSrc = Object.assign({ component: to, version: '' }, baseSrc)
  return contentCatalog.addFile({
    src: fromSrc,
    pub: { url: '/' + from, splat: true },
    rel: { src: toSrc, pub: { url: '/' + to, splat: true } },
  })
}
