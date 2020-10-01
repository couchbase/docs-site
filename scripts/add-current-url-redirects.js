'use strict'

const fs = require('fs')

const NGINX_REWRITES_FILE = process.argv[2] || '../etc/nginx/snippets/rewrites.conf'
const NETLIFY_REDIRECTS_FILE = 'public/_redirects'
const CURRENT_VERSION_RX = /^set \$current_version_(?!\S+_api )(\S+) '([^']+)';/gm

const rewrites = fs.readFileSync(NGINX_REWRITES_FILE, 'utf8')
const redirects = fs.readFileSync(NETLIFY_REDIRECTS_FILE, 'utf8').trimRight()
const currentUrlRedirects = []
let match
while ((match = CURRENT_VERSION_RX.exec(rewrites)) != null) {
  const name = match[1].replace(/_/g, '-').replace(/^(connector|sdk)-(.+)/, '$2-$1')
  currentUrlRedirects.push(`/${name}/current/* /${name}/${match[2]}/:splat 302!`)
}
fs.writeFileSync(NETLIFY_REDIRECTS_FILE, currentUrlRedirects.join('\n') + '\n' + redirects + '\n', 'utf8')
