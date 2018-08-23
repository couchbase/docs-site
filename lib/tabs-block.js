const IdSeparatorChar = '-'
const InvalidIdCharsRx = /[^a-zA-Z0-9_]/g
const List = Opal.const_get_local(Opal.module(null, 'Asciidoctor'), 'List')
const ListItem = Opal.const_get_local(Opal.module(null, 'Asciidoctor'), 'ListItem')

const generateId = (str, idx) => `tabset${idx}_${str.toLowerCase().replace(InvalidIdCharsRx, IdSeparatorChar)}`

function tabsBlock () {
  this.onContext('example')
  this.process((parent, reader, attrs) => {
    const createHtmlFragment = (html) => this.createBlock(parent, 'pass', html)
    const tabsetIdx = parent.getDocument().counter('idx-tabset')
    const nodes = []
    nodes.push(createHtmlFragment('<div class="tabset is-loading">'))
    const container = this.parseContent(this.createBlock(parent, 'open'), reader)
    const sourceTabs = container.getBlocks()[0]
    if (!(sourceTabs && sourceTabs.getContext() === 'dlist' && sourceTabs.getItems().length)) return
    const tabs = List.$new(parent, 'ulist')
    tabs.addRole('tabs')
    const panes = {}
    sourceTabs.getItems().forEach(([[title], details]) => {
      const tab = ListItem.$new(tabs)
      tabs.$append(tab)
      const id = generateId(title.getText(), tabsetIdx)
      tab.text = `[[${id}]]${title.text}`
      let blocks = details.getBlocks()
      const numBlocks = blocks.length
      if (numBlocks) {
        if (blocks[0].context === 'open' && numBlocks === 1) blocks = blocks[0].getBlocks()
        panes[id] = blocks.map((block) => (block.parent = parent) && block)
      }
    })
    nodes.push(tabs)
    nodes.push(createHtmlFragment('<div class="content">'))
    Object.entries(panes).forEach(([id, blocks]) => {
      nodes.push(createHtmlFragment(`<div class="tab-pane" aria-labelledby="${id}">`))
      nodes.push(...blocks)
      nodes.push(createHtmlFragment('</div>'))
    })
    nodes.push(createHtmlFragment('</div>'))
    nodes.push(createHtmlFragment('</div>'))
    parent.blocks.push(...nodes)
  })
}

function register (registry, context) {
  registry.block('tabs', tabsBlock)
}

module.exports.register = register
