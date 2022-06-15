// from https://github.com/dohliam/markdoctor/blob/master/js/mdtoadoc.js
function convMdAdoc(txt) {
  // horizontal rules
  txt = txt.replace(/^\-{3,}$/gm, "'''").replace(/^[\*_]{3,}/gm, "'''");

  // general text formatting
  txt = txt.replace(/^\*([^\s\*][^\*]+)\*/gm, "_$1_").replace(/\s\*([^\*\s]+)\*/g, " _$1_").replace(/\*\*_/g, "*_").replace(/_\*\*/g, "_*").replace(/^\*\*([^\*]+)\*\*/gm, "*$1*").replace(/\s\*\*([^\*]+)\*\*/g, " *$1*");

  // headings
  txt = txt.replace(/^#*/gm, (x) => '='.repeat(x.length))

  // images
  txt = txt.replace(/\[\!\[([^\]]*)\]\(([^\)]+)\)\]\(([^\)]+)\)/g, "image::$2[$1, link=\"$3\"]").replace(/\!\[([^\]]*)\]\(([^\)]+)\)/g, "image::$2[$1]");

  // links
  txt = txt.replace(/\[([^\]]+)\]\(([a-z\.\/]+[^:\)]+)\)/g, "link:$2[$1]").replace(/\[([^\]]+)\]\(([a-z]+:\/\/[^\)]+)\)/g, "$2[$1]");

  // unordered lists
  txt = txt.replace(/^\s{2}[\*\-]\s/gm, "** ").replace(/^\s{4}[\*\-]\s/gm, "*** ").replace(/^\s{6}[\*\-]\s/gm, "**** ").replace(/^\s{8}[\*\-]\s/gm, "***** ");

  // ordered lists
  txt = txt.replace(/^\d+\.\s/gm, ". ").replace(/^\s{2}\d+\.\s/gm, ".. ").replace(/^\s{4}\d+\.\s/gm, "... ").replace(/^\s{6}\d+\.\s/gm, ".... ").replace(/^\s{8}\d+\.\s/gm, "..... ");

  // tables
  txt = txt.replace(/^\|*\s*(.*?)\s+\|\s+(.*?)\n\|*\s*\-+.*\n/gm, "[options=\"header\"]\n|===\n| $1 | $2\n").replace(/^\|*\s*(.*?\s+\|\s+.*?)\n\n/gm, "| $1\n|===\n\n").replace(/^([^\|]+\s+\|\s+.*$)/gm, "| $1");

  return txt
}
  
module.exports = function (registry) {
  registry.block(function () {
    var self = this
    self.named('markdown')
    self.onContext('open')
    self.process(function (parent, reader) {

      var lines = reader.getLines().map(function (l) { return convMdAdoc(l) })
      const source = lines.join('\n')
      return self.createOpenBlock(parent, source)
    })
  })
}
