'use strict'

const Asciidoctor = global.Opal.Asciidoctor
Asciidoctor.Compliance.underline_style_section_titles = false

// Fixes a performance issue with Asciidoctor.js 2 when used with Node.js 10
if (process.version.startsWith('v10.') && Asciidoctor.VERSION < '2.0.16') {
  Asciidoctor.Reader.prototype.$shift = function () {
    this.lineno++
    if (this.look_ahead) this.look_ahead--
    return this.lines.shift()
  }

  Asciidoctor.PreprocessorReader.prototype.$shift = function () {
    this.lineno++
    if (this.look_ahead) this.look_ahead--
    const line = this.lines.shift()
    if (this.unescape_next_line) {
      this.unescape_next_line = false
      return line.substr(1)
    }
    return line
  }
}

module.exports = () => undefined
