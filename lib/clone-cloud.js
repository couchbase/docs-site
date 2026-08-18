/* couchbase-cloud is a chonky boi
   so shallow/sparse clone it if we spot it in the playbook */

'use strict'
const path = require('node:path')
const child_process = require('node:child_process')
const util = require('util')
const fs = require('node:fs')
const exec = util.promisify(require('child_process').exec)

module.exports.register = function () {

  if (! process.env.ci) {
    console.log("Not in CI. Skipping clone-cloud")
    return
  }

  this.once('playbookBuilt', async function ({ playbook }) {

    const cloudIdx = playbook.content.sources.findIndex(s => s.url.match(/couchbasecloud\/couchbase-cloud/))
    if (cloudIdx) {
      // deep-copy playbook to allow it to be updated
      const env = playbook.env
      playbook = JSON.parse(JSON.stringify(playbook))

      const cloud = playbook.content.sources[cloudIdx]

      // playbook can have a single branch, or an array
      // of branches, but we'll assume only 1, which
      // holds for the moment for couchbase-cloud.
      const wrap = (i) => i instanceof Array ? i[0] : i
      const branch = wrap(cloud.branches || 'main')
      cloud.url = "../couchbase-cloud/"

      await spawn(
          {cwd: '..'},
          'git', 'clone',
            '--sparse',
            '--depth=1',
            '--branch', branch,
            'https://github.com/couchbasecloud/couchbase-cloud.git')
      await spawn(
          {cwd: '../couchbase-cloud'},
          'git', 'sparse-checkout',
            'add',
            'docs')

      // reinflate playbook env and update
      playbook.env = env
      this.updateVariables({ playbook })
    }
  })
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
