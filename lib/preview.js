'use strict'
const path = require('node:path')
const child_process = require('node:child_process')
const yaml = require('yaml')
const fs = require('node:fs')
const deepmerge = require('@fastify/deepmerge')


module.exports.register = function () {
  this.once('playbookBuilt', async function ({ playbook }) {
    // deep-copy playbook to allow it to be updated
    const env = playbook.env
    playbook = JSON.parse(JSON.stringify(playbook))

    // playbook.content.sources = playbook.content.sources.filter(({ url }) => !url.startsWith('https://git@'))

    const args = {
        repo: process.env.PREVIEW_REPO,
        branch: process.env.PREVIEW_BRANCH || 'HEAD',
        remote: process.env.PREVIEW_REMOTE ? true : false,
        repoPath: ((process.env.REPO_PATH || '..')
            .split(':')
            .map((p) => path.resolve('.', p))),
        startPath: process.env.PREVIEW_START_PATH || '',
        override: process.env.PREVIEW_OVERRIDE
    }

    const [override, additionalSources] = getOverride(args.override)

    const sources = getSources(playbook, additionalSources)
    const source = sources[args.repo]
    if (! source) {
        throw new Error(`Oh no! ${args.repo} source not found in playbook`)
    }

    if (args.remote) {
        if (args.repo === 'docs-site') {
            await spawn('git', 'fetch', 'origin', args.branch)
        }
        else {
            await spawn(
                {cwd:'..'},
                'git', 'clone', 
                    '-b', args.branch,
                    '--depth', 1,
                    source.url)
        }
    }
    const mapLocalUrl = (url) => (args.repoPath
                    .map(p => path.resolve(p, url))
                    .find(fs.existsSync)
                    || url)

    const antoraYmlPath = path.resolve(
        mapLocalUrl(args.repo), 
        args.startPath || source.start_path || '', 
        'antora.yml')
    console.log(antoraYmlPath)

    const antoraYml = yaml.parse(
        fs.readFileSync(antoraYmlPath).toString())

    const previewConfig =
        antoraYml.ext?.preview?.[args.branch] || 
        antoraYml.ext?.preview?.DEFAULT || {}

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

    const urlMapper = ([k,v]) => [k, {...v, url: mapLocalUrl(k)}]

    const mappedSources = 
        Object.values(
            Object.fromEntries(
                Object.entries(updatedSources)
                    .map(urlMapper)))

    const startPage = antoraYml.start_page ?
        { site:
            { startPage:
                `${antoraYml.name}:${antoraYml.start_page}`}} 
        : {}
    // TODO NEXT STEPS:
    // *X source overrides (appended)
    // *X other overrides (actual override)
    // *... wrapper exe builds locally
    // * wrapper exe builds Github Action
    // * write the updated Playbook to the antora output
    // *X `git clone` sparse, to get the antora.yml
    // * document and test the antora.yml for a number of circumstances
    playbook = deepmerge({all: true})(
        playbook,
        startPage,
        override,
        previewConfig.override || {})
    playbook.content.sources = mappedSources

    // console.dir(playbook, {depth: 5}); process.exit(1)
    // reinflate .env before updating
    playbook.env = env
    this.updateVariables({ playbook })
  })
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