module.exports.register = function ({ config, playbook }) {
  playbook.content.sources.push({
    url:"../preview/" + process.env.PR_START_PATH,
    branches: "HEAD"
  })
}
