/*
 * USAGE:
 *
 *     antora my-playbook.yml | node scripts/collate-logs.js
 *
 * - Hides all Antora log lines, except the latest one
 * - Categorizes errors by file/error type (using some regex heuristics)
 * - Spits out any *non* Antora output (e.g. console.log)
 * - writes our `antora.log` with all categorized logs
 * - writes out `other.log` with all uncategorized logs
 * - uses a spinner if run locally, but without in CI
 */

'use strict';

const ora = require('ora').default
const chalk = require('chalk').default
const fs = require('node:fs')
const path = require('node:path')

console.log("Writing all logs to `antora.log`")
console.log("Writing uncategorized to `other.log`")

var spinner, columns
if (process.stdout.isTTY) {
    spinner = ora('Running Antora').start()
    columns = process.stdout.columns
}

function truncate (message, prefix = '') {
    return message.substring(0, columns - (prefix ? prefix.length + 5 : 3))
}

function flash(message='', prefix='') {
  if (spinner) {
      spinner.prefixText = prefix
      spinner.text = truncate(message, prefix)
  }
}

const readline = require('readline');

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

const files = {}
const errors = Object.fromEntries(log_parsers.map(a => [a.type, 0]))
errors.other = 0

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

var log_main = fs.createWriteStream("antora.log", {flags:'w'});
var log_other = fs.createWriteStream("other.log", {flags:'w'});

var obj
rl.on('line', (line) => {
    if ((line.match(/^\{/) && line.match(/\}$/))) {
      obj = JSON.parse(line)

      const repo = path.basename(obj?.source?.url || '', '.git')
      const filepath = obj?.file?.path
      const refname = obj?.source?.refname || ''

      // increment file counter
      if (filepath) {
        const match = filepath.match(/\bmodules\/([^/]+)\/pages\/(.+)/)
        // this is NOT really an Antora coordinate, as we
        // don't have the component name, only the repo.
        const coordish =
          (refname && `${refname}@`) +
          (repo && `${repo} `) +
          (match ? `${match[1]}\$${match[2]}` : filepath)

        files[coordish] ||= 0
        files[coordish] ++
      }

      const msg = obj.msg

      // for string messages, try each parser and *return early* if found
      if (typeof msg == 'string') {
        
        flash(msg, repo)
        let match
        for (const parser of log_parsers) {
          if (match = parser.regex.exec(msg)) {
            errors[parser.type]++; 
            obj.type = parser.type
            if (match.groups) { obj.details = {... match.groups} }
            log_main.write(JSON.stringify(obj) + "\n")
            return
          }
        }
      }
      errors['other']++
      log_other.write(line + "\n")
      log_main.write(line + "\n")
      return;
    }
    else {
      let format = chalk.red // chalk.reset, chalk.white, chalk.red etc.
      if (spinner) {
        spinner.prefixText = ''
        spinner.stopAndPersist({ symbol: "*", text: format(truncate(line)) }).start()
      } else {
        console.log("*", line)
        log_main.write(line + "\n")
      }
    }
});

rl.once('close', () => {
     // end of input
     spinner?.stop()
     log_main?.end();
     log_other?.end();
     const desc = (a,b) => b[1] - a[1]
     console.log("Top files with errors:", Object.entries(files).sort(desc).slice(0,10))
     console.log("Types of error", Object.entries(errors).filter(x=>x[1]).sort((a,b) => b[1] - a[1]) )
     console.log("Last Antora log message", obj) // last log message
 });

