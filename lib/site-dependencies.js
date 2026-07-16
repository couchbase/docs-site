'use strict'

const path = require('path')
const { navigationDataPath, jsonPathFor, findFile, buildJsonFile } = require('./site-navigation-data-json')
const { resolveBranchSha } = require('./git-remote-refs')

const cvs = {}
const origins = {}

const GLOB_RX = /[*?{}[\]!]/
// kept modest given past GitHub gateway ECONNRESET issues under heavy concurrency (see
// runtime.fetch_concurrency: 1 in the playbook) - ls-remote is much lighter than a real
// fetch, but there's no evidence yet on how it behaves under load, so stay conservative
const LS_REMOTE_CONCURRENCY = 4

module.exports.register = function ({playbook}) {

  if ('quick-build' in playbook.asciidoc.attributes) {
    setup_quick_build(this, playbook)
  }
  else {
    setup(this)
  }
}

function setup_quick_build(antora, playbook) {

  // NOTE: not awaited here - Antora's extension loader calls register() without awaiting it
  // (see @antora/site-generator/lib/generator-context.js _registerExtensions), so if we
  // awaited this fetch before registering any listeners, 'playbookBuilt' (which fires very
  // early) could come and go before we got around to listening for it. Every listener below
  // must be registered synchronously, before any await; each awaits this promise itself once
  // it actually needs the data.
  const fullJsonPromise = fetch(`${playbook.site.url}/site-dependencies.json`).then((res) => res.json())

  // before Antora fetches anything, drop content sources/branches we can confirm are
  // unchanged since the last full build, so we skip both the fetch and the (much more
  // expensive) per-branch tree-walk/file-read Antora does for everything it does fetch
  antora.once('playbookBuilt', async ({ playbook }) => {
    try {
      const fullJson = await fullJsonPromise
      await pruneUnchangedSources(playbook, fullJson)
      antora.updateVariables({ playbook })
    } catch (err) {
      console.warn('quick-build: could not prune unchanged content sources via ls-remote, fetching everything:', err)
    }
  })

  const navPath = navigationDataPath(playbook)
  const navJsonPath = jsonPathFor(navPath)

  // requires ./site-navigation-data-json.js to have already run (registered earlier in the
  // playbook's extensions list, right after "@antora/site-generator-ms"), so the local
  // subset's nav data is available here as clean JSON rather than eval-able JS
  antora.once('beforePublish', async ({ siteCatalog }) => {
    const localNavFile = siteCatalog.getFiles().find(f => f.out && f.out.path === navPath)
    const localNavJsonFile = findFile(siteCatalog, navJsonPath)
    // e.g. export-site-navigation-data isn't enabled for this build
    if (!localNavFile || !localNavJsonFile) return

    try {
      const fullNavRes = await fetch(`${playbook.site.url}/${navJsonPath}`)
      const fullNav = await fullNavRes.json()
      const localNav = JSON.parse(localNavJsonFile.contents.toString())
      const merged = mergeNavigationData(fullNav, localNav)
      localNavFile.contents = Buffer.from(`siteNavigationData=${JSON.stringify(merged)}\n`)
      localNavJsonFile.contents = buildJsonFile(navPath, merged).contents
    } catch (err) {
      // don't fail the whole build if the primary site's nav data can't be fetched/merged;
      // worst case the partial build's nav just reflects the rebuilt subset
      console.warn('could not merge site-navigation-data.js with primary site:', err)
    }
  })

  antora.once('contentAggregated', async ({ contentAggregate }) => {
    const fullJson = await fullJsonPromise

    const collatedOrigins = new Set(['https://github.com/couchbase/docs-site@master:home'])

    for (const cv of contentAggregate) {
      const cvKey = `${cv.name}@${cv.version}`
      for (const o of cv.origins) {
        const sha = o.refhash || null
        const oKey = repoKey(o)
        const oV = fullJson.origins[oKey]
        if (!oV) {
          // no recorded baseline - a source/branch that didn't exist as of the last full
          // build, so there's nothing to compare against; always keep it (same conservative
          // "unknown -> keep" rule pruneUnchangedSources uses pre-fetch)
          collatedOrigins.add(oKey)
          continue
        }
        const {cv: cvFullKey, refhash} = oV
        if (sha !== refhash) {
          collatedOrigins.add(oKey)
          const cvFull = fullJson.cvs[cvFullKey]
          if (cvFull) {
            for (const addO of [...cvFull.origins, ...cvFull.dependencies]) {
              collatedOrigins.add(addO)
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

async function pruneUnchangedSources (playbook, fullJson) {
  const sources = playbook.content.sources
  const defaultBranches = playbook.content.branches

  // resolve every source's branch list up front; sources we can't safely resolve (globs,
  // HEAD/'.', or the local docs-site source itself) are left untouched, origins unknown
  const bySource = new Map() // source -> [{ branch, originKeys }]
  for (const source of sources) {
    if (source.url === '.') continue
    const branches = normalizeBranchList(source.branches ?? defaultBranches)
    if (!branches) continue
    const startPaths = source.start_paths || [source.start_path]
    bySource.set(
      source,
      branches.map((branch) => ({
        branch,
        originKeys: startPaths.map((startPath) => repoKey({ url: source.url, refname: branch, startPath })),
      }))
    )
  }

  // one ls-remote-equivalent call per (url, branch), each server-side filtered to that exact
  // ref via isomorphic-git's `prefix`, so it stays cheap even for repos with huge branch counts
  const branchChecks = [...bySource.entries()].flatMap(([source, branchEntries]) =>
    branchEntries.map(({ branch, originKeys }) => ({ source, branch, originKeys }))
  )
  await runWithConcurrency(branchChecks, LS_REMOTE_CONCURRENCY, async (check) => {
    try {
      check.sha = await resolveBranchSha(check.source.url, check.branch, playbook)
    } catch (err) {
      console.warn(`quick-build: ls-remote failed for ${check.source.url}#${check.branch}, will fetch it normally: ${err.message}`)
    }
  })

  const changed = new Set()
  for (const { sha, originKeys } of branchChecks) {
    for (const oKey of originKeys) {
      const recorded = fullJson.origins[oKey]
      // no sha (ls-remote failed/branch gone) or no recorded baseline -> can't confirm
      // unchanged, so treat as changed and let Antora fetch it normally
      if (!sha || !recorded || recorded.refhash !== sha) changed.add(oKey)
    }
  }

  // expand via the same component-version origins/dependencies graph the post-fetch filter
  // in the contentAggregated handler above uses, so a changed origin also pulls in the rest
  // of its component version and anything that component version reads from
  for (const oKey of [...changed]) {
    const cvKey = fullJson.origins[oKey]?.cv
    const cvFull = cvKey && fullJson.cvs[cvKey]
    if (cvFull) for (const addO of [...cvFull.origins, ...cvFull.dependencies]) changed.add(addO)
  }

  let prunedBranches = 0
  let prunedSources = 0
  const keptSources = []
  const keptLabels = []
  const prunedLabels = []
  for (const source of sources) {
    const branchEntries = bySource.get(source)
    if (!branchEntries) {
      keptSources.push(source)
      continue
    }

    for (const { branch, originKeys } of branchEntries) {
      const label = `${repoLabel(source.url)}#${branch}`
      ;(originKeys.some((k) => changed.has(k)) ? keptLabels : prunedLabels).push(label)
    }

    const keepBranches = branchEntries.filter(({ originKeys }) => originKeys.some((k) => changed.has(k)))
    prunedBranches += branchEntries.length - keepBranches.length
    if (keepBranches.length) {
      keptSources.push(
        keepBranches.length === branchEntries.length
          ? source
          : Object.assign({}, source, { branches: keepBranches.map((b) => b.branch) })
      )
    } else {
      prunedSources++
    }
  }

  const totalBranches = branchChecks.length
  console.log(
    `quick-build: ls-remote checked ${totalBranches} branch(es); pruned ${prunedBranches} unchanged ` +
      `(${prunedSources} content source(s) dropped entirely), kept ${totalBranches - prunedBranches}`
  )
  console.log(`quick-build: kept -> ${keptLabels.sort().join(', ')}`)
  console.log(`quick-build: pruned -> ${prunedLabels.sort().join(', ')}`)
  playbook.content.sources = keptSources
}

function repoLabel (url) {
  return path.basename(url.replace(/\.git$/, ''))
}

function normalizeBranchList (branches) {
  if (branches == null) return null
  const list = Array.isArray(branches) ? branches.map(String) : String(branches).split(/\s*,\s*/)
  if (list.some((b) => b === 'HEAD' || b === '.' || GLOB_RX.test(b))) return null
  return list
}

async function runWithConcurrency (items, limit, fn) {
  let i = 0
  async function worker () {
    while (i < items.length) await fn(items[i++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
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
