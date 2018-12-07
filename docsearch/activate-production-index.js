const algoliasearch = require('algoliasearch')
const fs = require('fs')

;(async () => {
  const env = fs.readFileSync('scraper/.env', 'utf-8')
  const { APPLICATION_ID: appId, API_KEY: apiKey } = env.trim().split('\n').reduce((vars, line) => {
    const [ k, v ] = line.split('=')
    vars[k] = v
    return vars
  }, {})
  const algoliaclient = algoliasearch(appId, apiKey)
  await algoliaclient.deleteIndex('prod_docs_couchbase')
  await algoliaclient.moveIndex('next_docs_couchbase', 'prod_docs_couchbase')
})()
