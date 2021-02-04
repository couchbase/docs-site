const versioned = (components) => components.filter(({ latest, versions }) => latest !== 'master' && versions.length)

module.exports.register = (hbs) => hbs.registerHelper('versioned', versioned)
