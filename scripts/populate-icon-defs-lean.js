'use strict'

// Usage:
//   node scripts/populate-icon-defs-lean.js [siteDir=public]
// Notes:

const fs = require('fs')
const ospath = require('path')


const REQUIRED_ICON_NAMES_RX = /\biconNames: *(\[.*?\])/s

function camelCase (str) {
  return str.replace(/-(.)/g, (_, l) => l.toUpperCase())
}

function tryResolve (moduleId) {
  try { require.resolve(moduleId); return true } catch { return false }
}

function loadStubRequiredIcons (iconDefsFile) {
  try {
    const contents = fs.readFileSync(iconDefsFile, 'utf8')
    const m = contents.match(REQUIRED_ICON_NAMES_RX)
    if (!m) return { required: [], comment: null }
    const json = m[1].replace(/'/g, '"')
    const required = JSON.parse(json)
    // Reconstruct a comment to preserve the stub’s intent in the generated file
    const comment = `/*! iconNames: [${required.map((s) => `'${s}'`).join(', ')}] */`
    return { required, comment }
  } catch {
    return { required: [], comment: null }
  }
}

// v4 shim map: converts 'fa fa-<name>' to real prefix/name
const iconShims = require('@fortawesome/fontawesome-free/js/v4-shims').reduce((accum, it) => {
  accum['fa-' + it[0]] = [it[1] || 'fas', 'fa-' + (it[2] || it[0])]
  return accum
}, {})

function applyShimIfV4 (prefix, iconName) {
  if (prefix !== 'fa') return [prefix, iconName]
  const shim = iconShims[iconName]
  if (!shim) return [prefix, iconName]
  const [realPrefix, realIconName] = shim
  return [realPrefix, realIconName]
}

function pkgBaseForPrefix (prefix) {
  // Prefer Pro if available, else Free
  const pro = {
    fa: '@fortawesome/pro-solid-svg-icons/',
    fas: '@fortawesome/pro-solid-svg-icons/',
    far: '@fortawesome/pro-regular-svg-icons/',
    fal: '@fortawesome/pro-light-svg-icons/',
  }[prefix]
  const free = {
    fa: '@fortawesome/free-solid-svg-icons/',
    fas: '@fortawesome/free-solid-svg-icons/',
    far: '@fortawesome/free-regular-svg-icons/',
    fab: '@fortawesome/free-brands-svg-icons/',
  }[prefix]
  if (pro && tryResolve(pro)) return pro
  if (free && tryResolve(free)) return free
  return null
}

function loadIcon (pfx, name) {

  const camel = camelCase(name) // 'fa-coffee' -> 'faCoffee'
  const base = pkgBaseForPrefix(pfx)
  if (!base) return null
  const modPath = base + camel
  if (!tryResolve(modPath)) return null
  const mod = require(modPath)
  const def = mod[camel]
  return def ? { ...def, prefix: pfx } : null
}

function uniq (arr) {
  const seen = {}
  return arr.filter((it) => {
    if (seen[it]) return false
    seen[it] = true
    return true
  })
}

async function main () {
  const iconsList = process.argv[2]
  if (! iconsList) {
    throw new Error("Missing iconsList argument")
  }

  const siteDir = process.argv[3] || 'public'

  const iconDefsFile = ospath.join(siteDir, '_/js/vendor/fontawesome-icon-defs.js')

  const iconKeys = fs.readFileSync(iconsList, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const {
    required: stubRequired,
    comment: stubComment } = loadStubRequiredIcons(iconDefsFile)

  const icons = uniq(
    [...iconKeys, ...stubRequired].map(
      (iconKey) => {
        const [prefix, iconName] = iconKey.split(' ')
        const [realPrefix, realIconName] = applyShimIfV4(prefix, iconName)
        return [realPrefix,realIconName]
      }
  ))

  // Resolve and load per-icon defs
  const defs = []
  const seen = new Set()
  for (let [prefix,iconName] of icons) {
    const def = loadIcon(prefix, iconName)
    if (def) {
      const k = def.prefix + ' ' + iconName
      if (!seen.has(k)) { defs.push(def); seen.add(k) }
    } else if (prefix === 'fal') {
      console.log(`FontAwesome Light icon missing or Pro not installed: ${iconName}`)
    }
    else {
        console.log(`Icon not found: ${iconName}`)
    }
  }

  // iconNames: ['far fa-copy', 'fas fa-link', 'fab fa-github', 'fas fa-terminal', 'fal fa-external-link-alt']
  fs.writeFileSync(iconDefsFile, 
    `${stubComment || ''}
     window.FontAwesomeIconDefs = ${JSON.stringify(defs)}\n`,
    'utf8')

  console.log(`Wrote ${defs.length} icon defs to ${iconDefsFile}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
