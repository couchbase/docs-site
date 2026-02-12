const striptags = require('striptags');

const output = []

module.exports.register = function () {
  this.once('documentsConverted', ({ playbook, contentCatalog }) => {

    console.time('get-component-stats')

    contentCatalog.getComponents().forEach((component) => {
      component.versions.forEach((componentVersion, index) => {
        const pages = contentCatalog.getPages(it => it.src.component === componentVersion.name && it.src.version === componentVersion.version)

        const wc = pages.map(page => wordcount(striptags(page.contents.toString())))
        // const wc = pages.map(page => {
          // const dom = new JSDOM(page.contents.toString())
          // const node = dom.window.document.querySelector('article')
          // if (node) {
            // return wordcount(node.textContent)
          // }
          // else { return 0 }
        // })

        output.push({
          component: componentVersion.name,
          version: componentVersion.version,
          pages: pages.length,
          words: sum(wc)
        })
      })
    })

    console.timeEnd('get-component-stats')

  })

  this.once('sitePublished', ({}) => {
    console.log(output)

    const total_words = sum(output.map(c => c.words))
    console.log(`Total words: ${total_words}`)
  })
}

function wordcount (words) {
  // very dumb wordcount function
  // won't deal gracefully with non-western scripts (which is fine for our use-case
  // as we don't have material content in those languages)

  // we are doing essentially the moral equivalent of:
  // // return words.split(/\s+/).length
  // but we iterate the regexp, to avoid building up a huge data-structure
  // e.g. we trade off some speed in order to bound memory usage.

  const re = /\s+/g

  let count = 0
  while (re.exec(words)) {
    ++count;
  }
  return count
}

function sum (nums) {
  return nums.reduce( (a,b) => a+b, 0 )
}
