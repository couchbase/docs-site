'use strict'

const { promises: fsp } = require('fs')
const git = require('@antora/content-aggregator/git')
const createGitHttpPlugin = require('@antora/content-aggregator/git/http-plugin')

const REFS_HEADS_PREFIX = 'refs/heads/'

// Resolves the current SHA of one branch on a remote, without cloning - the isomorphic-git
// equivalent of `git ls-remote <url> refs/heads/<branch>`. Uses the same isomorphic-git
// instance and HTTP transport plugin @antora/content-aggregator uses internally for real
// fetches (both are explicitly exported by that package via its package.json "exports" map),
// so this behaves identically to Antora's own git client, just without transferring objects.
//
// Passes the exact branch name as `prefix`, which isomorphic-git sends as a protocol v2
// `ref-prefix` line - the *server* filters to just the matching ref(s), so this stays cheap
// even for repos with huge numbers of branches (e.g. couchbase-cloud); it never lists every
// ref on the remote.
//
// Credentials come from playbook.git.credentials, which Antora's own playbook-builder already
// resolves from the GIT_CREDENTIALS / GIT_CREDENTIALS_PATH env vars (or an explicit path/
// contents in the playbook) - see @antora/playbook-builder/lib/config/schema.js. We only read
// those two fields; we don't replicate @antora/content-aggregator's private credential
// manager's extra ~/.git-credentials/XDG fallback since that's not a mechanism actually in use.
module.exports.resolveBranchSha = async function (url, branch, playbook) {
  const http = createGitHttpPlugin(playbook.network || {})
  const onAuth = await buildOnAuth(playbook.git && playbook.git.credentials)
  const prefix = REFS_HEADS_PREFIX + branch
  const refs = await git.listServerRefs({ http, onAuth, url, prefix })
  const match = refs.find((r) => r.ref === prefix)
  return match && match.oid
}

async function buildOnAuth (credentialsConfig) {
  const entries = await loadCredentialEntries(credentialsConfig)
  if (!entries.size) return undefined
  return (url) => {
    const { hostname, pathname } = new URL(url)
    return entries.get(hostname + pathname) || entries.get(hostname)
  }
}

// exposed for reuse by ./github-tree.js, which needs a bearer token (not a git onAuth
// callback) for GitHub's REST API - same underlying playbook.git.credentials source
module.exports.getCredential = async function (playbook, url) {
  const entries = await loadCredentialEntries(playbook.git && playbook.git.credentials)
  const { hostname, pathname } = new URL(url)
  return entries.get(hostname + pathname) || entries.get(hostname)
}

async function loadCredentialEntries (config) {
  let contents = config && config.contents
  let delimiter = /[,\n]/
  if (!contents && config && config.path) {
    contents = await fsp.readFile(config.path, 'utf8').catch(() => undefined)
    delimiter = '\n'
  }
  const entries = new Map()
  if (!contents) return entries
  for (const line of contents.trim().split(delimiter)) {
    if (!line) continue
    try {
      const { username, password, hostname, pathname } = new URL(line)
      if (!username && !password) continue
      const credential = { username: decodeURIComponent(username), password: decodeURIComponent(password || '') }
      entries.set(pathname === '/' ? hostname : hostname + pathname, credential)
    } catch (e) {
      console.log("Error in loadCredentialEntries:", e)
      // ignore malformed entries
    }
  }
  return entries
}
