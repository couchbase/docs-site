'use strict'

const rank = (versions, version, latest) => {
  //if (version.version === latest) return 1
  //const latestVersionIdx = versions.findIndex((candidate) => candidate.version === latest)
  //const idx = versions.indexOf(version)
  //return idx + (idx < latestVersionIdx ? 2 : 1)
  return versions.indexOf(version) + 1
}

module.exports.register = (hbs) => hbs.registerHelper('rank', rank)
