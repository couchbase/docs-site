'use strict'


const sqlite = require('better-sqlite3')

const searchTag = /tag::([^\[]+)\[/g


function createExtensionGroup ({ file, contentCatalog }) {
    const resolveIncludeFile = contentCatalog.require('@antora/asciidoc-loader/include/resolve-include-file')
    const db = require('better-sqlite3')("include-tags.db", {})

    db.pragma('journal_mode = WAL')

    db.serialize({}, () => {

        db.run(`DROP TABLE IF EXISTS includeTags`)

        db.run(`DROP TABLE IF EXISTS sourceTags`)

        db.run(`
          CREATE TABLE includeTags (
          include_id INTEGER PRIMARY KEY AUTOINCREMENT, 
          inclusion_path TEXT,
          tag TEXT
          )`)

        db.run(`
          CREATE TABLE sourceTags (
          source_id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_path TEXT,
          tag TEXT
        )`)

    })

    db.close()

    return function () {

        this.includeProcessor(function () {

            this.prepend()
            this.process((doc, reader, target, attrs) => {
                const includeStackSize = reader.include_stack.length
                const defaultProcessor = doc.getExtensions().$include_processors().find((it) => it.instance !== this)
                defaultProcessor.process_method['$[]'](doc, reader, target, Opal.hash(attrs))
                const includeFile = resolveIncludeFile(target, file, reader.$cursor_at_prev_line(), contentCatalog)
                if (!includeFile || reader.include_stack.length === includeStackSize) return
                const includeFileSrc = includeFile.src || includeFile.context
                const resolvedTags = getTags(attrs)
                const includeContent = (includeFile.src.contents || includeFile.contents).toString()

                if (resolvedTags) {

                    const db = require('better-sqlite3')("include-tags.db", {})
                    db.pragma('journal_mode = WAL')

                    db.serialize({}, () => {

                        db.run(`
                          INSERT INTO includeTags (inclusion_path, tag)
                          VALUES(?,?)`,
                            includeFileSrc.path, [...resolvedTags.keys()].join(', '))

                    })

                    db.close()

                }

                getTagsFromSource(includeFileSrc.path, includeContent)

                return true
            })
        })
    }
}

function getTags (attrs) {
    if ('tag' in attrs) {
        const tag = attrs.tag
        if (tag && tag !== '!') {
            return tag.charAt() === '!' ? new Map().set(tag.substring(1), false) : new Map().set(tag, true)
        }
    } else if ('tags' in attrs) {
        const tags = attrs.tags
        if (tags) {
            const result = new Map()
            let any = false
            tags.split(~tags.indexOf(',') ? ',' : ';').forEach((tag) => {
                if (tag && tag !== '!') {
                    any = true
                    tag.charAt() === '!' ? result.set(tag.substring(1), false) : result.set(tag, true)
                }
            })
            if (any) return result
        }
    }
}
/*
 * Use a regular expression to find all the tags in the file. Later on
 * we can use this to find the tags that are not used as part of the
 * docs build.
 */
function getTagsFromSource(path, content) {


    const matches = content.matchAll(searchTag)

    const db = require('better-sqlite3')("include-tags.db", {verbose: console.log})
    db.pragma('journal_mode = WAL')

    for (const match of matches) {
        const tag = match[1]

        db.serialize({}, () => {

            db.run(`
              INSERT INTO sourceTags (source_path, tag)
              VALUES(?,?)`,
                path, tag)

        })

    }

    db.close()
}

module.exports.register = (registry, context) => {

    const toProc = (fn) => Object.defineProperty(fn, '$$arity', { value: fn.length })
    registry.$groups().$store('include-processor-spy', toProc(createExtensionGroup(context)))
    return registry
}
