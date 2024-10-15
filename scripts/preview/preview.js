import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import yaml from 'yaml'
import {findUp, pathExists} from 'find-up'
import { promisify } from 'node:util'
import child_process from 'node:child_process'
import deepmerge from '@fastify/deepmerge'
const doExec = promisify(child_process.exec);
import { parseArgs } from "node:util";

// MAIN block
{
    const args = parseArgs({
        options: {
            // call with --init to add alias `preview` in .zshrc
            // e.g. `node scripts/preview/preview.js --init`
            init: { type: "boolean" },

            // --remote build on github
            remote: { type: "boolean" },
            repo: { type: "string" },
            branch: { type: "string" }
        }
    })

    // REMOTE builds
    if (args.values.remote) {
        const {repo, branch} = args.values
        // we are called from a Github runner, with `/docs-site` checked out
        // and assume working directory is the ROOT directory
        // (e.g. parent of docs-site)

        const docsSite = path.resolve('./docs-site')
        const repoShort = path.basename(repo, '.git')

        const playbook = readMasterPlaybook({docsSite})

        let antora = {
            docsSite,
            playbook,
            branches: branch,
            repo: path.resolve(repoShort),
            repoShort
        }
        // spawn('gh', 'repo', 'clone', 
        //     repo,
        //     '--',
        //     '--branch', branch)
        // TODO reset to --ref if passed

        antora = await getRemoteAntora(antora)
        await buildAntora_remote(antora)
    }

    // LOCAL builds
    else {
        const antora = await getLocalAntora()
        if (args.values.init) {
            initLocal(antora)
        }
        else {
            await buildAntora_local(antora)
        }
    }
}

// MAIN FUNCTIONS

function initLocal({docsSite}) {
    const cmd = `alias preview='node ${docsSite}/scripts/preview/preview.js'`
    const zshrc = path.join(os.homedir(), '.zshrc')
    console.log(`Adding this alias to ${zshrc}:\n    ${cmd}`)
    fs.appendFileSync(zshrc, cmd)
}

async function getLocalAntora() {
    const antoraPath = await findUp('antora.yml')
    const branch = await exec('git branch --show-current')
    if (! antoraPath) {
        throw new Error("antora.yml not found in this project")
    }
    let antora = readAntora(antoraPath, branch)

    const dotGit = path.dirname(
        await findUp('.git', {type: "directory"}))

    const docsSite = getLocalDocsSite(dotGit)

    // copy the master playbook
    let playbook = readMasterPlaybook({docsSite})

    antora = {
        ...antora,
        repo: dotGit,
        repoShort: path.basename(dotGit),
        docsSite,
        playbook,
        branches: branch,
        ...startPath(dotGit, path.dirname(antoraPath)),
    }

    const sources = mapSources_local(antora)
    playbook.content.sources = sources
    return {
        ...antora,
        sources
    }
}

async function getRemoteAntora(antora) {
    // create the `antora` datastructure from a Github runner, with the content
    // repo checked out under `repo`

    let {repo} = antora
    const uniq = (arr) => [... new Set(arr)]

    process.chdir(repo)
    let changed = await execLines('git diff --name-only HEAD^')
    changed = uniq(changed.map((p) => path.dirname(p)))

    const antoraPath = await findAntora(changed)
    antora = {
        ...antora,
        ...readAntora(antoraPath, antora.branches),
        ...startPath(repo, path.dirname(antoraPath))
    }
    const sources = mapSources_remote(antora)
    antora.playbook.content.sources = sources
    return {
        ...antora,
        sources
    }
}

function writePlaybook({docsSite, previewConfig, playbook}, override = {}) {
    playbook = deepmerge({all: true})(
        playbook,
        override,
        previewConfig.override || {})
    console.dir(playbook, {depth: 4})

    // write out the preview playbook
    let previewPlaybook = path.resolve(docsSite, 'antora-playbook.preview.generated.yml')
    fs.writeFileSync(previewPlaybook, yaml.stringify(playbook))

    return playbook
}

async function buildAntora_local(antora) {
    const {docsSite} = antora
    let overridePlaybook = 
        path.resolve(docsSite, 'antora-playbook.preview.local.yml')
    const override = yaml.parse(
        fs.readFileSync(overridePlaybook).toString())
    const playbook = writePlaybook(antora, override)
    const output = playbook.output?.dir || './public'
    process.chdir(docsSite)
    await spawn('npx', 'antora', 'antora-playbook.preview.generated.yml')
    await spawn('open', `${output}/index.html`)
}

async function buildAntora_remote(antora) {
    console.dir({antora}, {depth: 4})
    const playbook = writePlaybook(antora)
}

//////////
// HELPER FUNCTIONS

function readMasterPlaybook({docsSite}) {
    let masterPlaybook = path.resolve(docsSite, 'antora-playbook.yml')
    return yaml.parse(
        fs.readFileSync(masterPlaybook).toString())
}

function readAntora(antoraPath, branch) {
    let antora = yaml.parse(
        fs.readFileSync(antoraPath).toString())

    antora.previewConfig =
        antora.ext?.preview?.[branch] || 
        antora.ext?.preview?.DEFAULT || {}

    return antora
}

async function findAntora(paths) {
    for (let p of paths) {
        let a 
        if (a = findUp('antora.yml', {cwd: path.resolve(p)})) { return a}
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

function make_resolveLocal(baseRepo) {
    console.log({baseRepo})
    const repoPath = ((process.env.REPO_PATH || '..')
        .split(':')
        .map((p) => path.resolve(baseRepo, p)))

    return (repo) =>
         repoPath
            .map((p) => path.resolve(p, repo))
            .find((p) => fs.existsSync(p))
}

function make_resolveRemote(sources) {
    const dict = sources.reduce(
        (acc, {url}) => {
            let name = path.basename(url, '.git')
            return {...acc, [name]: url}
        },
        {})
    
    return (repo) =>
        dict[repo]
}

function mapSources_local(antora) {
    console.log(antora)
    const resolver = make_resolveLocal(antora.docsSite)
    return mapSources({...antora, resolver})
}

function mapSources_remote(antora) {
    const resolver = make_resolveRemote(antora.playbook.content.sources)
    return mapSources({...antora, resolver})
}

function mapSources({repo, repoShort, start_path, previewConfig, resolver}) {
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

async function exec(cmd) {
    let { stdout, stderr } = await doExec(cmd)

    if (stderr.length) {
        console.error(stderr)
    }
    if (stdout.length) {
        return stdout.trimEnd()
    }
}

async function execLines(cmd) {
    const ret = await exec(cmd)
    return ret.split(/\r?\n/g)
}

// async, so call with `await` (uses Promises)
// see https://stackoverflow.com/questions/58570325/how-to-turn-child-process-spawns-promise-syntax-to-async-await-syntax
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
            if (code) {
                throw new Error(`Command [${command.join(' ')}] returned ${code}`)
            }
            else {
                resolve(code)
            }
        })
    })
}
