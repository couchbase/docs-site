#!/usr/bin/env zx
'use strict'
import _ from "lodash"

$.verbose = false

/** Usage:
 *   ./playbook.mjs [--update] [--truncate] [--patch <patch-file>] [--playbook <playbook-file>] [<patch-file>] [<playbook-file>]
 *
 *   e.g.:
 *
 *      ./playbook.mjs --playbook antora-playbook.yml --patch patch.yml
 *   or
 *      ./playbook.mjs patch.yml --update            # update the patchfile in place
 *      ./playbook.mjs patch.yml --truncate          # truncat the patchfile to { $from: ..., $patch: ... }
 *      ./playbook.mjs patch.yml > new-playbook.yml
 *
 * playbook-file: a standard Antora playbook
 *
 * patch-file: a yml file with just the keys that you wish to *change*.
 * see the `patch.yml` and `patch-staging.yml` files for examples.
 *
 *
 ** Operators
 *
 * The following operators are provided:
 *
 * $from: identify the playbook to generate
 * $patch: contains the tree to change
 * $meta: replaced with metadata
 *
 * $add: add an item to the end of a list
 * $prepend: add an item to the beginning of list
 * e.g:
        asciidoc:
          extensions:
            $add: 
              - '@asciidoctor/tabs'

 * $without: remove an item from a list
 * e.g:
        asciidoc:
          extensions:
            $without: asciidoctor-external-callout


 * $filter: restrict a list of objects, where the given fields match
 * e.g:
 * In this example, only those sources which have `tags: mobile` will be selected.
 * You can provide multiple key/values that must all match.
 *
        content:
          sources:
            $filter:
              tags: mobile

 * $prune: Keep only X branches
 * This operator is specialised for content.sources
 * e.g.
 * Here we only keep the first 2 branches (for example ([release/7.2, release/7.1]`)
        content:
          sources:
            $prune: 2

 * $local: resolve sources to the ones you have checked out locally
 * e.g.
 * We work through all of the sources like `https://github.com/couchbasecloud/couchbase-cloud`
 * and look in each of the `paths` provided to see if there is a local directory matching.
 *
 * As many writers keep all their code in a single directory like ~/code, they might have:

    ~/
        code/
            couchbase-cloud
            docs-site

 * Therefore the default of `paths` is .. the parent directory.
 * We will then check if ../couchbase-cloud (e.g. ~/code/couchbase-cloud)
 * exists, and update the record if so.
 * If the `only` parameter is true, then we will remove all the remote sources.
 * If `head` is supplied, then use the HEAD branch (e.g. the version you have checked out)

        content:
          sources:
            $local:
              paths: ..
              only: true
              head:
      
 * $only: as an alternative to $filter, restrict the sources to specific repos
 * e.g:
 * (note how you can use the short name of the source)
        content:
          sources:
            $only:
              - docs-sync-gateway
              - docs-couchbase-lite
      
 * $override: update a specific source (using the short name) to apply any other operators.
 * e.g.:
 * Add `my-test-branch` as the *first* branch of `docs-sync-gateway`
 *
        content:
          sources:
            $override:
              docs-sync-gateway:
                branches:
                  $prepend:
                    - my-test-branch
 * 
 * See patch.yml and patch-staging.yml for full examples.
 * Notice how these operators can be used with each other.
 *
 */
const patchFile = argv.patch ?? argv._.shift() ?? 'patch.yml'
const patch = YAML.parse(fs.readFileSync(patchFile).toString())
const $patch = patch.$patch

if (! $patch) {
  throw new Error("Patch file is missing $patch tree")
}



/** Helper function to wrap a single item in an array if required */
const toArray = (thing) => Array.isArray(thing) ? thing : [thing]

/** Helper function to do permissive comparison.
 * In particular:
 *
 * [1,2,3] == 2      (includes)
 * [1,2,3] == [1,2]  (includes all items)
 * 1 == true         (truthy value)
 * ALL == ??         (always true. Used to make sure docs-site matches `tags: ALL`
 * Everything else falls back to the === comparison operator 
 */
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

/**
  * @param {Object[]} sources - expects to be called only on `content.sources` from playbook
  * @param {Object}         config
  * @param {Array.<string>} config.paths - array of local filesystem paths to check for the git repo
  * @param {boolean}        config.only - if true, filter out all non-local sources
  * @param {boolean}        config.head - if true, only use HEAD
  *
  * We try to play nice with Author-mode by substituting HEAD if it matches a 
  * branch, or prepending it otherwise.
  * BUT this doesn't work great with feature-branches (really, we should check the antora.yml version)
  * In the meantime, use config.head as workaround
  */
async function $local (orig, {paths, only, head}) {
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
                    
                    if (head) {
                        return {...item, url: newPath, branches: ['HEAD'], local: true}
                    }
                    else {
                        // cleverness to try to match branches to HEAD
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

const matchRepo = (url, source) => {
    if (url === '.') {
        return source === 'docs-site'
    }
    return path.basename(url, '.git') === source
}

/**
  * @param {Object[]} sources - expects to be called only on `content.sources` from playbook
  * @param {Object} overrides - name/Object pairs to override
  * @param {Object} overrides."some-repo" - the patch description to apply to the matching source with.
  */
async function $override (sources, overrides) {
    for (const [source, override] of Object.entries(overrides)) {
        const idx = sources.findIndex(({url}) => matchRepo(url, source))
        if (idx >= 0) {
            await apply_patch(sources[idx], override)
        }
        else {
            throw new Error(`Source ${source} not found to $override`)
        }
    }

    return sources
}

/**
  * @param {Object[]} sources - expects to be called only on `content.sources` from playbook
  * @param {Array.<string>} only - just the names of repos to keep
  */
async function $only (sources, only) {   
    return sources.filter(({url, tags}) => 
        tags === 'ALL' || only.some(source => matchRepo(url, source)))
}


// Catalog of functions
const functions = {
    // explicit replace
    $replace: (_orig, param) => _.cloneDeep(param), // avoid YAML aliasing
    
    // append or prepend the data to an ARRAY
    $append:  (orig, param) => [...orig, ...param],
    $prepend: (orig, param) => [...param, ...orig],
    // remove item from array
    $without: (orig, param) => orig.filter(item => ! param.includes(item)),

    // filter a list by matching key
    $filter,
    
    // Special functions on content.sources
    $prune,
    $local,
    $override,
    $only
}

/**
 * Recursive function to apply the patch, by descending both the original
 * playbook and the patch at the same time, applying operators as required.
 */
async function apply_patch(node, patch) {

    for (const [k,v] of Object.entries(patch)) {

        // If the patch file contains an object, then... 
        if (v !== null && typeof v === 'object' && ! Array.isArray(v)) {
            for (const [kk, vv] of Object.entries(v)) {
                // EITHER: apply the $operator, if it's found in the functions catalog
                if (kk in functions) {
                    const ret = await functions[kk](node[k], vv)
                    node[k] = ret
                }
                // OR descend both sides of the tree and recurse
                else {
                    await apply_patch(node[k], patch[k])
                }
            }
        }
        // Otherwise (e.g. a plain value or an array) then we just assume this is a replacement value.
        else {
            node[k] = _.cloneDeep(v) // avoid YAML aliasing
        }
    }
}

var update = argv.update
const playbookFile = patch.$from ?? argv.playbook ?? argv._.shift() ?? 'antora-playbook.yml'
var playbook

if (argv.truncate) {
  update = true
  playbook = { $from: playbookFile, $patch }
}
else {
  playbook = YAML.parse(fs.readFileSync(playbookFile).toString())

  // Confirm which files we are composing
  console.error(`Composing ${playbookFile} with ${patchFile}`)


  await apply_patch(playbook, $patch)

  const $meta = {
    date: Date()
  }

  playbook = { $from: playbookFile, $meta, $patch, ...playbook }
}

const output = YAML.stringify(playbook)
if (update) {
  try {
    fs.copySync(patchFile, `${patchFile}~`)
    fs.writeFileSync(patchFile, output)
  }
  catch (err) {
    console.error(err)
  }
}
else {
  console.log(output)
}

