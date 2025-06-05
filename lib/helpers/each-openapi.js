// Format config section of openapi property definitions.
// We pass in a data structure from an openapi Schema.
//
//     Table of Contents (of the tree of this Schema, in HTML, linked to below)
//
//     The Asciidoc template is called for each node of the tree
//
// see extensions-template.adoc for motivating example.

const lib = require('./lib/each-openapi-module.js')
module.exports = lib.main
