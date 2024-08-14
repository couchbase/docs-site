module.exports.register = function ({ config, playbook }) {
  playbook.content.sources.push({
    url: process.env.PR_URL,
    branches: process.env.PR_BRANCH
  })
}
