// this test file is designed to be run with Mocha
const assert = require('assert')
const ok = specify
const { parseBranches, renderPage } = require('../lib/merge-prs.js')

describe('parseBranches', function () {
  ok('plain names have no recipe', function () {
    const { branches, recipes } = parseBranches(['release/8.5', 'release/7.6'])
    assert.deepEqual(branches, ['release/8.5', 'release/7.6'])
    assert.deepEqual([...recipes.values()], [{ candidates: [], prs: false }, { candidates: [], prs: false }])
  })

  ok('a single string is accepted', function () {
    assert.deepEqual(parseBranches('main').branches, ['main'])
  })

  ok("'+*' means the base's own PRs", function () {
    const { branches, recipes } = parseBranches(['release/8.5+*'])
    assert.deepEqual(branches, ['release/8.5'])
    assert.deepEqual(recipes.get('release/8.5'), { candidates: [], prs: true })
  })

  ok('candidates are collapsed to the base, in order', function () {
    const { branches, recipes } = parseBranches(['release/8.5+one+two', 'release/7.6'])
    assert.deepEqual(branches, ['release/8.5', 'release/7.6'])
    assert.deepEqual(recipes.get('release/8.5'), { candidates: ['one', 'two'], prs: false })
    assert.deepEqual(recipes.get('release/7.6'), { candidates: [], prs: false })
  })

  ok('candidates and * combine', function () {
    const { recipes } = parseBranches(['release/8.5+one+*'])
    assert.deepEqual(recipes.get('release/8.5'), { candidates: ['one'], prs: true })
  })

  ok('a plain entry alongside a recipe for the same base is absorbed (union-merged diff)', function () {
    const { branches, recipes } = parseBranches(['release/8.5', 'release/7.6', 'release/8.5+october'])
    assert.deepEqual(branches, ['release/8.5', 'release/7.6'])
    assert.deepEqual(recipes.get('release/8.5').candidates, ['october'])
  })

  ok('no branches', function () {
    assert.deepEqual(parseBranches(undefined).branches, [])
  })
})

describe('renderPage', function () {
  const report = {
    base: 'release/8.5',
    baseSha: 'abcdef0123456789',
    headSha: '0123456789abcdef',
    candidates: [
      { branch: 'october-release', behindBy: 3, status: 'resolved', note: 'took both', stat: '2 files changed, 5 insertions(+)' },
      { branch: 'broken', behindBy: 0, status: 'failed', note: 'could not fetch' },
    ],
    prs: [
      { number: 1, title: 'Plain', url: 'https://github.com/o/r/pull/1', author: 'alice', target: 'release/8.5', status: 'merged', note: '', stat: '1 file changed, 1 insertion(+)' },
      { number: 2, title: 'Pipes | and ] brackets <b>', url: 'https://github.com/o/r/pull/2', author: 'bob', target: 'october-release', status: 'failed', note: 'nope | ]' },
      { number: 3, title: 'Review', url: 'https://github.com/o/r/pull/3', author: 'carol', target: 'release/8.5', status: 'skipped', note: 'changes requested' },
    ],
  }
  const page = renderPage([{ url: 'https://github.com/o/r', branch: 'release/8.5', report, patchName: 'merge-prs/r-release_8.5.patch' }], new Date('2026-10-26T12:00:00Z'))

  ok('has a title, timestamp, and links only to things that exist on GitHub', function () {
    assert.match(page, /^= Merged pull requests/)
    assert.match(page, /2026-10-26T12:00:00.000Z/)
    assert.match(page, /https:\/\/github\.com\/o\/r\/commit\/abcdef0123456789\[`abcdef01`\]/)
    // the result commit is local to the build: shown, but not linked
    assert.ok(!page.includes('/commit/0123456789abcdef'))
    assert.match(page, /giving `01234567`/)
  })

  ok('links candidates to a compare view and PRs to their diff, with stats', function () {
    assert.ok(page.includes('https://github.com/o/r/compare/release/8.5...october-release[compare]'))
    assert.match(page, /Merged \(pass:specialchars\[1 file changed, 1 insertion\(\+\)\]\)/)
  })

  ok('lists candidates with staleness and failures', function () {
    assert.match(page, /october-release.*: resolved, 3 commit\(s\) behind/)
    assert.match(page, /\[CAUTION\]/)
    assert.match(page, /could not fetch/)
  })

  ok('escapes untrusted text so table cells and macros stay intact', function () {
    assert.ok(page.includes('pass:specialchars[Pipes \\| and \\] brackets <b>]'), page)
    assert.ok(page.includes('pass:specialchars[nope \\| \\]]'), page)
  })

  ok('has one table row per PR', function () {
    assert.equal(page.split('\n').filter((l) => /^\|https:\/\/github\.com\/o\/r\/pull\//.test(l)).length, 3)
  })

  ok('says so when there is nothing to merge', function () {
    const empty = renderPage([{ url: 'https://github.com/o/r', branch: 'b', report: { ...report, candidates: [], prs: [] } }], new Date())
    assert.match(empty, /No open pull requests were found/)
  })
})
