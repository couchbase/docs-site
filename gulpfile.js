'use strict'

const connect = require('gulp-connect');
const fs = require('fs');
const generator = require('@antora/site-generator-default');
const gulp = require('gulp');
const yaml = require('yaml-js');

let filename = "local-antora-playbook.yml";
let args = [
  "--playbook",
  filename
];

gulp.task('build', function (cb) {
  generator(args, process.env)
    .then(() => {
      cb();
    })
});

gulp.task('preview', ['build'], function () {
  /**
   * Remove the line gulp.src('README.adoc')
   * This is placeholder code to follow the gulp-connect
   * example. Could not make it work any other way.
   */
  gulp.src('README.adoc')
    .pipe(connect.reload());
})

gulp.task('watch', function () {
  let json_content = fs.readFileSync(`${__dirname}/${filename}`, 'UTF-8');
  let yaml_content = yaml.load(json_content);
  let dirs = yaml_content.content.sources
    .map(source => [
      `${source.url}/**/**.yml`,
      `${source.url}/**/**.adoc`
    ]);
  dirs.push(['local-antora-playbook.yml']);
  gulp.watch(dirs, ['preview']);
});

gulp.task('connect', function() {
  connect.server({
    port: 5252,
    name: 'Dev Server',
    livereload: true,
    root: 'public',
  });
});

gulp.task('default', ['connect', 'watch', 'build'])