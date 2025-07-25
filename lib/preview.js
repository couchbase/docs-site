/* see scripts/preview */

'use strict'
const path = require('node:path')
const child_process = require('node:child_process')
const yaml = require('yaml')
const fs = require('node:fs')
const deepmerge = require('@fastify/deepmerge')
const util = require('util')
const exec = util.promisify(require('child_process').exec)

module.exports.register = function () {
  this.once('playbookBuilt', async function ({ playbook }) {
    // deep-copy playbook to allow it to be updated
    const env = playbook.env
    playbook = JSON.parse(JSON.stringify(playbook))

    const args = {
        repo: process.env.PREVIEW_REPO,
        branch: process.env.PREVIEW_BRANCH || 'HEAD',
        // watermark branch allows us to masquerade as a different branch
        // this is useful for previewing a PR against the main branch e.g.
        // so that the watermark lines don't trigger in the diff.
        watermark_branch: process.env.PREVIEW_WATERMARK_BRANCH,
        config: process.env.PREVIEW_CONFIG || process.env.PREVIEW_BRANCH || 'HEAD',
        remote: process.env.PREVIEW_REMOTE ? true : false,
        repoPath: ((process.env.REPO_PATH || '..')
            .split(':')
            .map((p) => path.resolve('.', p))),
        startPath: process.env.PREVIEW_START_PATH || '',
        override: process.env.PREVIEW_OVERRIDE,
        githubRemote: process.env.PREVIEW_GITHUB_REMOTE
    }

    const [override, additionalSources] = getOverride(args.override)

    const sources = getSources(playbook, additionalSources)
    const source = sources[args.repo]
    if (! source) {
        throw notfound(args)
    }

    if (args.remote) {
        // on CI only
        // 1. fetch docs-site (in case we want to switch to different branch)
        await spawn('git', 'fetch')

        // 2. download the source / except for docs-site where we switch to that branch
        if (source.url !== '.') {
          await spawn(
              {cwd:'..'},
              'gh', 'repo', 'clone',
                  source.url,
                  '--', // git flags follow
                  '-b', args.branch,
                  // unlimited depth, as we may want to build arbitrary branches
                  )
        }
        else {
          await spawn('git', 'checkout', args.branch)
        }
    }

    if (args.remote) {
        // on CI only, get details about PR (if any)
        // const prfile = `${args.repo}-${args.branch}.json`
        const prfile = 'pr.json'
        try {
            const fields = 'title,body,url,number,state,author,updatedAt'
            const { stdout } = await exec(
                `gh pr view --repo ${source.url} --json ${fields} ${args.branch}`)
            fs.writeFileSync(prfile, stdout)
        }
        catch (e) {
            // fs.writeFileSync(prfile, '{}')
        }
    }

    const mapLocalUrl = (repo, url) => (args.repoPath
                    .map(p => path.resolve(p, repo))
                    .find(fs.existsSync)
                    || url)

    const basePath = path.resolve(
        mapLocalUrl(args.repo, 'UNEXPECTED'), 
        args.startPath || source.start_path || '')
    const antoraYmlPath = `${basePath}/antora.yml`
    console.log(antoraYmlPath)

    const readYaml = (path) => 
        fs.existsSync(path) && yaml.parse(fs.readFileSync(path).toString())

    const antoraYml = readYaml(antoraYmlPath)

    const previewConfig =
        readYaml(`${basePath}/preview/${args.config}.yml`) ||
        readYaml(`${basePath}/preview/HEAD.yml`) ||
        antoraYml.ext?.preview?.[args.config] || 
        antoraYml.ext?.preview?.HEAD || {}

    const desiredSources = deepmerge({mergeArray: overrideArray})
        ({
            'docs-site': {},
            [args.repo]: {...source, branches: [args.branch]}
        },
        previewConfig.sources || {})

    const filteredSources = 
        Object.fromEntries(
            Object.entries(sources)
                .filter(([k,v]) => k in desiredSources))

    const updatedSources =
        deepmerge({mergeArray: overrideArray})
            (filteredSources, 
            desiredSources)

    const urlMapper = ([k,v]) => {
        if (! v.url) {
            throw notfound({...args,
                repo: k,
                githubRemote: undefined,
                branch: undefined,
                startPath: '.'
             })
        }
        return [k, {...v, url: mapLocalUrl(k, v.url)}]
    }

    const mappedSources = 
        Object.values(
            Object.fromEntries(
                Object.entries(updatedSources)
                    .map(urlMapper)))

    console.dir(mappedSources, {depth: 5})

    const startPage =
        { site:
            { startPage:
                `${antoraYml.name}:${antoraYml.start_page || 'ROOT:index.adoc'}`}}

    playbook = deepmerge({all: true})(
        playbook,
        startPage,
        override,
        previewConfig.override || {})
    playbook.content.sources = mappedSources

    const date = new Date().toISOString().split('T')[0]
    const watermark_branch = args.watermark_branch || args.branch
    playbook.asciidoc.attributes['page-watermark'] =
        `${date} ${args.repo} ${watermark_branch}`

    // console.dir(playbook, {depth: 5}); process.exit(1)
    // reinflate .env before updating
    playbook.env = env
    this.updateVariables({ playbook })
  })
}

function notfound(args) {
    return new Error(
        `Oh no! ${args.repo} source not found in playbook.
        You need to add to 'antora-playbook.preview.yml' something like:

        content:
          sources:
          # add in the appropriate place
          - url: ${args.githubRemote || 'the appropriate github URL'}
            branches: ${args.branch || 'the appropriate default git branch'}
            ${args.startPath != '.' ? `start_path: ${args.startPath}\n` : ''}`)
}

function getOverride(overridePlaybook) {
    if (! overridePlaybook) { return [{}, []] }
    const override = yaml.parse(
        fs.readFileSync(overridePlaybook).toString())
    const { ['content']: content, ...rest } = override
    return [rest, content?.sources || []]
}

function getSources(playbook, additionalSources) {
    const sources = (
        [
            ...playbook.content.sources,
            ...additionalSources
        ]
        .map(source => {
            if (source.url === '.') {
                return [
                    'docs-site',
                    source]
            }
            else {
                return [
                    path.basename(source.url, '.git'),
                    source]
            }
    }))
    return Object.fromEntries(sources)
}

function overrideArray(_options) {
    return (_arr1, arr2) => arr2
}
// async, so call with `await` (uses Promises)
// see https://stackoverflow.com/questions/58570325/how-to-turn-child-process-spawns-promise-syntax-to-async-await-syntax
function spawn(...args) {
    let f = args.shift()
    let opts = {}
    let cmd
    if (typeof f === 'object') {
        opts = f
        cmd = args.shift()
    }
    else {
        cmd = f
    }
    const command = [cmd, ...args]

    let p = child_process.spawn(cmd, args, opts)
    return new Promise((resolve) => {
        p.stdout.on("data", (x) => {
            process.stdout.write(x.toString())
        })
        p.stderr.on("data", (x) => {
            process.stderr.write(x.toString())
        })
        p.on('error', (x) => {
            throw new Error(x.toString())
        })
        p.on("exit", (code) => {
            if (code) {
                throw new Error(`Command [${command.join(' ')}] returned ${code}`)
            }
            else {
                resolve(code)
            }
        })
    })
}
