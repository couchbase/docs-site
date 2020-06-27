// Prerequisite:
//
//  $ npm --no-package-lock i
//
// Usage:
//
//  $ node populate-icon-defs.js ../public
//
const fs = require('fs')
const ospath = require('path')
const { promisify } = require('util')
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
  fab: require('@fortawesome/free-brands-svg-icons'),
}
iconPacks.fa = iconPacks.fas
const iconShims = require('@fortawesome/fontawesome-free/js/v4-shims').reduce((accum, it) => {
  accum['fa-' + it[0]] = [it[1] || 'fas', 'fa-' + (it[2] || it[0])]
  return accum
}, {})

const ICON_SIGNATURE_CS = '<i class="fa'
const ICON_RX = /<i class="fa[brs]? fa-[^" ]+/g
const REQUIRED_ICON_NAMES_RX = /\biconNames: *(\[.*?\])/

function runOnHtmlFiles (dir, fn) {
  return promisify(fs.readdir)(dir, { withFileTypes: true }).then((dirents) => {
    return dirents.reduce(async (accum, dirent) => {
      const entries = dirent.isDirectory()
        ? await runOnHtmlFiles(ospath.join(dir, dirent.name), fn)
        : (dirent.name.endsWith('.html') ? await fn(ospath.join(dir, dirent.name)) : undefined)
      return entries && entries.length ? (await accum).concat(entries) : accum
    }, [])
  })
}

function camelCase (str) {
  return str.replace(/-(.)/g, (_, l) => l.toUpperCase())
}

function scanForIconNames (dir) {
  return runOnHtmlFiles(dir, (path) =>
    promisify(fs.readFile)(path).then((contents) =>
      contents.includes(ICON_SIGNATURE_CS)
        ? contents.toString().match(ICON_RX).map((it) => it.substr(10))
        : undefined
    )
  ).then((scanResult) => [...new Set(scanResult)])
}

;(async () => {
  const siteDir = process.argv[2] || 'public'
  const iconDefsFile = ospath.join(siteDir, '_/js/vendor/fontawesome-icon-defs.js')
  const iconDefs = await scanForIconNames(siteDir).then((iconNames) =>
    promisify(fs.readFile)(iconDefsFile, 'utf8').then((contents) => {
      try {
        const requiredIconNames = JSON.parse(contents.match(REQUIRED_ICON_NAMES_RX)[1].replace(/'/g, '"'))
        iconNames = [...new Set(iconNames.concat(requiredIconNames))]
      } catch (e) {}
    }).then(() =>
      iconNames.reduce((accum, iconKey) => {
        const [iconPrefix, iconName] = iconKey.split(' ').slice(0, 2)
        let iconDef = (iconPacks[iconPrefix] || {})[camelCase(iconName)]
        if (iconDef) {
          return accum.set(iconKey, { ...iconDef, prefix: iconPrefix })
        } else if (iconPrefix === 'fa') {
          const [realIconPrefix, realIconName] = iconShims[iconName] || []
          if (
            realIconName &&
            !accum.has((iconKey = `${realIconPrefix} ${realIconName}`)) &&
            (iconDef = (iconPacks[realIconPrefix] || {})[camelCase(realIconName)])
          ) {
            return accum.set(iconKey, { ...iconDef, prefix: realIconPrefix })
          }
        }
        return accum
      }, new Map())
    )
  )
  await promisify(fs.writeFile)(
    iconDefsFile,
    `window.FontAwesomeIconDefs = ${JSON.stringify([...iconDefs.values()])}\n`,
    'utf8'
  )
})()
