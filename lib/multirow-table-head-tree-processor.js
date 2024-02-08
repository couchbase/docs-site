function multirowTableHeadTreeProcessor () {
  this.process((doc) => {
    for (let table of doc.findBy({ context: 'table' })) {
      const hrows = table.getAttribute('hrows')
      if (hrows) {
        const rows = table.rows
        const moveRows = Math.min(+hrows - rows.head.length, rows.body.length)
        if (moveRows) rows.head.push(...rows.body.splice(0, moveRows))
      }
    }
  })
}

function register (registry, context) {
  if (context.file.contents.includes('hrows=')) {
    registry.treeProcessor(multirowTableHeadTreeProcessor)
  }
}

module.exports.register = register
