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
  accum[it[0]] = [it[1] || 'fas', it[2] || it[0]]
  return accum
}, {})

const ICON_SIGNATURE_CS = '<i class="fa'
const ICON_RX = /<i class="fa[brs]? fa-[^" ]+/g
const ICON_NS = 'fa-'

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
  return str.replace(/(?:^|-)(.)/g, function (_, l) {
    return l.toUpperCase()
  })
}

function scanForIconNames (dir) {
  return runOnHtmlFiles(dir, (path) =>
    promisify(fs.readFile)(path).then((contents) =>
      contents.includes(ICON_SIGNATURE_CS)
        ? contents.toString().match(ICON_RX).map((it) => it.substr(10).replace(ICON_NS, ''))
        : undefined
    )
  ).then((scanResult) => [...new Set(scanResult)])
}

;(async () => {
  const siteDir = process.argv[2] || 'public'
  const iconDefs = await scanForIconNames(siteDir).then((iconNames) => {
    return iconNames.reduce((accum, iconKey) => {
      const [iconPrefix, iconName] = iconKey.split(' ').slice(0, 2)
      let iconDef = (iconPacks[iconPrefix] || {})['fa' + camelCase(iconName)]
      if (iconDef) {
        return accum.set(iconKey, { ...iconDef, prefix: iconPrefix })
      } else if (iconPrefix === 'fa') {
        const [realIconPrefix, realIconName] = iconShims[iconName] || []
        if (
          !accum.has((iconKey = `${realIconPrefix} ${realIconName}`)) &&
          realIconName &&
          (iconDef = (iconPacks[realIconPrefix] || {})['fa' + camelCase(realIconName)])
        ) {
          return accum.set(iconKey, { ...iconDef, prefix: realIconPrefix })
        }
      }
      return accum
    }, new Map())
  })
  await promisify(fs.writeFile)(
    ospath.join(siteDir, '_/js/vendor/fontawesome-icon-defs.js'),
    `window.FontAwesomeIconDefs = ${JSON.stringify([...iconDefs.values()])}\n`,
    'utf8'
  )
})()
