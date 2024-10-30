const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const yaml = require('yaml')
const {promisify} = require('node:util')
const child_process = require('node:child_process')
const deepmerge = require('@fastify/deepmerge')
const doExec = promisify(child_process.exec)

module.exports.register = async function ({ config, playbook }) {

  const url = process.env.PR_URL
  const branch = process.env.PR_BRANCH
  let fromDir = process.env.PREVIEW_FROMDIR

  const repo = path.basename(url)

  let is_remote;
  if (fromDir) {
    is_remote = false
    fromDir = [fromDir]
  }
  else {
    is_remote = true
    // fromDir = ... TODO
  }

  const antoraPath = await findAntora(fromDir) 
  console.log({antoraPath})
  
  let antora = {
    url,
    repo,
    branch,
    playbook,
    ...startPath(url, path.dirname(antoraPath)),
    ...readAntora(antoraPath, branch)
  }

  const sources = mapSources_local(antora)
  console.dir(sources)
  playbook.content.sources = sources
  this.updateVariables({ playbook })
  
  this.on('contextStarted', async ({config, playbook}) => {
    throw new Error("RARR")
    playbook.content.sources = sources

    playbook = deepmerge({all: true})(
      playbook,
      antora.previewConfig.override || {})

    console.dir(playbook.content)

    this.updateVariables({ playbook })
  })
}

function make_resolveLocal(baseRepo) {
  const repoPath = ((process.env.REPO_PATH || '..')
      .split(':')
      .map((p) => path.resolve(baseRepo, p)))

  return (repo) =>
       repoPath
          .map((p) => path.resolve(p, repo))
          .find((p) => fs.existsSync(p))
}

function mapSources_local(antora) {
  const resolver = make_resolveLocal('.')
  return mapSources({...antora, resolver})
}

function readAntora(antoraPath, branch) {
  let antora = yaml.parse(
      fs.readFileSync(antoraPath).toString())

  antora.previewConfig =
      antora.ext?.preview?.[branch] || 
      antora.ext?.preview?.DEFAULT || {}

  return antora
}

function mapSources({repo, url, start_path, previewConfig, resolver}) {
  const defaultSources = {
      // 'docs-site': {
      //     url: '.',
      //     branches: 'HEAD',
      //     start_path: 'home/'
      // },
      [repo]: {
          url,
          branches: 'HEAD',
          start_path,
      }
  }

  let sources = []
  if (sources = previewConfig?.sources) {
      sources = flatmapObj(sources,
          (k, v) => {
              let url
              if (url = resolver(k)) {
                  return {url, ...v}
              }
              else {
                  console.error(`Didn't find ${k} in ${repoPath}`)
                  return null
              }
          }
      )
  }
  sources = {
      ...defaultSources,
      ...sources
  }

  return Object.values(sources)
}

async function findAntora(paths) {
  const {findUp} = await import('find-up')

  for (let p of paths) {
      let a 
      if (a = await findUp('antora.yml', 
        {cwd: path.resolve(p)})) 
      { return a }
      else { throw new Error("Couldn't find antora.yml")}
  }
}

function startPath(from, to) {
  const rel = path.relative(from, to)
  if (rel == '') {
      return {}
  } else {
      return { start_path: rel }
  }
}

///////////
// GENERIC HELPER functions

function flatmapObj(obj, fn) {
  return Object.fromEntries(
      Object.entries(obj)
      .flatMap(([k,v]) => {
          let ret
          if (ret = fn(k,v)) {
              return [[k, {...v, ...ret}]]
          }
          else {
              return []
          }
      }))
}