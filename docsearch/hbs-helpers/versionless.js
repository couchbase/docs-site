const versionless = (components) => components.filter(({ name, latest }) => name !== 'tutorials' && latest === 'master')

module.exports.register = (hbs) => hbs.registerHelper('versionless', versionless)
