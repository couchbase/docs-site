const versioned = (components) => components.filter(({ latest }) => latest !== 'master')

module.exports.register = (hbs) => hbs.registerHelper('versioned', versioned)
