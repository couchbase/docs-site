'use strict'

// Times the content-aggregation phase (fetching + aggregating every content source),
// isolated from everything else in the pipeline (UI loading runs concurrently with it;
// asciidoc conversion, navigation building, page composition, publishing all happen after).
// See generate-site.js in @antora/site-generator for the exact event sequence this relies on.

module.exports.register = function () {
  this.once('beforeProcess', () => console.time('content-aggregation'))
  this.once('contentAggregated', () => console.timeEnd('content-aggregation'))
}
