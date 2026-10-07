'use strict'

// populate-icon-defs.js
// =============
//
//  Scans the Antora output in public/**/*.html for all uses of Fontawesome icons like:
//
//    <i class="fas fa-copy"></i>
//
//  Collates these together, and writes a file to
//
//    public/_/js/vendor/populate-icon-defs.js 
//
//  that contains the full SVG icon definitions for each of these icons.
//  This is used by the UI to substitue the icon images at runtime.
//
//  NOTE: the docs-ui/ bundle contains a default version of this file, which is only periodically
//  updated.
//  This script will however work on the *actual* output, so will honour newly added icons.
//
// Prerequisite:
// =============
//
//  $ npm ci
//
// Usage:
// =============
//
//  $ node scripts/populate-icon-defs.js public
//

// NOTE: original version of script was async, refactored to synchronous to simplify debugging
// Against a problematically large input that crashed our staging build, the dumb sync version
// takes around 7 seconds.
// We could reintroduce async code here to optimize, in due course.

const fs = require('fs')
const ospath = require('path')

const iconPacks = {
  fas: (() => {
    try {
      return require('@fortawesome/pro-solid-svg-icons')
    } catch (e) {
      return require('@fortawesome/free-solid-svg-icons')
    }
  })(),
  far: (() => {
    try {
      return require('@fortawesome/pro-regular-svg-icons')
    } catch (e) {
      return require('@fortawesome/free-regular-svg-icons')
    }
  })(),
  fal: (() => {
    try {
      return require('@fortawesome/pro-light-svg-icons')
    } catch (e) {
      console.log('FontAwesome Light icons not found.')
      return null    }
  })(),
  fab: require('@fortawesome/free-brands-svg-icons'),
}

iconPacks.fa = iconPacks.fas
const iconShims = require('@fortawesome/fontawesome-free/js/v4-shims').reduce((accum, it) => {
  accum['fa-' + it[0]] = [it[1] || 'fas', 'fa-' + (it[2] || it[0])]
  return accum
}, {})

// define patterns/regular expressions used in the scanning
const ICON_SIGNATURE_CS = '<i class="fa'
const ICON_RX = /<i class="fa[brs]? fa-[^" ]+/g
const REQUIRED_ICON_NAMES_RX = /\biconNames: *(\[.*?\])/

// on all *.html files under dir, run the provided function fn, and collate all results in a Set.
// e.g. all values will be unique

function runOnHtmlFiles (dir, fn) {
  const ret = new Set()
  const files = findHtmlFiles(dir)
  for (const path of files) {
      const val = fn(path)
      if (val) {
        for (const item of val) {
          ret.add(item)
        }
      }
  }
  return ret
}

// return a list of all HTML files (recursive, e.g. **/*.html)
function findHtmlFiles (dir) {
  const ret = []

  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dirent.isDirectory()) {
      const files = findHtmlFiles(ospath.join(dir, dirent.name))
      ret.push(...files)

    } else if (dirent.name.endsWith('.html')) {
      ret.push(ospath.join(dir, dirent.name))
    }
  }
  return ret
}

function camelCase (str) {
  return str.replace(/-(.)/g, (_, l) => l.toUpperCase())
}

// Return all icon names
// e.g. for example, an HTML file that contained these icon definitions
// 
//    <i class="fas fa-copy"></i>
//    <i class="far fa-save"></i>
//
// Would return ["fas fa-copy", "far fa-save"]

function getScannedNames(path) {
  const contents = fs.readFileSync(path)
  if (contents.includes(ICON_SIGNATURE_CS)) {
    return contents.toString()
      .match(ICON_RX)
      .map((it) => it.substr(10))
  }
  else {
    return undefined
  }
}

function scanForIconNames (dir) {
  const scanResult = runOnHtmlFiles(dir, getScannedNames)
  return [...scanResult] // Set to array
}

// On running the script, execute the following immediately invoked function expression (IIFE)
;(() => {

  const siteDir = process.argv[2] || 'public'

  let iconNames = scanForIconNames(siteDir)

  const iconDefsFile = ospath.join(siteDir, '_/js/vendor/fontawesome-icon-defs.js')
  // first we read the stub file. This starts with a comment with a list of icons that must *always* be included
  // e.g.
  // /*! iconNames: ['far fa-copy', 'fas fa-link', 'fab fa-github', 'fas fa-terminal', 'fal fa-external-link-alt'] */

  let contents = fs.readFileSync(iconDefsFile, 'utf8')
  let firstLine = contents.substr(0, contents.indexOf("\n"));

  try {
    const requiredIconNames = JSON.parse(firstLine.match(REQUIRED_ICON_NAMES_RX)[1].replace(/'/g, '"'))
    console.log(requiredIconNames)
    iconNames = [...new Set(iconNames.concat(requiredIconNames))]
  } catch (e) {
    // we didn't get a valid list of requiredIconNames, so don't write it back out to the new file
    firstLine = undefined
  }

  const iconDefs = new Map()

  for (const iconKey of iconNames) {
    const [iconPrefix, iconName] = iconKey.split(' ').slice(0, 2)
    let iconDef = (iconPacks[iconPrefix] || {})[camelCase(iconName)]

    if (iconDef) {
      iconDefs.set(iconKey, { ...iconDef, prefix: iconPrefix })
    } 
    else if (iconPrefix === 'fa') {
      const [realIconPrefix, realIconName] = iconShims[iconName] || []
      if (realIconName) {
        const realIconKey = `${realIconPrefix} ${realIconName}`
        if (
          !iconDefs.has(realIconKey) &&
          (iconDef = (iconPacks[realIconPrefix] || {})[camelCase(realIconName)])) 
        {
          iconDefs.set(realIconKey, { ...iconDef, prefix: realIconPrefix })
        }
      }
    }
  }

  // update the contents to the collated example, and write it out
  contents = 
    `${firstLine ? firstLine + "\n" : ''}window.FontAwesomeIconDefs = ${JSON.stringify([...iconDefs.values()])}\n`

  fs.writeFileSync(iconDefsFile, contents, 'utf8')
})()
