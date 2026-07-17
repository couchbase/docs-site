'use strict'

const { getCredential } = require('./git-remote-refs')

// Resolves the git tree oid at a path, for a given commit, via GitHub's REST "git trees" API -
// without cloning anything. This is deliberately NOT the default path for every content
// source: it's reserved (see PATH_AWARE_SOURCES in site-dependencies.js) for the rare "noisy
// monorepo" source where the plain branch-tip commit SHA changes constantly due to unrelated
// activity, making it useless on its own as a "did the docs change" signal. Everything else
// keeps using the cheap ls-remote branch-tip check in git-remote-refs.js.
//
// The tree oid returned here is directly comparable to the one ./git-local-tree.js computes
// locally on the full-build side - both are the same git-native, content-addressed tree hash,
// just resolved via different means (API vs local clone) depending on whether a clone exists.
module.exports.resolveRemotePathTreeOid = async function (url, oid, atPath, playbook) {
  if (!atPath || !oid) return undefined
  const { owner, repo } = parseGithubUrl(url)
  const credential = await getCredential(playbook, url)
  const headers = credential ? { Authorization: `Bearer ${credential.username}` } : {}
  let currentOid = oid
  for (const segment of atPath.split('/').filter(Boolean)) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${currentOid}`, { headers })
    if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching tree ${currentOid} for ${owner}/${repo}`)
    const { tree } = await res.json()
    const entry = tree.find((e) => e.path === segment)
    if (!entry) return undefined
    currentOid = entry.sha
  }
  return currentOid
}

function parseGithubUrl (url) {
  const match = url.replace(/\.git$/, '').match(/github\.com[:/]([^/]+)\/([^/]+)/)
  if (!match) throw new Error(`not a github.com URL: ${url}`)
  return { owner: match[1], repo: match[2] }
}
