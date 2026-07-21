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

  // populated by the contentAggregated handler below, consumed by the contentClassified
  // handler below it - component-versions kept only because something else include::s/
  // image::s from them, not because they themselves changed (see classifyCvStatus)
  let orphanCvKeys = new Set()

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
    // these two merges are independent - neither should be skipped just because the other's
    // files happen to be missing, so each guards and errors only around its own work
    const localNavFile = siteCatalog.getFiles().find(f => f.out && f.out.path === navPath)
    const localNavJsonFile = findFile(siteCatalog, navJsonPath)
    if (localNavFile && localNavJsonFile) {
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
    } // else: e.g. export-site-navigation-data isn't enabled for this build

    // same problem as site-navigation-data.js: @antora/site-generator-ms's own beforePublish
    // hook builds site-manifest.json from just this build's (locally-classified) contentCatalog,
    // so a quick build's manifest would otherwise only cover what it actually rebuilt - breaking
    // xref resolution against the rest of the site
    const manifestPath = siteManifestPath(playbook)
    const localManifestFile = siteCatalog.getFiles().find(f => f.out && f.out.path === manifestPath)
    if (localManifestFile) {
      try {
        const fullManifestRes = await fetch(`${playbook.site.url}/${manifestPath}`)
        const fullManifest = await fullManifestRes.json()
        const localManifest = JSON.parse(localManifestFile.contents.toString())
        const merged = mergeSiteManifest(fullManifest, localManifest)
        localManifestFile.contents = Buffer.from(JSON.stringify(merged, null, 2) + '\n')
      } catch (err) {
        // same trade-off as the nav merge above: worst case xrefs into unrebuilt content just
        // don't resolve for this build, rather than failing the whole build
        console.warn('could not merge site-manifest.json with primary site:', err)
      }
    }
  })

  antora.once('contentAggregated', async ({ contentAggregate }) => {
    const fullJson = await fullJsonPromise

    const directlyChanged = new Set([
      // the site's own start page - must never be classified as an orphan (never end up with
      // .out stripped), or contentCatalog.getSiteStartPage() returns a page that was never
      // converted (no .asciidoc set), crashing UI templates/helpers (e.g. nav-mode.js) that
      // assume the start page always went through conversion
      'https://github.com/couchbase/docs-site@master:home',
    ])
    for (const cv of contentAggregate) {
      for (const o of cv.origins) {
        const sha = o.refhash || null
        const oKey = repoKey(o)
        const recorded = fullJson.origins[oKey]
        // no recorded baseline (a source/branch that didn't exist as of the last full build)
        // or an actual SHA mismatch - either way, conservatively treat as changed
        if (!recorded || sha !== recorded.refhash) directlyChanged.add(oKey)
      }
    }

    const { keepOrigins, orphanCvKeys: orphans } = classifyCvStatus(directlyChanged, fullJson)
    orphanCvKeys = orphans

    const newContentAggregate = []
    for (const cv of contentAggregate) {
      cv.origins = cv.origins.filter((o) => keepOrigins.has(repoKey(o)))
      if (cv.origins.length) newContentAggregate.push(cv)
    }
    if (orphanCvKeys.size) {
      console.log(
        `quick-build: component-version(s) kept only for include::/image:: resolution, ` +
          `will not be published: ${[...orphanCvKeys].sort().join(', ')}`
      )
    }
    antora.updateVariables({ contentAggregate: newContentAggregate })
  })

  // fires after contentAggregated's aggregate has been classified into real pages (which is
  // when `.out` first gets set), but before documentsConverted (which is gated on `.out` for
  // both conversion AND publish - see @antora/document-converter/lib/convert-documents.js) -
  // so this is the one window where we can suppress orphan cvs' pages from being converted or
  // published while their raw file content is still present in the catalog for other pages'
  // include::/image:: directives to resolve against
  antora.once('contentClassified', ({ contentCatalog }) => {
    if (!orphanCvKeys.size) return
    let strippedCount = 0
    for (const page of contentCatalog.getPages((p) => p.out)) {
      if (orphanCvKeys.has(`${page.src.component}@${page.src.version}`)) {
        delete page.out
        strippedCount++
      }
    }
    console.log(
      `quick-build: suppressed publish/conversion for ${strippedCount} page(s) across ` +
        `${orphanCvKeys.size} orphan component-version(s)`
    )
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

function siteManifestPath (playbook) {
  return playbook.asciidoc.attributes['site-manifest-path'] || 'site-manifest.json'
}

// same shape of problem and same fix as mergeNavigationData/mergeNavigationComponent above,
// just adapted to site-manifest.json's schema (components[].versions[].pages instead of .sets,
// plus a per-component "latest" field and top-level version/generated/url metadata)
function mergeSiteManifest (full, local) {
  const localByName = new Map(local.components.map((c) => [c.name, c]))
  const components = full.components.map((c) => {
    const localC = localByName.get(c.name)
    if (!localC) return c
    localByName.delete(c.name)
    return mergeManifestComponent(c, localC)
  })
  components.push(...localByName.values())
  return { version: local.version, generated: local.generated, url: local.url, components }
}

function mergeManifestComponent (fullC, localC) {
  const versions = fullC.versions.slice()
  for (const localV of localC.versions) {
    const idx = versions.findIndex((v) => v.version === localV.version)
    if (idx === -1) versions.push(localV)
    else versions[idx] = localV
  }
  // prefer the local build's own idea of "latest" - it's freshly computed by this build's
  // navigation-builder, whereas the full site's copy may be stale by definition
  return { ...fullC, latest: localC.latest, versions }
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
  // expand via the same component-version origins/dependencies graph the post-fetch handler
  // below uses: a changed origin pulls in the rest of its component version (a multi-origin cv
  // needs all its origins to fetch anything meaningful) and whatever that component version's
  // pages read from via include::/image:: etc (recorded under cvs[].dependencies at full-build
  // time) - see classifyCvStatus. One hop is enough: Antora attributes even deeply-nested
  // includes to the outermost page's cv (loadAsciiDoc closes over the top-level `file` and
  // passes it into every resolveIncludeFile call for that page, nested or not - see
  // @antora/asciidoc-loader/lib/load-asciidoc.js:58-61), so a full build's recorded
  // dependencies are already the flattened, complete set - no further graph walking needed.
  const { keepOrigins: changed, originReason } = classifyCvStatus(directlyChanged, fullJson)
  for (const [oKey, reason] of originReason) {
    if (originNote.has(oKey)) continue
    console.log(`quick-build: ${oKey} -> ${reason}`)
    originNote.set(oKey, reason)
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

// Given a set of origin keys directly known to have changed (own SHA/path-hash differs from
// the recorded baseline, or no baseline exists at all), works out everything that must be
// fetched, plus which component-versions are pulled in only as "orphans":
//  - every origin belonging to the SAME component-version as a changed one (cvs[].origins) -
//    a multi-origin cv needs all its origins present, or the aggregate would be missing
//    content for it; this always marks that cv 'real'
//  - every origin a changed cv's pages read from via include::/image:: etc (cvs[].dependencies
//    - NOT plain xrefs, which record() never tracks, since Antora's own primary-site-manifest
//    hybrid mechanism already resolves those against the live site without needing the target
//    rebuilt - see the `family !== 'page'` check in trackingContentCatalog below)
// A component-version reached ONLY via a dependency edge (never via its own origin changing,
// and never as a sibling-origin of a changed cv) is an "orphan": its files need to be present
// for includes/images to resolve, but it isn't itself a build target - see the
// contentClassified handler above, which strips `.out` from orphan cvs' pages so they're never
// converted or published.
function classifyCvStatus (directlyChangedOriginKeys, fullJson) {
  const keepOrigins = new Set(directlyChangedOriginKeys)
  const originReason = new Map()

  const realCvKeys = new Set()
  for (const oKey of directlyChangedOriginKeys) {
    const cvKey = fullJson.origins[oKey]?.cv
    if (cvKey) realCvKeys.add(cvKey)
  }

  const orphanCvKeys = new Set()
  for (const cvKey of realCvKeys) {
    const cvFull = fullJson.cvs[cvKey]
    if (!cvFull) continue
    for (const o of cvFull.origins) {
      if (!keepOrigins.has(o)) originReason.set(o, `sibling-in-cv:${cvKey}`)
      keepOrigins.add(o)
    }
    for (const d of cvFull.dependencies) {
      if (!keepOrigins.has(d)) originReason.set(d, `dependency-of-cv:${cvKey}`)
      keepOrigins.add(d)
      const depCvKey = fullJson.origins[d]?.cv
      if (depCvKey && !realCvKeys.has(depCvKey)) orphanCvKeys.add(depCvKey)
    }
  }

  return { keepOrigins, orphanCvKeys, originReason }
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
