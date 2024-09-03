'use strict'

module.exports.register =  ({playbook}) => {

    const tags_db = "include-tags.db"

    console.log(`Preparing include tag counter ${playbook.site.title}. ...`)

    const db = require('better-sqlite3')(tags_db, {verbose: console.log})
    db.pragma('journal_mode = WAL')

    db.exec(`DROP TABLE IF EXISTS includeTags`)
    db.exec(`DROP TABLE IF EXISTS SourceTags`)
    db.exec(`
    
          CREATE TABLE  includeTags (
          include_id INTEGER PRIMARY KEY AUTOINCREMENT, 
          doc_file_path TEXT,
          inclusion_path TEXT,
          tag TEXT
          )`)

    db.exec(`
          CREATE TABLE sourceTags (
          source_id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_path TEXT,
          tag TEXT
        )`)

    db.close()

}
