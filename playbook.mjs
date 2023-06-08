#!/usr/bin/env zx
'use strict'

$.verbose = false

const playbookFile = argv.playbook ?? argv._.shift() ?? 'antora-playbook.yml'
const patchFile = argv.patch ?? argv._.shift() ?? 'patch.yml'

console.info(`Composing ${playbookFile} with ${patchFile}`)

var playbook = YAML.parse(fs.readFileSync(playbookFile).toString())
const patch = YAML.parse(fs.readFileSync(patchFile).toString())

// HELPER FUNCTIONS
const toArray = (thing) => Array.isArray(thing) ? thing : [thing]

// slightly permissive comparison
function cmp (a, b) {
    if (Array.isArray(a)) {
        if (Array.isArray(b)) {
            return b.every(bb => a.includes(bb))
        }
        else {
            return a.includes(b)
        }
    }
    else if (typeof b === 'boolean') {
        return a ? b : !b
    }
    else if (a === 'ALL') {
        return true
    }
    else {
        return a === b
    }
}

/**
  * @param {Object[]} sources - expects to be called only on `content.sources` from playbook
  * @param {Object}         config
  * @param {Array.<string>} config.paths - array of local filesystem paths to check for the git repo
  * @param {boolean}        config.only - if true, filter out all non-local sources
  *
  * We try to play nice with Author-mode by substituting HEAD if it matches a branch, or prepending it otherwise.
  */
async function $local (orig, {paths, only}) {
    const repoPaths = toArray(paths ?? ['..'])
    const withLocal = await Promise.all(
        orig.map(async item => {
            const {url, branches} = item
            
            if (url.match(/^[.\/]/)) {
                return {...item, local: true}
            }

            const repo = path.basename(url, '.git')
            for (const repoPath of repoPaths) {
                const newPath = path.join(repoPath, repo)
                try {
                    fs.accessSync(newPath, fs.constants.R_OK)
                    
                    const HEAD = (await $`git -C ${newPath} rev-parse HEAD`).stdout.trim()
                    
                    const b1 = await Promise.all(branches.map(async b => {
                        try {
                            const ref = (await $`git -C ${newPath} rev-parse ${b}`).stdout.trim()
                            return (ref === HEAD) ? 'HEAD' : b
                        }
                        catch (e) {
                            // filter this one out as presumably it doesn't exist locally
                            return 
                        }
                    }))
                    const b2 = b1.filter(a=>a !== undefined)
                    const b3 = b2.includes('HEAD') ? b2 : ['HEAD', ...b2]
                    return {...item, url: newPath, branches: b3, local: true}
                }
                catch(e) {
                    continue
                    // do nothing as file doesn't exist here
                }
            }
            return item
        })
    )
            
    if (only) {
        return withLocal.filter(({local}) => local)
    }
    else {
        return withLocal
    }
}

/**
  * @param {Object[]} sources - expects to be called only on `content.sources` from playbook
  * @param {number} limit - the number of branches to keep.
  */
function $prune (sources, limit) {
    return sources.map(source => 
        ('branches' in source) ?
            {...source, branches: toArray(source.branches).slice(0, limit)}
            : source)
}

/**
  * @param {Array.<>} node - any array node in playbook
  * @param {Object} filters - object of key/values to filter for (using `cmp` function)
  *                           All provided filters must match.
  */
function $filter  (orig, param) {
    if (! Array.isArray(orig)) {
        throw new Error(`$filter run on something that isn't an array! ${JSON.stringify(param)}`)
    }
    return orig.filter(item =>
        Object.entries(param)
            .every(([k,v]) => cmp(item[k], v)))
}

const functions = {
    // explicit override
    $replace: (_orig, param) => param,
    
    // append or prepend the data to an ARRAY
    $append:  (orig, param) => [...orig, ...param],
    $prepend: (orig, param) => [...param, ...orig],
    // remove item from array
    $without: (orig, param) => orig.filter(item => ! param.includes(item)),

    // filter a list by matching key
    $filter,
    
    // Special functions on content.sources
    $prune,
    $local
}

async function apply_patch(node, patch) {
    for (const [k,v] of Object.entries(patch)) {
        if (v !== null && typeof v === 'object' && ! Array.isArray(v)) {
            for (const [kk, vv] of Object.entries(v)) {
                if (kk in functions) {
                    const ret = await functions[kk](node[k], vv)
                    node[k] = ret
                }
                else {
                    await apply_patch(node[k], patch[k])
                }
            }
        }
        else {
            node[k] = v
        }
    }
}

await apply_patch(playbook, patch)

console.log(YAML.stringify(playbook))

