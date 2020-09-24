'use strict'

const fs = require('fs')

const NGINX_REWRITES_FILE = process.argv[2] || '../etc/nginx/snippets/rewrites.conf'
const NETLIFY_REDIRECTS_FILE = 'public/_redirects'

const rewrites = fs.readFileSync(NGINX_REWRITES_FILE, 'utf8')
const redirects = fs.readFileSync(NETLIFY_REDIRECTS_FILE, 'utf8').trimRight()
const currentUrlRedirects = [...rewrites.matchAll(/^set \$current_version_(?!\S+_api )(\S+) '([^']+)';/gm)].map(([, name, version]) => {
  name = name.replace(/_/g, '-').replace(/^(connector|sdk)-(.+)/, '$2-$1')
  return `/${name}/current/* /${name}/${version}/:splat 302!`
}).join('\n')
fs.writeFileSync(NETLIFY_REDIRECTS_FILE, currentUrlRedirects + '\n' + redirects + '\n', 'utf8')
