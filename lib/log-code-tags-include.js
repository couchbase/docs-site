'use strict'


const {tags_db} = require('./log-code-include-init')
const searchTag = /tag::([^\[]+)\[/g

function createExtensionGroup ({ file, contentCatalog }) {

    const resolveIncludeFile = contentCatalog.require('@antora/asciidoc-loader/include/resolve-include-file')

    return function () {
        this.includeProcessor(function () {
            this.prepend()

            const db = tags_db()

            this.process((doc, reader, target, attrs) => {
                const includeStackSize = reader.include_stack.length
                const defaultProcessor = doc.getExtensions().$include_processors().find((it) => it.instance !== this)
                defaultProcessor.process_method['$[]'](doc, reader, target, Opal.hash(attrs))
                const includeFile = resolveIncludeFile(target, file, reader.$cursor_at_prev_line(), contentCatalog)
                if (!includeFile || reader.include_stack.length === includeStackSize) return
                const includeFileSrc = includeFile.src || includeFile.context
                console.log('include: ' + includeFileSrc.path)
                const resolvedTags = getTags(attrs)

                if (resolvedTags) {

                    console.log('with tags: ' + [...resolvedTags.keys()].join(', '))

                    const statement = db.prepare("INSERT INTO includeTags(doc_file_path, inclusion_path, tag) VALUES (?,?,?)")

                    // We need to split the tags up so they are recorded individually.
                    resolvedTags.forEach((_, key) => {
                        const info = statement.run(`${doc.getAttribute('docfile')}`,includeFileSrc.path,  key)
                        console.log(`Changes made ==> ${info.changes}`)
                    })

                }

                const includeContent = (includeFile.src.contents || includeFile.contents).toString()
                console.log(includeContent.length)

                getTagsFromSource(db, includeFileSrc.path, includeContent)

                return true
            })
        })
    }
}

function getTags (attrs) {
    if ('tag' in attrs) {
        const tag = attrs.tag
        if (tag && tag !== '!') {
            return tag.charAt() === '!' ? new Map().set(tag.substr(1), false) : new Map().set(tag, true)
        }
    } else if ('tags' in attrs) {
        const tags = attrs.tags
        if (tags) {
            const result = new Map()
            let any = false
            tags.split(~tags.indexOf(',') ? ',' : ';').forEach((tag) => {
                if (tag && tag !== '!') {
                    any = true
                    tag.charAt() === '!' ? result.set(tag.substr(1), false) : result.set(tag, true)
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
function getTagsFromSource(db, path, content) {


    const matches = content.matchAll(searchTag)


    for (const match of matches) {

        const tag = match[1]

        const statement = db.prepare(`
          INSERT INTO sourceTags (source_path, tag)
          VALUES(?,?)
          `)

        statement.run(path, tag)

    }


}

module.exports.register = (registry, context) => {

    const toProc = (fn) => Object.defineProperty(fn, '$$arity', { value: fn.length })
    registry.$groups().$store('include-processor-spy', toProc(createExtensionGroup(context)))
    return registry
}
