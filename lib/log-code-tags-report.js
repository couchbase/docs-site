'use strict'

const fs = require('node:fs');

module.exports.register = function () {
  this.once('sitePublished', ({ contentCatalog, siteCatalog, uiCatalog }) => {

    console.log("Preparing tags report ...")

    if (fs.existsSync("./tags-report.adoc")) {
      fs.unlinkSync("./tags-report.adoc")
    }

    reportTags()

  })

  function reportTags() {

    const db = require('better-sqlite3')("include-tags.db", {})
    db.pragma('journal_mode = WAL')

    writeAdocLine(`= Tags Report\n\n`)

    writeAdocLine(`== Include Tag List\n\n`)

    writeAdocLine(`|===\n\n`)

    writeAdocLine(`| Tag | Path\n\n`)

    const rows = db.prepare(`select tag, inclusion_path from includeTags`)


    for (const row of rows.iterate()) {

      writeAdocLine(`| ${row['tag']} | ${row['inclusion_path']} \n\n`)

    }

    writeAdocLine(`\n|===\n\n`)


    writeAdocLine(`== Tags not used\n\n`)

    writeAdocLine(`|===\n\n`)

    writeAdocLine(`| Tag | Path\n\n`)

    const nrows = db.prepare(`SELECT DISTINCT tag, source_path FROM SourceTags WHERE tag NOT IN (SELECT tag from includeTags)`)

    for (const row of rows.iterate()) {

      writeAdocLine(`| ${row['tag']} | ${row['source_path']}\n\n`)

    }

    writeAdocLine(`\n|===\n\n`)





  }

  function writeAdocLine(str) {
    fs.appendFileSync("./tags-report.adoc", str, {"flag":"a+"})

  }
}




