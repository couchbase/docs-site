#!/usr/bin/env zx
'use strict'

import ora from 'ora'
const jsonlines = require('jsonlines')
const equal = require('deep-equal')
import { rimrafSync } from 'rimraf'

const promise_ok = async (promise) => {
    try {
        await promise
        return true
    }
    catch (e) {
        return false
    }
}

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
        type: 'other',
        regex: /(?<text>.*)/
    }
]

const expected_vars = {
    '@antora/site-generator': '3.0.1',
    '@antora/cli': '3.0.1',
    'node': (v) => [v.match(/v18/), "Not using Node LTS v18"],
    'ui-bundle': 'https://github.com/couchbase/docs-ui/releases/download/prod-166/ui-bundle.zip',

}

$.verbose = false



function getParser(spinner) {
    const parser = jsonlines.parse({ emitInvalidLines: true })

    parser.on('data', function (data) {
        spinner.text = ''
        spinner.prefixText = ''
        if (data.name === "andora") {
            const log = {type: 'andora', ...data}
            logs.andora.push(log)
            logs.all.push(log)

            switch(data.level) {
                case 'fatal':
                    vars[fatal] = true
                    spinner.stopAndPersist({
                        symbol: '💀',
                        text: data.msg
                    }).start()
                case 'error':
                    spinner.fail(data.msg).start()
                    break;
                case 'warn':
                    spinner.warn(data.msg).start()
                    break;
                case 'debug':
                    spinner.info(data.msg).start()
                    break;
                case 'info':
                default:
                    spinner.succeed(data.msg).start()
            }
            if (data.vars) {
                for (const [k,v] of Object.entries(data.vars)) {
                    if (k in expected_vars) {
                        const expected = expected_vars[k]
                        const fn = (typeof expected === 'function') ?
                            expected
                            : (got) => [equal(expected, got), `expected: ${expected}`]
                            
                        spinner.info(`${k}: ${JSON.stringify(v)}`).start()
                        const [ok, msg] = fn(v)
                        if (!ok) {
                            spinner.fail(chalk.red(`  ${msg}`)).start()
                        }
                    }
                    else {
                        spinner.info(`${k}: ${JSON.stringify(v)}`).start()
                    }
                }
                vars = { ...vars, ...data.vars }
            }
        }
        else {
            for (const p of log_parsers) {
                const result = p.regex.exec(data.msg)
                if (result) {
                    spinner.text = data.msg
                    spinner.prefixText = data.source ? path.basename(data.source.url, '.git') : ''
                    const log = {type: p.type, ...result.groups, ...data}
                    logs[p.type] = logs[p.type] ?? []
                    logs[p.type].push(log)
                    logs.all.push(log)
                    
                    switch(data.level) {
                        case 'fatal':
                            vars[fatal] = true
                            spinner.stopAndPersist({
                                symbol: '💀',
                                text: data.msg
                            })
                        case 'error':
                            spinner.color = 'red'
                            break;
                        case 'warn':
                            spinner.color = 'yellow'
                            break;
                        default:
                            spinner.color = 'cyan'
                    }
                    break
                }
            }
        }
    })

    parser.on('invalid-line', function (err) {
        spinner.text = ''
        spinner.prefixText = ''
        spinner.warn(err.source).start()
    })
    return parser
}

// Variables to store Andora state
var vars = {}
var logs = { all: [], andora: [] }
const spinner = ora('Hoppity Hop!').start()
const parser = getParser(spinner)

try {
    console.time('andora')
    
    spinner.stopAndPersist({
        symbol: '🐇', 
        text: chalk.magenta.bold('Hello, I am Andora, the docs build rabbit!')
    }).start()

    {
        spinner.prefixText = 'doc-site'
        spinner.info('Checking your git worktree is up to date').start()

        const upstream = (
            await $`git ls-remote git@github.com:couchbase/docs-site.git master`
            ).toString().split(/\s+/)[0]

        if (await promise_ok($`git merge-base --is-ancestor ${upstream} HEAD`)) {
            spinner.succeed('Git checkout is up to date!')
        }
        else if (await promise_ok($`git merge-base --is-ancestor HEAD ${upstream}`)) {
            spinner.info(`Git checkout can be updated with ${chalk.bold('git pull --ff-only')}`)
        }
        else if (await promise_ok($`git merge-base HEAD ${upstream}`)) {
            spinner.warn(`Looks like you have branched master. Remember to update with ${chalk.bold('git pull --rebase')}`)
        }
        else {
            spinner.fail(chalk.red('Careful! It looks like you are not related to master branch'))
        }  
        spinner.prefixText = ''
        spinner.start()
    }

    const antora = $`antora --stacktrace --log-level=debug --extension=lib/doctor.js ${process.argv.slice(3)}`.quiet()

    for await (const chunk of antora.stdout) {
        const ok = parser.write(chunk)
        // if (! ok) {
        //     const drain = parser.once('drain', () => parser.write(chunk))
        //     await drain
        // }
    }

    console.log("\nCategorized log messages:", Object.entries(logs).map(([k,v]) => [k, v.length]))
    if (logs.other) {
        console.log(
            "Uncategorized log messages:",
            logs.other.slice(0,3).map(m => m.msg),
            "...")
    }

    if (vars.output_dir) {
        const absolute = path.resolve(vars.output_dir)
        spinner.stopAndPersist({
            symbol: '🐇', 
            text: `See ${chalk.white(`file://${absolute}/andora.html`)} to browse output`
        })
    }


}
catch (e) {
    console.log()
    if (typeof e == 'ProcessOutput') {
        console.log(`Exit code: ${e.exitCode}`)
        console.log(`Error: ${e.stderr}`)
    }
    else {
        console.log(e)
    }
    vars[fatal] = true
}
finally {
    parser.end()
    console.timeEnd('andora')
    
    if (vars.output_dir) {
        try {
            spinner.info("Writing Logs").start()
            const log_path = `${vars.output_dir}/logs`
            
            // delete and recreate logs, so we don't get confused by old ones
            rimrafSync(log_path)
            fs.mkdir(log_path)
            
            for (const [log, contents] of Object.entries(logs)) {
                fs.writeFileSync(`${log_path}/${log}.json`, JSON.stringify(contents))
            }
            spinner.info(`Logs written to ${chalk.white(log_path)}`)
        } catch (e) {
            console.log(`Error writing logs: ${e}`)
            vars.fatal = true
        }
    }
    
    spinner.stop()
    console.log()
    process.exit(vars.fatal ?? 0)
}
