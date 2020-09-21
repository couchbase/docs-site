'use strict'

const { Transform } = require('stream')
const map = (transform) => new Transform({ objectMode: true, transform })
const path = require('path')
const vfs = require('vinyl-fs')

function resolveDirToAnalyze () {
  return process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(process.argv[1]), '../public')
}

function gatherStats (dir) {
  return new Promise((resolve) => {
    let files = 0
    let pages = 0
    let images = {}
    let attachments = 0
    let aux = 0
    let size = 0
    vfs
      .src('**/*', { cwd: dir, cwdbase: true, read: false })
      .pipe(map((file, _, next) => {
        size += file.stat.size
        file.stat.isDirectory() ? next() : next(null, file)
      }))
      .on('data', (file) => {
        files += 1
        if (file.relative.startsWith('_/')) {
          // ignore
        } else if (file.extname === '.html') {
          pages += 1
        } else if (file.relative.includes('/_images/')) {
          images[file.extname.toLowerCase()] = (images[file.extname.toLowerCase()] || 0) + 1
        } else if (file.relative.includes('/_attachments/')) {
          attachments += 1
        } else {
          aux += 1
        }
      })
      .on('end', () => resolve({ files, pages, images, attachments, aux, size }))
  })
}

function printReport (stats) {
  const totalImages = Object.values(stats.images).reduce((a, b) => a + b, 0)
  const imageDist = Object.entries(stats.images).sort((a, b) => b[1] - a[1] )
    .map(([ext, cnt]) => `${Math.round((cnt / totalImages) * 10000) / 100}% ${ext.substr(1)}` )
  console.log('Site Stats')
  console.log('----------')
  console.log('Files: ' + stats.files)
  console.log('Size: ' + toHumanReadableSize(stats.size))
  console.log('Pages: ' + stats.pages)
  console.log('Images: ' + totalImages + (totalImages > 0 ? ' (' + imageDist.join(', ') + ')' : ''))
  console.log('Attachments: ' + stats.attachments)
  console.log('UI & Meta: ' + stats.aux)
}

function toHumanReadableSize (size) {
  const base = 1024
  const units = ['B', 'K', 'M', 'G', 'T']
  const exp = parseInt(Math.log(size) / Math.log(base))
  const ssize = size / Math.pow(base, exp)
  return `${Math.round(ssize * 100) / 100}${units[exp]}`
}

;(async () => {
  printReport(await gatherStats(resolveDirToAnalyze()))
})()
