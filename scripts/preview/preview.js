import path from 'node:path'
import fs from 'node:fs'
import yaml from 'yaml'
import {findUp, pathExists} from 'find-up'
import { promisify } from 'node:util'
import child_process from 'node:child_process'
import deepmerge from '@fastify/deepmerge'
const doExec = promisify(child_process.exec);

// MAIN block
{
    let antora = await getLocalAntora()
    await buildAntora(antora)
}


// MAIN FUNCTIONS
async function getLocalAntora() {
    const antoraPath = await findUp('antora.yml')
    let antora = yaml.parse(
        fs.readFileSync(antoraPath).toString())

    const dotGit = path.dirname(
        await findUp('.git', {type: "directory"}))

    const branch = await exec('git branch --show-current')

    const docsSite = getLocalDocsSite(dotGit)

    const previewConfig = antora.ext?.preview?.[branch] || antora.ext?.preview?.DEFAULT || {}

    antora = {
        ...antora,
        repo: dotGit,
        repoShort: path.basename(dotGit),
        docsSite,
        branches: branch,
        previewConfig,
        ...startPath(dotGit, path.dirname(antoraPath)),
    }

    const sources = mapSources_local(antora)
    return {
        ...antora,
        sources
    }
}

function writePlaybook({docsSite, sources, previewConfig}) {
    // copy the master playbook
    let masterPlaybook = path.resolve(docsSite, 'antora-playbook.yml')
    let playbook = yaml.parse(
        fs.readFileSync(masterPlaybook).toString())

    // add the new sources we've customized
    playbook.content.sources = sources

    // do overrides
    let overridePlaybook = path.resolve(docsSite, 'antora-playbook.preview.local.yml')
    const override = yaml.parse(
        fs.readFileSync(overridePlaybook).toString())
    playbook = deepmerge({all: true})(
        playbook,
        override,
        previewConfig.override)
    console.dir(playbook, {depth: 4})

    // write out the preview playbook
    let previewPlaybook = path.resolve(docsSite, 'antora-playbook.preview.generated.yml')
    fs.writeFileSync(previewPlaybook, yaml.stringify(playbook))

    return playbook
}

async function buildAntora(antora) {
    const {docsSite} = antora
    const playbook = writePlaybook(antora)
    const output = playbook.output?.dir || './public'
    process.chdir(docsSite)
    await spawn('npx', 'antora', 'antora-playbook.preview.generated.yml')
    await spawn('open', `${output}/index.html`)
}

function startPath(from, to) {
    const rel = path.relative(from, to)
    if (rel == '') {
        return {}
    } else {
        return { start_path: rel }
    }
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


function mapSources_local({ext, repo, repoShort, docsSite, start_path, branch, previewConfig}) {
    const defaultSources = {
        'docs-site': {
            url: '.',
            branches: 'HEAD',
            start_path: 'home/'
        },
        [repoShort]: {
            url: repo,
            branches: 'HEAD',
            start_path,
        }
    }

    const resolveLocal = make_resolveLocal(docsSite)

    let sources = []
    if (sources = previewConfig?.sources) {
        sources = flatmapObj(sources,
            (k, _v) => {
                let url
                if (url = resolveLocal(k)) {
                    return {url}
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



function getLocalDocsSite(repo) {
    let docsSite
    if (docsSite = process.env.DOCS_SITE_PATH) {
        return docsSite
    }
    const resolveLocal = make_resolveLocal(repo)
    return resolveLocal('docs-site')
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

async function exec(...args) {
    const { stdout, stderr } = await doExec.apply(null, args)

    if (stderr.length) {
        console.error(stderr)
    }
    if (stdout.length) {
        return stdout.trimRight()
    }
}

function spawn(...command) {
    let p = child_process.spawn(command[0], command.slice(1))
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
            resolve(code)
        })
    })
}
