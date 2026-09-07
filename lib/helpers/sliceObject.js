'use strict'

// from: 0-indexed
// to: also 0-indexed but of the following element
module.exports = (data, from, to) => {
  return Object.fromEntries(
    Object.entries(data).slice(from, to))
}

