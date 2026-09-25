#!/usr/bin/env node
/*
 * see scripts/preview
 *
 * Runs the local Antora preview build, replacing the previous raw
 * `npx antora ...` invocation. Antora is asked for JSON-formatted logs so
 * this can classify/count warnings via scripts/lib/antora-log-parser.js
 * (shared with scripts/collate-logs.js) instead of dumping the raw firehose
 * to the terminal - the one thing the writer actually needs, the preview
 * URL(s), gets pulled out and shown prominently instead of buried in noise.
 *
 * Usage: node scripts/preview-runner.js [--debug]
 */

'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const readline = require('node:readline')
const path = require('node:path')
const ora = require('ora').default
const chalk = require('chalk').default
const { createCollator } = require('./lib/antora-log-parser')

const DEBUG = process.argv.includes('--debug')

// Antora prints "Open <url> in a browser to view ..." lines itself (once
// for the site, once for lib/report-tree.js's doctor report) but only when
// it thinks stdout is a real terminal. We're piping its output through
// this wrapper, so stdout is never a TTY from Antora's point of view -
// forcing IS_TTY in its env keeps those lines flowing so we can capture them.
const OPEN_LINE = /^Open (\S+) in a browser to view (your site|the doctor's report)\.$/

// Antora cleans its --url destination directory as part of publishing, which
// would silently unlink a log file opened inside preview/ before the build
// finishes (the fd stays valid, but the data is gone once we exit). Write
// outside preview/ during the run and move the finished log in afterwards -
// scripts/preview's old `tee ... && mv ... preview/debug.log` did the same.
const LOG_TMP_PATH = DEBUG ? 'preview-debug.log.tmp' : 'preview-last-build.log.tmp'
const LOG_PATH = path.join('preview', DEBUG ? 'debug.log' : 'last-build.log')
const logStream = fs.createWriteStream(LOG_TMP_PATH, { flags: 'w' })

const collator = createCollator()
const openLines = []
const rawLines = []

const isTTY = process.stdout.isTTY
const spinner = isTTY ? ora('Building preview…').start() : null

function totalNotices() {
    return Object.values(collator.errors).reduce((a, b) => a + b, 0)
}

function updateSpinner() {
    if (!spinner) return
    const n = totalNotices()
    spinner.text = `Building preview…${n ? ` (${n} notice${n === 1 ? '' : 's'} so far)` : ''}`
}

function persistLive(text) {
    if (!DEBUG) return
    if (spinner) {
        spinner.stopAndPersist({ symbol: '*', text }).start()
    } else {
        console.log(text)
    }
}

function handleLine(line) {
    logStream.write(line + '\n')

    if (line.startsWith('{') && line.endsWith('}')) {
        let obj
        try { obj = JSON.parse(line) } catch { obj = null }
        if (obj) {
            collator.classify(obj)
            updateSpinner()
            if (typeof obj.msg === 'string') persistLive(chalk.dim(`[${obj.level ?? '?'}] ${obj.msg}`))
            return
        }
    }

    const openMatch = OPEN_LINE.exec(line)
    if (openMatch) {
        openLines.push({ url: openMatch[1], what: openMatch[2] })
        persistLive(chalk.cyan(line))
        return
    }

    rawLines.push(line)
    persistLive(chalk.red(line))
}

const child = spawn('npx', [
    'antora',
    '--extension', './lib/preview.js',
    'antora-playbook.preview.yml',
    '--stacktrace',
    '--url', path.join(process.cwd(), 'preview'),
    '--log-format', 'json',
], {
    env: { ...process.env, IS_TTY: 'true' },
})

readline.createInterface({ input: child.stdout }).on('line', handleLine)
readline.createInterface({ input: child.stderr }).on('line', handleLine)

child.on('close', (code) => {
    code = code ?? 1
    spinner?.stop()

    logStream.end(() => {
        fs.mkdirSync('preview', { recursive: true })
        fs.renameSync(LOG_TMP_PATH, LOG_PATH)

        console.log()
        if (code === 0) {
            printSuccess()
        } else {
            printFailure(code)
        }
        console.log()

        process.exit(code)
    })
})

function printSuccess() {
    console.log(chalk.green.bold('🐇 Preview ready!'))

    if (openLines.length) {
        for (const { url } of openLines) {
            console.log('  ' + chalk.cyan.underline(url))
        }
    } else {
        console.log(chalk.yellow(`  (no preview URL was reported - check ${LOG_PATH})`))
    }

    const { errorTypes } = collator.summary()
    const relevant = errorTypes.filter(([type]) => type !== 'other')
    const n = relevant.reduce((a, [, v]) => a + v, 0)
    if (n) {
        const top = relevant.slice(0, 3).map(([type, count]) => `${count} ${type}`).join(', ')
        console.log(chalk.yellow(`  ${n} warning${n === 1 ? '' : 's'} (${top}${relevant.length > 3 ? ', ...' : ''})`))
    }

    console.log(chalk.dim(`  full log: ${LOG_PATH}`))
}

function printFailure(code) {
    console.log(chalk.red.bold(`🐇 Preview build failed (exit ${code})`))

    const { last } = collator.summary()
    if (last) {
        console.log(chalk.red(`  [${last.level ?? '?'}] ${last.msg ?? JSON.stringify(last)}`))
        if (last.file?.path) console.log(chalk.dim(`  ${last.file.path}`))
    } else if (rawLines.length) {
        console.log(chalk.red('  last output:'))
        for (const l of rawLines.slice(-15)) console.log('  ' + l)
    }

    console.log(chalk.dim(`  full log: ${LOG_PATH}`))
    if (!DEBUG) console.log(chalk.dim(`  run 'preview --debug' for full detail`))
}
