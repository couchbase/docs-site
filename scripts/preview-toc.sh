#!/bin/bash

INPUT=builds.json
TOC=builds.html

# GH_ACTOR=osfameron
# GH_DATE=`date -Iseconds`
# GH_BUILD_URL=https://github.com/blah/blah
# PREVIEW_SUBDIR=wibble

jq --arg GH_ACTOR "$GH_ACTOR" \
   --arg PREVIEW_SUBDIR "$PREVIEW_SUBDIR" \
   --arg GH_DATE "$GH_DATE" \
   --arg GH_BUILD_URL "$GH_BUILD_URL" \
    '.[$PREVIEW_SUBDIR] |= { actor: $GH_ACTOR, date: $GH_DATE, url: $GH_BUILD_URL, builds: (.builds + 1), firstbuild: (.firstbuild // $GH_DATE) }' \
    $INPUT > $INPUT.new

mv $INPUT.new $INPUT

node - <<END
const handlebars = require('handlebars')
const fs = require('node:fs')
const sortByRecent = (builds) => 
    Object.entries(builds)
        .map(([k,v]) => ({...v, subdirectory: k}))
        .toSorted((a,b) => a.date > b.date ? -1 : (a.date === b.date ? 0 : 1))

handlebars.registerHelper('sortByRecent', sortByRecent)

const template = handlebars.compile(
fs.readFileSync("scripts/preview-toc.hbs").toString()) 
        
const data = JSON.parse(fs.readFileSync("$INPUT").toString())
const page = template(data)     
fs.writeFileSync("$TOC", page)
END
