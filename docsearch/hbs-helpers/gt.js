const gt = (a, b) => a > b

module.exports.register = (hbs) => hbs.registerHelper('gt', gt)
