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
 ** $append: add an item to the end of a list
 * $prepend: add an item to the beginning of list
 * e.g:

      $patch:
        asciidoc:
          extensions:
            $append: 
              - '@asciidoctor/tabs'

 ** $without: remove an item from a list
 * e.g:

      $patch:
        asciidoc:
          extensions:
            $without: asciidoctor-external-callout


 ** $filter: restrict a list of objects, where the given fields match
 * e.g:
 * In this example, only those sources which have `tags: mobile` will be selected.
 * You can provide multiple key/values that must all match.
 *
      $patch:
        content:
          sources:
            $filter:
              tags: mobile

 ** $prune: Keep only X branches
 * This operator is specialised for content.sources
 * e.g.
 * Here we only keep the first 2 branches (for example ([release/7.2, release/7.1]`)

      $patch:
        content:
          sources:
            $prune: 2

 ** $local: resolve sources to the ones you have checked out locally
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

      $patch:
        content:
          sources:
            $local:
              paths: ..
              only: true
              head:
      
 ** $only: as an alternative to $filter, restrict the sources to specific repos
 * e.g:
 * (note how you can use the short name of the source)

      $patch:
        content:
          sources:
            $only:
              - docs-sync-gateway
              - docs-couchbase-lite
      
 ** $override: update a specific source (using the short name) to apply any other operators.
 * e.g.:
 * Add `my-test-branch` as the *first* branch of `docs-sync-gateway`
 *
      $patch:
        content:
          sources:
            $override:
              docs-sync-gateway:
                branches:
                  $prepend:
                    - my-test-branch
 * 
 ** $seq: apply multiple operators in turn to the same node
 *
    $patch:
      content:
          sources:
            $seq:
              - $prune: 1
              - $local:
                  paths:
                    - ..
 *
 * See patch.yml and patch-staging.yml for full examples.
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
function $filter  (node, param) {
    if (! Array.isArray(node)) {
        throw new Error(`$filter run on something that isn't an array! ${JSON.stringify(param)}`)
    }
    return node.filter(item =>
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
  */
 function $local (sources, {paths, only, head}) {
    const repoPaths = toArray(paths ?? ['..'])
    
    const overrideHead = head ? {branches: ['HEAD']} : {}
    
    return sources.flatMap(item => {
            const {url} = item
            
            // if url is already a local path, then wave it through
            if (url.match(/^[.\/]/)) {
                return [{...item, local: true}]
            }

            // check all of the possible paths
            const repo = path.basename(url, '.git')
            for (const repoPath of repoPaths) {
                const newPath = path.join(repoPath, repo)
                try {
                    fs.accessSync(newPath, fs.constants.R_OK)
                    
                    return [{...item, url: newPath, local: true, ...overrideHead}]
                }
                catch(e) {
                    continue
                    // do nothing as file doesn't exist here
                }
            }
            
            // Otherwise we either filter out, or return the value unchanged
            return only ? [] : [item]
        }
    )
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

const repoShort = (url) => url === '.' ?  'docs-site' : path.basename(url, '.git')

/**
  * @param {Object[]} sources - expects to be called only on `content.sources` from playbook
  * @param {Object} overrides - name/Object pairs to override
  * @param {Object} overrides."some-repo" - the patch description to apply to the matching source with.
  */
function $override (sources, overrides) {
  return sources.map(source => {
    const short = repoShort(source.url)
    if (short in overrides) {
      return apply_patch(source, overrides[short])
    }
    else {
      return source
    }
  })
}

/**
  * @param {Object[]} sources - expects to be called only on `content.sources` from playbook
  * @param {Array.<string>} only - just the names of repos to keep
  */
function $only (sources, only) {   
    return sources.filter(({url, tags}) => 
        tags === 'ALL' || only.some(source => source === repoShort(url)))
}

function $seq (node, seq) {
  return seq.reduce(apply_function, node)
}


// Catalog of functions
const functions = {
    // explicit replace
    $replace: (node, param) => _.cloneDeep(param), // avoid YAML aliasing
    
    // append or prepend the data to an ARRAY
    $append:  (node, param) => [...node, ...param],
    $prepend: (node, param) => [...node, ...param],
    // remove item from array
    $without: (node, param) => node.filter(item => ! param.includes(item)),

    // filter a list by matching key
    $filter,
    
    // Special functions on content.sources
    $prune,
    $local,
    $override,
    $only,
    
    // Sequence functions
    $seq
}


const is_function = (obj) => {
  if (is_object(obj)) {
    const keys = Object.keys(obj)
    return (keys.length === 1) && keys[0] in functions
  }
}

const is_object = (node) => (node && typeof node === 'object' && ! Array.isArray(node))

const apply_function = (node, patch) => {
  const [fnName, param] = Object.entries(patch)[0]
  const fn = functions[fnName]
  return fn(node, param)
}

/**
 * Recursive function to apply the patch, by descending both the original
 * playbook and the patch at the same time, applying operators as required.
 */
function apply_patch(node, patch) {
  
  // while `null` is a valid value for a  node, or a patch replacement,
  // `undefined` signals the absence of a value.
  // Therefore we return the other side.
  if (patch === undefined) return node

  // Apply functions
  if (is_function(patch)) {
    return apply_function(node, patch)
  }

  // if both sides are objects, we iterate the superset of keys
  if (is_object(node) && is_object(patch)) {
    const keys = Object.keys({...node, ...patch})
    return Object.fromEntries(keys.map(k => [k, apply_patch(node[k], patch[k])]))
  }
  
  // the only remaining option: return the patched value.
  // we clone it, to avoid aliasing from the `$patch` section
  return _.cloneDeep(patch)
}


var update = argv.update
const playbookFile = patch.$from ?? argv.playbook ?? argv._.shift() ?? 'antora-playbook.yml'
var playbook

if (argv.truncate) {
  update = true
  playbook = { $from: playbookFile, $patch }
}
else {
  const original = YAML.parse(fs.readFileSync(playbookFile).toString())

  // Confirm which files we are composing
  console.error(`Composing ${playbookFile} with ${patchFile}`)

  const patched = apply_patch(original, $patch)

  const $meta = {
    date: Date()
  }

  // playbook = { $from: playbookFile, $meta, $patch, ...patched }
  playbook = patched
}

const output = YAML.stringify(playbook)

// if (update) {
//   try {
//     fs.copySync(patchFile, `${patchFile}~`)
//     fs.writeFileSync(patchFile, output)
//   }
//   catch (err) {
//     console.error(err)
//   }
// }
// else {
  console.log(output)
// }

