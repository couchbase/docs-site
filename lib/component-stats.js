const {JSDOM} = require('jsdom')

module.exports.register = function () {
  this.once('sitePublished', ({ playbook, contentCatalog }) => {
    contentCatalog.getComponents().forEach((component) => {
      component.versions.forEach((componentVersion, index) => {
        const pages = contentCatalog.getPages(it => it.src.component === componentVersion.name && it.src.version === componentVersion.version)

        const wc = pages.map(page => {
          const dom = new JSDOM(page.contents.toString())
          const node = dom.window.document.querySelector('article')
          if (node) {
            return wordcount(node.textContent)
          }
          else { return 0 }
        })
        console.log({
          component: componentVersion.name,
          version: componentVersion.version,
          pages: pages.length,
          words: sum(wc)
        })
      })
    })
    process.exit(1)
  })
}

function wordcount (words) {
  // very dumb wordcount function
  // won't deal gracefully with non-western scripts (which is fine for our use-case
  // as we don't have material content in those languages)
  return words.split(/\s+/).length
}

function sum (nums) {
  return nums.reduce( (a,b) => a+b, 0 )
}
