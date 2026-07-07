'use strict'

const cvs = {}

module.exports.register = function () {
  // '8.0@docs-server' -> Set of '8.0@docs-devex'
  this.once('contentClassified', ({ contentCatalog }) => {
    this.updateVariables({ contentCatalog: trackingContentCatalog(contentCatalog, record) })
  })

  this.once('beforePublish', ({ siteCatalog }) => {
    const depsFile = createDependenciesFile(cvs)
    siteCatalog.addFile(depsFile)
  })

  this.once('contentAggregated', ({ contentAggregate }) => {

    for (const cv of contentAggregate) {
      const cvKey = `${cv.name}@${cv.version}`
      const origins = Object.fromEntries(
        cv.origins.map(o => [repoKey(o), o.refhash || null]))

      cvs[cvKey] = { origins, dependencies: new Set() }
    }

    // compare repos[].sha against your persisted previous-build record
  })

}

function repoKey ({ url, refname, startPath }) {
  return `${url}@${refname}${startPath ? ':' + startPath : ''}`
}

function record (from, to) {
  if (!to.origin) return // stub/synthetic files (e.g. Atlas-imported pages) carry no origin

  const fromKey = `${from.component}@${from.version}`
  const toKey = repoKey(to.origin)

  cvs[fromKey].dependencies.add(toKey)
}

function trackingContentCatalog (contentCatalog, record) {
  return new Proxy(contentCatalog, {
    get (target, property) {
      if (property !== 'resolveResource') return target[property]
      return (spec, context, defaultFamily, permittedFamilies) => {
        const resolved = target.resolveResource(spec, context, defaultFamily, permittedFamilies)

        // we explicitly don't want to handle 'page', as those are already
        // dealt with by Atlas
        if (resolved && resolved.src && resolved.src.family !== 'page') {
          record(context, resolved.src)
        }
        return resolved
      }
    },
  })
}

const replacer = function (k, v) {
  if (v instanceof Set) {
    return Array.from(v)
  }
  else {
    return v
  }
}

function createDependenciesFile (data) {
  const contents = JSON.stringify(data, replacer, 2) + '\n'
  return {
    contents: Buffer.from(contents),
    mediaType: 'application/json',
    out: { path: 'site-dependencies.json' },
    path: 'site-dependencies.json',
    pub: { url: '/site-dependencies.json', rootPath: '' },
    src: { stem: 'site-dependencies' },
  }
}
