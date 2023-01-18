'use strict'

module.exports.register = function () {
  this.once('playbookBuilt', function ({ playbook }) {
    if (playbook.env.GIT_CREDENTIALS) return
    playbook.content.sources = playbook.content.sources.filter(({ url }) => !url.startsWith('https://git@'))
    this.updateVariables({ playbook })
  })
}
