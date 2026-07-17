'use strict'

const { createHash } = require('crypto')
const fs = require('fs')
const path = require('path')
const expandPath = require('@antora/expand-path-helper')
const getCacheDir = require('cache-directory')
const git = require('@antora/content-aggregator/git')

const CONTENT_CACHE_FOLDER = 'content'

// Resolves the git tree oid at a path within a content source's *already locally cloned*
// repo - no network access at all. Antora's content-aggregator persists a bare clone of every
// content source under playbook.runtime.cacheDir (see generateCloneFolderName in
// @antora/content-aggregator/lib/aggregate-content.js, replicated below since it isn't part of
// that package's public exports), so on the full-build side, where that clone already exists
// by the time we get here, this is free - unlike the quick-build/prune side, which has no local
// clone and has to ask the GitHub API instead (see ./github-tree.js).
//
// A tree oid is content-addressed: it only changes if something under that path actually
// changed, regardless of how many unrelated commits land elsewhere in the same repo - exactly
// what's needed to track a single start_path in a busy monorepo (e.g. couchbase-cloud).
module.exports.resolvePathTreeOid = async function ({ playbook, url, oid, path: atPath }) {
  if (!atPath || !oid) return undefined
  const dir = path.join(resolveCacheDir(playbook), generateCloneFolderName(url))
  let currentOid = oid
  for (const segment of atPath.split('/').filter(Boolean)) {
    let tree
    try {
      ;({ tree } = await git.readTree({ fs, dir, gitdir: dir, oid: currentOid }))
    } catch {
      return undefined // e.g. no local clone at that path, or oid not present locally
    }
    const entry = tree.find((e) => e.path === segment)
    if (!entry) return undefined
    currentOid = entry.oid
  }
  return currentOid
}

function resolveCacheDir (playbook) {
  const preferred = playbook.runtime && playbook.runtime.cacheDir
  const startDir = playbook.dir || '.'
  const baseCacheDir = preferred == null ? getCacheDir('antora') || path.resolve('.antora/cache') : expandPath(preferred, { dot: startDir })
  return path.join(baseCacheDir, CONTENT_CACHE_FOLDER)
}

// mirrors @antora/content-aggregator/lib/aggregate-content.js's generateCloneFolderName - not
// part of that package's public exports (only "./git" and "./git/http-plugin" are), so
// replicated here; small and stable (a basename + sha1 of the normalized url)
function generateCloneFolderName (url) {
  const normalizedUrl = removeGitSuffix(url.toLowerCase())
  const basename = normalizedUrl.split(/[:/]/).pop()
  return `${basename}-${createHash('sha1').update(normalizedUrl).digest('hex')}.git`
}

function removeGitSuffix (url) {
  return url.endsWith('.git') ? url.slice(0, -4) : url
}
