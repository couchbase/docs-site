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

  const navPath = playbook.asciidoc.attributes['site-navigation-data-path'] || 'site-navigation-data.js'

  antora.once('beforePublish', async ({ siteCatalog }) => {
    const localNavFile = siteCatalog.getFiles().find(f => f.out && f.out.path === navPath)
    // e.g. export-site-navigation-data isn't enabled for this build
    if (!localNavFile) return

    try {
      const fullNavRes = await fetch(`${playbook.site.url}/${navPath}`)
      const fullNav = parseNavigationData(await fullNavRes.text())
      const localNav = parseNavigationData(localNavFile.contents.toString())
      const merged = mergeNavigationData(fullNav, localNav)
      localNavFile.contents = Buffer.from(`siteNavigationData=${JSON.stringify(merged)}\n`)
    } catch (err) {
      // don't fail the whole build if the primary site's nav data can't be fetched/merged;
      // worst case the partial build's nav just reflects the rebuilt subset
      console.warn('could not merge site-navigation-data.js with primary site:', err)
    }
  })

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

function parseNavigationData (js) {
  const match = js.match(/^siteNavigationData\s*=\s*(.+)$/s)
  if (!match) throw new Error('unexpected site-navigation-data.js format')
  // this file is created by @antora/site-generator-ms (see export-site-navigation-data.js)
  // eslint-disable-next-line no-eval
  return eval(match[1])
}

// merge a locally (re)built subset of siteNavigationData into the full/primary site's copy,
// so a partial build's nav still shows every component, not just the ones it rebuilt
function mergeNavigationData (full, local) {
  const localByName = new Map(local.map(c => [c.name, c]))
  const merged = full.map(c => {
    const localC = localByName.get(c.name)
    if (!localC) return c
    localByName.delete(c.name)
    return mergeNavigationComponent(c, localC)
  })
  // components that don't exist yet in the primary site at all
  merged.push(...localByName.values())
  return merged
}

function mergeNavigationComponent (fullC, localC) {
  const versions = fullC.versions.slice()
  for (const localV of localC.versions) {
    const idx = versions.findIndex(v => v.version === localV.version)
    if (idx === -1) versions.push(localV)
    else versions[idx] = localV
  }
  return { ...fullC, versions }
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
