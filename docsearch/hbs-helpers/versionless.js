const versionless = (components) => components.filter(({ name, latest, versions }) => name !== 'home' && name !== 'tutorials' && latest === 'master' && versions.length)

module.exports.register = (hbs) => hbs.registerHelper('versionless', versionless)
