/* Copyright (c) 2018 OpenDevise, Inc.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Extends the AsciiDoc syntax to add support for the inline man(ual) macro.
 * This macro creates a link to a manual page that's suitable for the output
 * format.
 *
 * Usage:
 *
 *  man:cbbackupmgr[1]
 *
 * The target must be located in the same directory as the source.
 *
 * @author Dan Allen <dan@opendevise.com>
 */
const { posix: path } = require('path')

function initInlineManMacro ({ file }) {
  return function () {
    this.process((parent, target, attrs) => {
      const text = target.startsWith('couchbase-cli-') ? target.substr(14) : target
      const refid = path.join(path.dirname(file.src.relative), target)
      const attributes = Opal.hash2(['refid', 'path'], { refid, path: refid + '.adoc' })
      return this.createInline(parent, 'anchor', text, { type: 'xref', target: refid + '.adoc', attributes })
    })
  }
}

function register (registry, context) {
  registry.inlineMacro('man', initInlineManMacro(context))
}

module.exports.register = register
