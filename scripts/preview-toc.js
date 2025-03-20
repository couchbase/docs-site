'use strict'
const handlebars = require('handlebars')
const fs = require('fs')

let json = JSON.parse(fs.readFileSync('builds.json'))
const record = JSON.parse(fs.readFileSync('record.json'))

const args = {
    actor: process.env.GH_ACTOR,
    subdir: process.env.PREVIEW_SUBDIR,
    date: process.env.GH_DATE,
    build_url: process.env.GH_BUILD_URL
}

json[args.subdir] = {
    firstbuild: args.date,
    ...(json[args.subdir] || {}),
    ...args,
    builds: json[args.subdir]?.builds + 1,
    ...record
}

fs.writeFileSync('builds.json', JSON.stringify(json))

const sortByRecent = (builds) => 
    Object.entries(builds)
        .map(([k,v]) => ({...v, subdirectory: k}))
        .toSorted((a,b) => a.date > b.date ? -1 : (a.date === b.date ? 0 : 1))

handlebars.registerHelper('sortByRecent', sortByRecent)

const template = handlebars.compile(
    fs.readFileSync("scripts/preview-toc.hbs").toString()) 
        
const page = template(json)     
fs.writeFileSync('builds.html', page)
