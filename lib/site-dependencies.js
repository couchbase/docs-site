'use strict'

const cvs = {}
const origins = {}

module.exports.register = async function ({playbook}) {

  if ('quick-build' in playbook.asciidoc.attributes) {
    await setup_quick_build(this, playbook)
  }
  else {
    setup(this)
  }
}

async function setup_quick_build(antora, playbook) {

  const full = await fetch(`${playbook.site.url}/site-dependencies.json`)
  const fullJson = await full.json()

  antora.once('contentAggregated', ({ contentAggregate }) => {

    const collatedOrigins = new Set(['https://github.com/couchbase/docs-site@master:home'])

    for (const cv of contentAggregate) {
      const cvKey = `${cv.name}@${cv.version}`
      for (const o of cv.origins) {
        const sha = o.refhash || null
        const oKey = repoKey(o)
        const oV = fullJson.origins[oKey]
        if (oV) {
          const {cv, refhash} = oV
          if (sha !== refhash) {
            collatedOrigins.add(oKey)
            const cvFull = fullJson.cvs[cv]
            if (cvFull) {
              console.log(cvFull)
              for (const addO of [...cvFull.origins, ...cvFull.dependencies]) {
                collatedOrigins.add(addO)
              }
            }
          }
        }
      }
    }
    console.log(collatedOrigins)
    const newContentAggregate = []
    for (const cv of contentAggregate) {
      cv.origins = cv.origins.filter(o => {
        const oKey = repoKey(o)
        return collatedOrigins.has(oKey)
      })
      
      if (cv.origins.length) {
        newContentAggregate.push(cv)
      }
    }
    console.log({newContentAggregate})
    antora.updateVariables({ contentAggregate: newContentAggregate })
  })
}

function setup(antora) {
  // we are doing a full build, so need to attach all the handlers
  // to *generate* the dependencies file
  antora.once('contentClassified', ({ contentCatalog }) => {
    antora.updateVariables({ contentCatalog: trackingContentCatalog(contentCatalog, record) })
  })

  antora.once('beforePublish', ({ siteCatalog }) => {
    const depsFile = createDependenciesFile({ cvs, origins })
    siteCatalog.addFile(depsFile)
  })

  antora.once('contentAggregated', ({ contentAggregate }) => {

    for (const cv of contentAggregate) {
      const cvKey = `${cv.name}@${cv.version}`

      cvs[cvKey] = {
        dependencies: new Set(),
        origins: cv.origins.map(o => {
          const oKey = repoKey(o)
          // side-effect: populate origins map
          origins[oKey] = {
            refhash: o.refhash || null,
            cv: cvKey
          }
          return oKey
        })
      }
    }

    // compare repos[].sha against your persisted previous-build record
  })

}

function repoKey ({ url, refname, startPath }) {
  return `${url}@${refname}${startPath ? ':' + startPath : ''}`.replace('.git', '')
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
