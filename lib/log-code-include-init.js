'use strict'

module.exports.tags_db = function () {

    const db = require('better-sqlite3')("include-tags.db", {/*verbose: console.log*/})
    db.pragma('journal_mode = WAL')
    return db
}

module.exports.register = function ({playbook}) {

    this.once('sitePublished', () => {

        const db = module.exports.tags_db()

        // Just to be sure.
        db.close()

        console.log(`Finished tags report:  ${playbook.site.title}. ...`)

    })

    console.log(`Preparing include tag counter ${playbook.site.title} . ...`)

    const db = module.exports.tags_db()

    db.exec(`DROP TABLE IF EXISTS includeTags`)
    db.exec(`DROP TABLE IF EXISTS SourceTags`)
    db.exec(`
    
          CREATE TABLE  includeTags (
          include_id INTEGER PRIMARY KEY AUTOINCREMENT, 
          doc_file_path TEXT,
          git_branch TEXT,
          inclusion_path TEXT,
          tag TEXT
          )`)

    db.exec(`
          CREATE TABLE sourceTags (
          source_id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_path TEXT,
          tag TEXT
        )`)
}
