/* Speculatively merge open PRs into selected content-source branches,
   see scripts/merge-prs.

   In the playbook:

     - url: https://github.com/couchbase/docs-server
       branches: [release/8.5, release/7.6]
       merge-prs: release/8.5      # picomatch glob, or a list of globs

   Each matching branch is cloned (into .cache/merge-prs/) and has its PRs
   merged into a local 'merge-prs/<branch>' branch; the source is rewritten
   to point at the clone and the merged branch. */

'use strict'
const path = require('node:path')
const fs = require('node:fs')
const child_process = require('node:child_process')
const picomatch = require('picomatch')

const SCRIPT = path.resolve(__dirname, '../scripts/merge-prs')
const CACHE = path.resolve(__dirname, '../.cache/merge-prs')

const toArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v])

module.exports.register = function () {

  this.once('playbookBuilt', async function ({ playbook }) {
    const wanted = (s) => s.mergePrs ?? s['merge-prs']
    if (!playbook.content.sources.some(wanted)) return

    // deep-copy playbook to allow it to be updated
    const env = playbook.env
    playbook = JSON.parse(JSON.stringify(playbook))

    for (const source of playbook.content.sources) {
      const globs = toArray(wanted(source))
      delete source.mergePrs
      delete source['merge-prs']
      if (!globs.length) continue

      const branches = toArray(source.branches)
      const isMatch = picomatch(globs)
      const matched = branches.filter((b) => isMatch(b))
      if (!matched.length) {
        console.warn(`merge-prs: no branches of ${source.url} match ${JSON.stringify(globs)}; skipping`)
        continue
      }

      const dir = path.join(CACHE, path.basename(source.url, '.git'))
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(CACHE, { recursive: true })
      await spawn('gh', 'repo', 'clone', source.url, dir)
      // squash-merge commits need an identity (e.g. on CI)
      await spawn({ cwd: dir }, 'git', 'config', 'user.name', 'merge-prs')
      await spawn({ cwd: dir }, 'git', 'config', 'user.email', 'merge-prs@localhost')

      for (const branch of matched) {
        await spawn({ cwd: dir }, 'git', 'checkout', branch)
        await spawn({ cwd: dir }, SCRIPT)
      }

      source.url = dir
      source.branches = branches.map((b) => (matched.includes(b) ? `merge-prs/${b}` : b))
    }

    // reinflate .env before updating
    playbook.env = env
    this.updateVariables({ playbook })
  })
}

module.exports.spawn = spawn

// async, so call with `await`; rejects on a non-zero exit
function spawn (...args) {
  let opts = {}
  if (typeof args[0] === 'object') opts = args.shift()
  const [cmd, ...rest] = args
  return new Promise((resolve, reject) => {
    const p = child_process.spawn(cmd, rest, opts)
    p.stdout.on('data', (x) => process.stdout.write(x))
    p.stderr.on('data', (x) => process.stderr.write(x))
    p.on('error', reject)
    p.on('exit', (code) =>
      code
        ? reject(new Error(`Command [${[cmd, ...rest].join(' ')}] returned ${code}`))
        : resolve(code))
  })
}
