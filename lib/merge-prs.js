/* Speculatively merge open PRs (and candidate branches) into content-source
   branches, see scripts/merge-prs.

   Opt in per branch, with a '+' recipe in the playbook's 'branches':

     - url: https://github.com/couchbase/docs-server
       branches: [release/8.5+*, release/7.6+october-release, release/7.2]

   * 'base+*' merges the open PRs targeting base.
   * 'base+candidate' merges the whole of the candidate branch into base
     (and then the open PRs targeting the candidate).
   * They combine, merged in order: 'base+one+two+*'.
   * Branches without a '+' are left alone.

   Each source is cloned into .cache/merge-prs/, merged *in place* on the
   named branches (so branch names, and so component versions and URLs,
   are unchanged), and the playbook is rewritten to point at the clone.
   A summary of what was merged is added as the home page 'merge-prs.adoc'.

   Not supported with lib/preview.js, which remaps source URLs to local
   checkouts and so would discard the clone. */

'use strict'
const path = require('node:path')
const fs = require('node:fs')
const child_process = require('node:child_process')
const util = require('node:util')
const execFile = util.promisify(child_process.execFile)

const SCRIPT = path.resolve(__dirname, '../scripts/merge-prs')
const CACHE = path.resolve(__dirname, '../.cache/merge-prs')
const GITHUB = /^https:\/\/github\.com\//
const GLOB = /[*?{}[\]!()]/

// what happened, for the summary page: [{ url, branch, report }]
const runs = []

module.exports.register = function () {

  this.once('playbookBuilt', async function ({ playbook }) {
    if (!playbook.content.sources.some((s) => [].concat(s.branches ?? []).some((b) => String(b).includes('+')))) return

    // deep-copy playbook to allow it to be updated
    const env = playbook.env
    playbook = JSON.parse(JSON.stringify(playbook))

    fs.rmSync(CACHE, { recursive: true, force: true })
    fs.mkdirSync(CACHE, { recursive: true })

    for (const source of playbook.content.sources) {
      const { branches, recipes } = parseBranches(source.branches)
      const wanted = branches.filter((b) => recipes.get(b).prs || recipes.get(b).candidates.length)
      if (!wanted.length) continue

      source.branches = branches   // recipes collapsed back to plain names

      if (!GITHUB.test(source.url)) {
        console.warn(`merge-prs: ${source.url} is not a github.com URL; skipping`)
        continue
      }

      const targets = wanted.filter((b) => {
        const literal = !GLOB.test(b) && b !== 'HEAD' && b !== '.'
        if (!literal) console.warn(`merge-prs: can't merge into '${b}' of ${source.url} (not a plain branch name); skipping`)
        return literal
      })
      if (!targets.length) continue

      const name = path.basename(source.url, '.git')
      const dir = path.join(CACHE, name)
      await spawn('gh', 'repo', 'clone', source.url, dir)
      // squash-merge commits need an identity (e.g. on CI)
      await spawn({ cwd: dir }, 'git', 'config', 'user.name', 'merge-prs')
      await spawn({ cwd: dir }, 'git', 'config', 'user.email', 'merge-prs@localhost')

      for (const branch of targets) {
        // outside the clone, so as not to dirty the working tree
        const reportFile = path.join(CACHE, `${name}.${branch.replace(/[^\w.-]/g, '_')}.json`)
        const args = ['--in-place', '--keep-going', '--report', reportFile]
        const { candidates, prs } = recipes.get(branch)
        for (const c of candidates) args.push('--also', c)
        if (!prs) args.push('--no-base-prs')

        await spawn({ cwd: dir }, 'git', 'checkout', branch)
        await spawn({ cwd: dir }, SCRIPT, ...args)

        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
        // what the merged result changes compared with the original branch
        const { stdout: patch } = await execFile(
          'git', ['diff', report.baseSha, report.headSha],
          { cwd: dir, maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' })
        runs.push({ url: source.url, branch, report, patch })
        console.log(`merge-prs: ${name} ${branch}: ${summarize(report)}`)
      }

      // local clone: its merged local branches win over the remote ones
      source.url = dir
    }

    // reinflate .env before updating
    playbook.env = env
    this.updateVariables({ playbook })
  })

  this.once('contentClassified', function ({ contentCatalog }) {
    if (!runs.length) return
    const home = contentCatalog.getComponent('home')
    if (!home) {
      console.warn("merge-prs: no 'home' component, so no merge-prs summary page")
      return
    }
    const version = home.latest.version
    // other extensions (e.g. report-tree) expect every page to have an
    // origin, so borrow the one from a real page of the same component
    const sibling = contentCatalog.findBy({ component: 'home', version, family: 'page' })[0]
    const origin = sibling?.src.origin && { origin: sibling.src.origin }
    // the combined diff of each run, as an attachment (empty diffs: none)
    for (const run of runs) {
      if (!run.patch.length) continue
      run.patchName = `merge-prs/${path.basename(run.url, '.git')}-${run.branch.replace(/[^\w.-]/g, '_')}.patch`
      contentCatalog.addFile({
        contents: run.patch,
        src: { component: 'home', version, module: 'ROOT', family: 'attachment', relative: run.patchName, ...origin },
      })
    }
    const file = contentCatalog.addFile({
      contents: Buffer.from(renderPage(runs, new Date())),
      src: {
        component: 'home',
        version,
        module: 'ROOT',
        family: 'page',
        relative: 'merge-prs.adoc',
        ...origin,
      },
    })
    console.log(`merge-prs: summary page at ${file.pub.url}`)
  })
}

// 'base+one+two+*' entries become base with candidates [one, two] and prs
// (the '*', which can't be a branch name); a plain 'base' alongside a recipe
// for base is absorbed by it.
function parseBranches (branches) {
  const recipes = new Map()
  for (const entry of [].concat(branches ?? [])) {
    const [base, ...extra] = String(entry).split('+').map((s) => s.trim())
    if (!recipes.has(base)) recipes.set(base, { candidates: [], prs: false })
    const recipe = recipes.get(base)
    for (const c of extra.filter(Boolean)) {
      if (c === '*') recipe.prs = true
      else if (!recipe.candidates.includes(c)) recipe.candidates.push(c)
    }
  }
  return { branches: [...recipes.keys()], recipes }
}

function summarize ({ prs, candidates }) {
  const all = [...candidates, ...prs]
  const n = (s) => all.filter((x) => x.status === s).length
  return `merged ${n('merged')}, resolved ${n('resolved')}, skipped ${n('skipped')}, failed ${n('failed')}`
}

// untrusted text -> inline asciidoc that renders literally
// (inside a table cell, pass cell = true so that '|' doesn't end the cell)
const lit = (s, cell) => {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim().replace(cell ? /[\]|]/g : /]/g, '\\$&')
  return `pass:specialchars[${text}]`
}
const link = (url, text) => (/^https:\/\//.test(url) && !/[\s[\]|]/.test(url)) ? `${url}[${text}]` : lit(text)

function renderPage (runs, now) {
  const out = [
    '= Merged pull requests',
    '',
    `NOTE: This build includes changes that are *not yet merged*: open pull requests (and candidate branches) were merged on top of the branches below on ${now.toISOString()}. They may change, or not be released.`,
    '',
  ]

  for (const { url, branch, report, patchName } of runs) {
    const repo = path.basename(url, '.git')
    const short = (sha) => `\`${String(sha).slice(0, 8)}\``
    const failed = [...report.candidates, ...report.prs].filter((x) => x.status === 'failed')

    out.push(`== ${lit(repo)}: ${lit(branch)}`, '')
    // the result commit exists only in the build's clone, so can't be linked to
    out.push(
      `Built from ${link(`${url}/commit/${report.baseSha}`, short(report.baseSha))}, giving ${short(report.headSha)} (not on GitHub).` +
      (patchName ? ` See everything that changed in the xref:attachment$${patchName}[combined diff].` : ''),
      '')

    if (failed.length) {
      out.push('[CAUTION]', '====', 'These could not be merged, so are *not* in this build:', '')
      for (const f of failed) {
        out.push(`* ${f.url ? link(f.url, `#${f.number}`) + ' ' + lit(f.title) : `branch ${lit(f.branch)}`}: ${lit(f.note)}`)
      }
      out.push('====', '')
    }

    if (report.candidates.length) {
      out.push('=== Candidate branches', '')
      for (const c of report.candidates) {
        const behind = c.behindBy ? `, ${c.behindBy} commit(s) behind ${lit(report.base)}` : ''
        const compare = link(`${url}/compare/${encodeURI(report.base)}...${encodeURI(c.branch)}`, 'compare')
        const stat = c.stat ? ` (${lit(c.stat)})` : ''
        out.push(`* ${lit(c.branch)} (${compare}): ${c.status}${behind}${stat}${c.note ? ': ' + lit(c.note) : ''}`)
      }
      out.push('')
    }

    if (!report.prs.length) {
      out.push('No open pull requests were found to merge.', '')
      continue
    }

    out.push('=== Pull requests', '', '[cols="1,2,4,1,4",options="header"]', '|===', '|PR |Into |Title |Author |Result', '')
    for (const p of report.prs) {
      const author = /^[\w-]+$/.test(p.author) ? link(`https://github.com/${p.author}`, p.author) : lit(p.author, true)
      const stat = p.stat ? ` (${lit(p.stat, true)})` : ''
      const result = {
        merged: `Merged${stat}`,
        resolved: `Merged${stat}, after claude resolved conflicts: ${lit(p.note, true)}`,
        skipped: `Skipped: ${lit(p.note, true)}`,
        failed: `*Failed*: ${lit(p.note, true)}`,
      }[p.status] || lit(p.status, true)
      out.push(`|${link(p.url, `#${p.number}`)} (${link(`${p.url}/files`, 'diff')}) |${lit(p.target, true)} |${lit(p.title, true)} |${author} |${result}`, '')
    }
    out.push('|===', '')
  }
  return out.join('\n')
}

module.exports.parseBranches = parseBranches
module.exports.renderPage = renderPage
module.exports.runs = runs

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
