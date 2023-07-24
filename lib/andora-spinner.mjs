#!/usr/bin/env zx
'use strict'

import ora from 'ora'
import chalk from 'chalk'

export class Spinner {
    constructor (config) {
        this.config = {}
        if (process.stdout.isTTY) {
            this.spinner = ora('Hoppity Hop!').start()
            this.columns = process.stdout.columns
        }
    }
    
    #truncate (message, prefix = '') {
        return message.substring(0, this.columns - (prefix ? prefix.length + 5 : 3))
        
    }
    
    flash(message, prefix='') {
        if (this.spinner) {
            this.spinner.prefixText = prefix
            this.spinner.text = this.#truncate(message, prefix)
        }
        else if (this.config.flash) {
            console.log(`${prefixText ? `(${prefixText}) ` : prefixText})${text}`)
        }
    }
    
    output(message, symbol = ' ', format = chalk.reset) {
        if (this.spinner) {
            this.spinner.text = ''
            this.spinner.prefixText = ''
            this.spinner.stopAndPersist({
                symbol, 
                text: format(this.#truncate(message))
            }).start()
        }
        else {
            console.log(`${symbol} ${message}`)
        }
    }
    
    fatal(message) {
        this.output(message, '💀', chalk.white)
    }
    fail(message) {
        this.output(message, '❌', chalk.red)
    }
    warn(message) {
        this.output(message, '⚠️', chalk.yellow)
    }
    info(message) {
        this.output(message, chalk.cyan('ℹ'), chalk.reset)
    }
    succeed(message) {
        this.output(message, chalk.green('✔'), chalk.green)
    }
    
    stop() {
        this.spinner?.stop()
    }
}
