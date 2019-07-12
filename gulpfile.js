'use strict'

const connect = require('gulp-connect')
const fs = require('fs')
const generator = require('@antora/site-generator-default')
const { reload: livereload } = process.env.LIVERELOAD === 'true' ? require('gulp-connect') : {}
const { series, src, watch } = require('gulp')
const yaml = require('js-yaml')

const playbookFilename = 'local-antora-playbook.yml'
const antoraArgs = ['--playbook', playbookFilename]
const playbook = yaml.safeLoad(fs.readFileSync(playbookFilename, 'utf8'))
const serverConfig = { name: 'Preview Site', livereload, port: 5000, root: playbook.output.dir || 'public' }
const watchPatterns = playbook.content.sources.filter((source) => !source.url.includes(':')).reduce((accum, source) => {
  accum.push(`${source.url}/${source.start_path ? source.start_path + '/' : ''}antora.yml`)
  accum.push(`${source.url}/${source.start_path ? source.start_path + '/' : ''}**/*.adoc`)
  return accum
}, [])

function generate (done) {
  // analogous to the `antora local-antora-playbook.yml` command
  generator(antoraArgs, process.env)
    .then(() => done())
    .catch((err) => {
      console.log(err)
      done()
    })
}

function serve (done) {
  connect.server(serverConfig, function () {
    this.server.on('close', done)
    watch(watchPatterns, generate)
    if (livereload) watch(this.root).on('change', (filepath) => src(filepath, { read: false }).pipe(livereload()))
  })
}

module.exports = { serve, generate, default: series(generate, serve) }
