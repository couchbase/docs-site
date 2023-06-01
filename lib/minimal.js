'use strict'

module.exports.register = function ({ playbook, config }) {
    const logger = this.getLogger('andora')
    
    this.on('contextStarted', ({ playbook }) => {
        logger.fatal('Context Started (antora logger)')
        console.log('Context Started (console.log)')
    })
    
    this.on('sitePublished', ({ playbook, siteAsciiDocConfig, siteCatalog, uiCatalog, contentCatalog, publications }) => {
        logger.fatal('Site Published (antora logger)')
        console.log('Site Published (console.log)')
    })
    
}




