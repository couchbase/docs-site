'use strict'

const yaml = require('js-yaml')
const fs = require('fs')

const PLAYBOOK_FILE = process.argv[2] || '../antora-playbook.yml'

;(async () => {
  const playbook = yaml.safeLoad(fs.readFileSync(PLAYBOOK_FILE, 'utf-8').trim())
  playbook.content.sources = playbook.content.sources.filter((it) => !it.url.startsWith('https://git@'))
  fs.writeFileSync(PLAYBOOK_FILE, yaml.safeDump(playbook, { noArrayIndent: true, lineWidth: -1 }), 'utf-8')
})()
