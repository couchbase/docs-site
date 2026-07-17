'use strict'

const path = require('path')
const { navigationDataPath, jsonPathFor, findFile, buildJsonFile } = require('./site-navigation-data-json')
const { resolveBranchSha } = require('./git-remote-refs')
const { resolvePathTreeOid } = require('./git-local-tree')
const { resolveRemotePathTreeOid } = require('./github-tree')

const cvs = {}
const origins = {}

const GLOB_RX = /[*?{}[\]!]/
// kept modest given past GitHub gateway ECONNRESET issues under heavy concurrency (see
// runtime.fetch_concurrency: 1 in the playbook) - ls-remote is much lighter than a real
// fetch, but there's no evidence yet on how it behaves under load, so stay conservative
const LS_REMOTE_CONCURRENCY = 4

// content sources where the branch-tip commit SHA alone is a useless "did the docs change"
// signal, because the repo is a busy monorepo with lots of unrelated activity (e.g.
// couchbase-cloud) - these get a path-scoped tree-hash check on the prune side instead of the
// plain branch-tip comparison everything else uses. Deliberately a short, explicit allowlist:
// the GitHub API call this requires has real overhead, so it's opt-in, not the default.
const PATH_AWARE_SOURCES = new Set(['https://github.com/couchbasecloud/couchbase-cloud'])

module.exports.register = function ({playbook}) {

  if ('quick-build' in playbook.asciidoc.attributes) {
    setup_quick_build(this, playbook)
  }
  else {
    setup(this, playbook)
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

function setup(antora, playbook) {
  // we are doing a full build, so need to attach all the handlers
  // to *generate* the dependencies file
  antora.once('contentClassified', ({ contentCatalog }) => {
    antora.updateVariables({ contentCatalog: trackingContentCatalog(contentCatalog, record) })
  })

  antora.once('beforePublish', ({ siteCatalog }) => {
    const depsFile = createDependenciesFile({ cvs, origins })
    siteCatalog.addFile(depsFile)
  })

  antora.once('contentAggregated', async ({ contentAggregate }) => {

    for (const cv of contentAggregate) {
      const cvKey = `${cv.name}@${cv.version}`

      cvs[cvKey] = {
        dependencies: new Set(),
        origins: await Promise.all(cv.origins.map(async (o) => {
          const oKey = repoKey(o)
          const entry = { refhash: o.refhash || null, cv: cvKey }
          if (o.startPath) {
            // free on this (full-build) side - the repo's already cloned locally by Antora,
            // so we can read the path's content-addressed tree hash straight off disk. This
            // is what lets the prune side later distinguish "this start_path actually changed"
            // from "the branch tip moved because of unrelated monorepo activity" for sources
            // in PATH_AWARE_SOURCES (see pruneUnchangedSources)
            try {
              entry.pathTreeHash = await resolvePathTreeOid({ playbook, url: o.url, oid: o.refhash, path: o.startPath })
            } catch (err) {
              console.warn(`could not resolve local path tree hash for ${oKey}:`, err.message)
            }
          }
          // side-effect: populate origins map
          origins[oKey] = entry
          return oKey
        }))
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
  const bySource = new Map() // source -> [{ branch, origins: [{ startPath, key }] }]
  for (const source of sources) {
    if (source.url === '.') continue
    const branches = normalizeBranchList(source.branches ?? defaultBranches)
    if (!branches) continue
    // NOTE: Antora's playbook-builder renames the YAML's start_path/start_paths (snake_case)
    // to startPath/startPaths (camelCase) on the resolved playbook - reading the snake_case
    // names here silently returns undefined, dropping the start path from the origin key
    const startPaths = source.startPaths || [source.startPath]
    bySource.set(
      source,
      branches.map((branch) => ({
        branch,
        origins: startPaths.map((startPath) => ({
          startPath,
          key: repoKey({ url: source.url, refname: branch, startPath }),
        })),
      }))
    )
  }

  // one ls-remote-equivalent call per (url, branch), each server-side filtered to that exact
  // ref via isomorphic-git's `prefix`, so it stays cheap even for repos with huge branch counts
  const branchChecks = [...bySource.entries()].flatMap(([source, branchEntries]) =>
    branchEntries.map(({ branch, origins: originList }) => ({ source, branch, origins: originList }))
  )
  console.log(`quick-build: checking ${branchChecks.length} branch(es) via ls-remote...`)
  await runWithConcurrency(branchChecks, LS_REMOTE_CONCURRENCY, async (check) => {
    const label = `${check.source.url}#${check.branch}`
    try {
      check.sha = await resolveBranchSha(check.source.url, check.branch, playbook)
      if (check.sha) {
        console.log(`quick-build: ls-remote ${label} -> ${check.sha}`)
      } else {
        // resolveBranchSha can resolve successfully with no matching ref (e.g. the branch is
        // gone, or the remote returned an empty ref list) - this does NOT throw, so without
        // this line it would silently look identical to "confirmed unchanged" in the logs
        console.warn(`quick-build: ls-remote ${label} -> resolved with no matching ref, treating as changed`)
      }
    } catch (err) {
      console.warn(`quick-build: ls-remote failed for ${label}, will fetch it normally: ${err.message}`)
    }
  })

  // originNote records *why* every origin ended up in whatever bucket it did - both logged
  // immediately below, and reused later to annotate each kept/pruned branch in the summary
  const originNote = new Map() // oKey -> 'unchanged' | 'unchanged-path' | 'no-baseline' | 'changed-sha' | 'changed-path' | 'sibling-in-cv:<cvKey>'
  for (const { source, sha, origins: originList } of branchChecks) {
    for (const { startPath, key: oKey } of originList) {
      const recorded = fullJson.origins[oKey]
      let note
      if (PATH_AWARE_SOURCES.has(source.url) && startPath) {
        note = await resolvePathAwareNote({ playbook, url: source.url, sha, startPath, recorded, oKey })
      } else {
        note = !recorded ? 'no-baseline' : !sha || recorded.refhash !== sha ? 'changed-sha' : 'unchanged'
      }
      originNote.set(oKey, note)
      console.log(`quick-build: ${oKey} -> ${note} (recorded=${recorded?.refhash ?? '<none>'}, current=${sha ?? '<none>'})`)
    }
  }
  const directlyChanged = new Set(
    [...originNote].filter(([, note]) => note !== 'unchanged' && note !== 'unchanged-path').map(([oKey]) => oKey)
  )
  const changed = new Set(directlyChanged)

  // expand via the same component-version origins/dependencies graph the post-fetch filter
  // in the contentAggregated handler above uses, so a changed origin also pulls in the rest
  // of its component version and anything that component version reads from - this can pull
  // in origins that are themselves unchanged, if they share a cv with one that isn't
  for (const oKey of [...directlyChanged]) {
    const cvKey = fullJson.origins[oKey]?.cv
    const cvFull = cvKey && fullJson.cvs[cvKey]
    if (!cvFull) continue
    for (const addO of [...cvFull.origins, ...cvFull.dependencies]) {
      if (!changed.has(addO)) {
        console.log(`quick-build: ${addO} -> sibling-in-cv:${cvKey} (pulled in because ${oKey} is ${originNote.get(oKey)})`)
        originNote.set(addO, `sibling-in-cv:${cvKey}`)
      }
      changed.add(addO)
    }
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

    for (const { branch, origins: originList } of branchEntries) {
      const label = `${repoLabel(source.url)}#${branch}`
      const keys = originList.map((o) => o.key)
      if (keys.some((k) => changed.has(k))) {
        const reason = keys.map((k) => originNote.get(k)).find((n) => n && n !== 'unchanged' && n !== 'unchanged-path') || 'unknown'
        keptLabels.push(`${label} [${reason}]`)
      } else {
        prunedLabels.push(label)
      }
    }

    const keepBranches = branchEntries.filter(({ origins: originList }) => originList.some((o) => changed.has(o.key)))
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

// for PATH_AWARE_SOURCES: compares the path's tree hash (via GitHub's API, no clone) against
// what the last full build recorded locally for that same path, instead of the branch-tip
// commit SHA - see ./github-tree.js and ./git-local-tree.js for why these are comparable
async function resolvePathAwareNote ({ playbook, url, sha, startPath, recorded, oKey }) {
  if (!sha) return 'changed-sha' // couldn't resolve the branch tip at all
  if (!recorded || !recorded.pathTreeHash) return 'no-baseline'
  try {
    const remoteTreeOid = await resolveRemotePathTreeOid(url, sha, startPath, playbook)
    return remoteTreeOid && remoteTreeOid === recorded.pathTreeHash ? 'unchanged-path' : 'changed-path'
  } catch (err) {
    console.warn(`quick-build: path-aware check failed for ${oKey}, treating as changed: ${err.message}`)
    return 'changed-path'
  }
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
