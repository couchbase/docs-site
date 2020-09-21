'use strict'

const yaml = require('js-yaml')
const fs = require('fs')

PLAYBOOK_FILE = process.argv[2] || '../antora-playbook.yml'

const playbook = yaml.safeLoad(fs.readFileSync(PLAYBOOK_FILE, 'utf8').trim())
playbook.content.sources = playbook.content.sources.filter((it) => !it.url.startsWith('https://git@'))
fs.writeFileSync(PLAYBOOK_FILE, yaml.safeDump(playbook, { noArrayIndent: true, lineWidth: -1 }), 'utf8')
