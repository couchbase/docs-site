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
 *
 * NOTE: this is invoked externally by docs-infra's workflows - keep its
 * CLI behavior (output filenames, console output) unchanged. The shared
 * classification/tallying logic lives in scripts/lib/antora-log-parser.js,
 * which scripts/preview-runner.js also uses.
 */

'use strict';

const ora = require('ora').default
const chalk = require('chalk').default
const fs = require('node:fs')
const readline = require('node:readline')
const { createCollator } = require('./lib/antora-log-parser')

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

const collator = createCollator()

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

var log_main = fs.createWriteStream("antora.log", {flags:'w'});
var log_other = fs.createWriteStream("other.log", {flags:'w'});

rl.on('line', (line) => {
    if ((line.match(/^\{/) && line.match(/\}$/))) {
      const obj = JSON.parse(line)
      const { repo, matched, msg } = collator.classify(obj)

      if (typeof msg === 'string') {
        flash(msg, repo)
      }

      if (matched) {
        log_main.write(JSON.stringify(obj) + "\n")
        return
      }
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
     const { topFiles, errorTypes, last } = collator.summary()
     console.log("Top files with errors:", topFiles)
     console.log("Types of error", errorTypes)
     console.log("Last Antora log message", last) // last log message
 });
