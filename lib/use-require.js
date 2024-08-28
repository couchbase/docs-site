'use strict'

module.exports.register = function () {
    this.once('contentClassified', ({ contentCatalog }) => {
        contentCatalog.require = this.require.bind(this)
    })
}