// this test file is designed to be run with Mocha
const assert = require('assert')
const fs = require('fs')
const ok = specify
const { spawnSync } = require('node:child_process')
const cheerio = require('cheerio')

describe('antora build with extensions', function () {

  before('run the antora build', function () {
    this.timeout(10000) // increase timeout for the Antora build
    spawnSync('antora', [
      '--log-level', 'fatal', 
      '--to-dir', 'test/build',
      'antora-playbook-test.yml'],
    {'stdio': 'inherit'})
  })

  ok('test files', function () { 
    // wanted these to happen after the build, so looks like they need to be within an OK?
    const files = 
      fs.readdirSync('test/fixtures/antora-output/').filter(
        file => file.match(/^extension.*\.html$/))
    
      for (const file of files) {
        const expected = fs.readFileSync(`test/fixtures/antora-output/${file}`, 'utf8')

        let actualHtml
        try {
          const actual = fs.readFileSync(`test/build/home/contribute/${file}`, 'utf8')

          const $ = cheerio.load(actual)
          actualHtml = $('article').html()
        }
        catch (err) {
          // We expect some files to NOT exist (e.g. to test embargoed content)
          // so we just return an empty string.
          // This means we can test the embargoed content by supplying a
          // zero-length fixture.

          console.error(`Error reading actual file for ${file}:`, err)
          actualHtml = ''
        }
        fs.writeFileSync(`test/fixtures/antora-output/${file}.actual`, actualHtml)

        assert.equal(actualHtml, expected)
    }
  })
})