/*
 * Shared classification logic for Antora's JSON-formatted log stream
 * (--log-format=json). Used by scripts/collate-logs.js (piped from a raw
 * `antora ...` invocation, relied on externally by docs-infra's workflows -
 * keep its behavior unchanged) and scripts/preview-runner.js (spawns Antora
 * itself and additionally needs exit-code / preview-URL awareness).
 */

'use strict'
const path = require('node:path')

const log_parsers = [
    {
        type: 'missingattr',
        regex: /skipping reference to missing attribute: (?<attr>.*)/
    },
    {
        type: 'unknownstyle',
        regex: /unknown style for (?<block>\w+) block: (?<style>.*)/
    },
    {
        type: 'targetnotfound',
        regex: /target of (?<what>\w+) not found: (?<xref>.*)/
    },
    {
        type: 'macro',
        regex: /unknown name for block macro: (?<macro>.*)/
    },
    {
        type: 'sequence',
        regex: /section title out of sequence: expected level (?<expected>\d), got level (?<actual>\d)/
    },
    {
        type: 'level0',
        regex: /level 0 sections can only be used when doctype is book/
    },
    {
        type: 'reuseid',
        regex: /id assigned to (?<block>\w+) already in use: (?<id>.*)/
    },
    {
        type: 'unterminated',
        regex: /unterminated (?<block>\w+) block/
    },
    {
        type: 'nocallout',
        regex: /no callout found for (?<id>.*)/
    },
    {
        type: 'tag',
        regex: /unexpected end tag '(?<tag>[^']*)' at line (?<line>\d*) of include file/
    },
    {
        type: 'tag',
        regex: /detected unclosed tag '(?<tag>[^']*)' starting at line (?<line>\d*) of include file/
    },
    {
        type: 'tag',
        regex: /tags '(?<tags>[^']*)' not found in include file/
    },
    {
        type: 'emptyid',
        regex: /invalid empty id detected in style attribute/
    },
    {
        type: 'includedropped',
        regex: /include dropped due to missing attribute: (?<include>.*)/
    },
    {
        type: 'tagnotfound',
        regex: /tag '(?<tag>[^']*)' not found in include file/
    },
    {
        type: 'missingattr',
        regex: /dropping line containing reference to missing attribute: (?<attr>.*)/
    },
    {
        type: 'reference',
        regex: /possible invalid reference: (?<reference>.*)/
    },
    {
        type: 'preprocessor',
        regex: /unmatched preprocessor directive: (?<directive>.*)/
    },
    {
        type: 'preprocessor',
        regex: /mismatched preprocessor directive: (?<got>.*?), expected (?<expected>.*)/
    },

    {
        type: 'substitution',
        regex: /invalid substitution type for (?<block>\w+): (?<substitution>.*)/
    },
    {
        type: 'footnote',
        regex: /invalid footnote reference: (?<reference>.*)/
    },
    {
        type: 'startpage',
        regex: /Start page specified for site not found: (?<startpage>.*)/
    },
    {
        type: 'nested',
        regex: /(?<section>.*) sections do not support nested sections/
    },
    {
        type: 'layout',
        regex: /page layout '(?<layout>[^']*)' specified by page not found; using default layout/
    },
    {
        type: 'localsource',
        regex: /Local content source does not exist: (?<source>.*)/
    },
    {
        type: 'callout',
        regex: /callout list item index: expected (?<expected>\d+), got (?<got>\d+)/
    },
    {
        type: 'existing',
        regex: /Page alias cannot reference an existing page: (?<coordinate>.*)\n\s*source: (?<source>.*)\n\s*existing page: (?<existing>.*)/m
    },
]

// Reproduces the `coordish` computation from the original collate-logs.js
// inline: NOT a true Antora coordinate (no component name), just something
// readable for the "top files with errors" summary.
function coordinate(obj) {
    const repo = path.basename(obj?.source?.url || '', '.git')
    const filepath = obj?.file?.path
    if (!filepath) return null
    const refname = obj?.source?.refname || ''
    const match = filepath.match(/\bmodules\/([^/]+)\/pages\/(.+)/)
    return (
        (refname && `${refname}@`) +
        (repo && `${repo} `) +
        (match ? `${match[1]}\$${match[2]}` : filepath))
}

// A collator tallies per-file and per-error-type counts across a stream of
// parsed JSON log records, exactly as scripts/collate-logs.js did inline.
function createCollator() {
    const files = {}
    const errors = Object.fromEntries(log_parsers.map(a => [a.type, 0]))
    errors.other = 0
    let last

    // classify(obj) mutates the running tallies for one parsed JSON log
    // record and returns { type, repo, matched, msg } describing it -
    // 'matched' mirrors whether the original inline loop found a parser
    // and took its early-return path (writing only to antora.log), vs
    // falling through to the 'other' bucket (written to both logs).
    function classify(obj) {
        last = obj
        const repo = path.basename(obj?.source?.url || '', '.git')

        const coord = coordinate(obj)
        if (coord) {
            files[coord] ||= 0
            files[coord]++
        }

        const msg = obj.msg
        if (typeof msg === 'string') {
            for (const parser of log_parsers) {
                const match = parser.regex.exec(msg)
                if (match) {
                    errors[parser.type]++
                    obj.type = parser.type
                    if (match.groups) { obj.details = { ...match.groups } }
                    return { type: parser.type, repo, matched: true, msg }
                }
            }
        }

        errors.other++
        return { type: 'other', repo, matched: false, msg }
    }

    function summary() {
        const desc = (a, b) => b[1] - a[1]
        return {
            topFiles: Object.entries(files).sort(desc).slice(0, 10),
            errorTypes: Object.entries(errors).filter(x => x[1]).sort((a, b) => b[1] - a[1]),
            last,
        }
    }

    return { classify, summary, files, errors }
}

module.exports = { log_parsers, createCollator }
