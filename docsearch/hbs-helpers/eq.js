const eq = (a, b) => a === b

module.exports.register = (hbs) => hbs.registerHelper('eq', eq)
