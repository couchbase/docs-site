const versioned = (components) => components.filter(({ name, latest }) => name === 'home' || latest !== 'master')

module.exports.register = (hbs) => hbs.registerHelper('versioned', versioned)
