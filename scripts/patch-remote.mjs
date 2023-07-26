#!/usr/bin/env zx
'use strict'
import _ from "lodash"

$.verbose = false


const repoShort = (url) => path.basename(url, '.git')

const isLocal = (url) => url.match(/^[./]/)


const localPlaybookFile =  argv.playbook ?? argv._.shift() ?? 'antora-playbook.yml'
var localPlaybook = YAML.parse(fs.readFileSync(localPlaybookFile).toString())

const override_sources = Object.fromEntries(
  await Promise.all(localPlaybook.content.sources.map(mungeSources)))
const only_sources = Object.keys(override_sources)
console.log(YAML.stringify(
  {
    asciidoc: {
      attributes: {
        generationTime: Date(), // to make sure we have a change to push
      },
    },
    content: {
      sources: {
        $seq: [
          { $override: override_sources },
          { $only: only_sources },
        ]
      }
    }
  }))

///////////////////////////////////////////

async function mungeSources(source) {
  const {url, ...rest} = source
  
  return isLocal(url) ?
    await mungeLocalSource(url, rest)
    : [repoShort(url), rest]
}

function lineLength(text) {
  if (text === '') { return 0 }
  return text.split('\n').length
}

async function mungeLocalSource(url, source) {
  const urlAbs = path.resolve(url)
  const repo = repoShort(urlAbs)
  
  const git = ['git', '-C', url]

  const current = (await $`${git} branch --show-current`).stdout.trim()
  const remote = (await $`${git} remote -v | grep -e 'github[.]com[/:]couchbase' | cut -f1 | uniq`).stdout.trim()
  if (lineLength(remote) != 1) {
    throw new Error(`Source ${url} should have exactly 1 couchbase remote but has:\n{remote}\n`)
  }
  await $`${git} fetch ${remote}`
  
  const toArray = (thing) => Array.isArray(thing) ? thing : [thing]

  const {branches, ...rest} = source
  
  const mungedBranches = toArray(branches).map(
    branch => branch == 'HEAD' ? current : branch)
  
  for (var branch of mungedBranches) {
    try {
      await $`${git} rev-parse ${branch}`
    }
    catch (p) {
      console.warn(
        `❌ Couldn't find local for ${repo}. Try:
        cd ${urlAbs}
        git checkout --track ${remote}/${branch}`)
      continue
    }
    try {
      await $`${git} rev-parse ${remote}/${branch}`
    }
    catch (p) {
      console.warn(
        `❌ Couldn't find remote for ${repo}. Try:
        cd ${urlAbs}\n\tgit checkout ${branch}
        git push --set-upstream ${remote} ${branch}`)
      continue
    }
    const ahead = lineLength((await $`${git} log --oneline ${remote}/${branch}..${branch}`).stdout.trim())
    const behind = lineLength((await $`${git} log --oneline ${branch}..${remote}/${branch}`).stdout.trim())
    const dirty = (branch === current) ?
      lineLength((await $`${git} status -s`).stdout.trim())
      : 0
    if (ahead + behind + dirty) {
      console.warn(
        `❌  Branch ${branch} for ${repo} isn't in sync with remote. Try:
        cd ${urlAbs}
        git checkout ${branch}
        ${dirty ? '# git add . && git commit -m "Updated everything"  # modify as appropriate' : ''}
        git pull --rebase ${remote} ${branch}
        git push ${remote} ${branch}`)
    }
    else {
      console.warn(`✅  Branch ${branch} for ${repo} is in sync with remote`)
    }
  }
  
  return [repo, {branches: mungedBranches, ...rest}]
}


