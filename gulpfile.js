let fs = require('fs');
let gulp = require('gulp');
var gulpif = require('gulp-if');
let md5 = require('md5');
let rename = require('gulp-rename');
let replace = require('gulp-string-replace');
let rollup = require('gulp-better-rollup');
let shell = require('gulp-shell')
let sourcemaps = require('gulp-sourcemaps');
let stripJsonComments = require('strip-json-comments');
let typescript = require('gulp-typescript');
let uglify = require('gulp-uglify-es').default;

let tsConfig = JSON.parse(stripJsonComments(fs.readFileSync('./tsconfig.json', 'utf8')));
let outDir = tsConfig.compilerOptions.outDir;
let mainFilename = '/main.js';
let bundleDir = '/bundle';

gulp.task("delete", (callback) => {
  var rimraf = require('rimraf');
  rimraf.sync(outDir);
  callback();
});

gulp.task("compile", () => {
  let project = typescript.createProject("tsconfig.json");
  return project.src()
    // Even though the sourcemaps for the .ts files don't work in the bundled
    // version, still generate them so that you can debug the .ts files when
    // unbundled.
    .pipe(sourcemaps.init())
    .pipe(project()).js
    // save sourcemap as separate file (in the same folder)
    .pipe(sourcemaps.write(''))
    .pipe(gulp.dest(outDir));
});

// TODO: Figure out why loadMaps:true isn't pulling in the sourcemaps generated
// by the typescript compile step.
gulp.task('bundle', () => {
  return gulp.src(outDir + mainFilename)
    .pipe(sourcemaps.init({loadMaps: true}))
    .pipe(rollup({}, 'esm'))
    .pipe(uglify())
    // save sourcemap as separate file (in the same folder)
    .pipe(sourcemaps.write(''))
    .pipe(gulp.dest(outDir + bundleDir));
})

gulp.task('upload', () => {
  let checksumKeyword = "-checksum-";

  // Append md5 checksum to gen/bundle/main.js and it's sourcemap.
  let bundleMain = outDir + bundleDir + mainFilename;
  let checksum = md5(fs.readFileSync(bundleMain, 'utf8'));
  gulp.src([bundleMain, bundleMain + '.map'])
      .pipe(rename(function (path) {
        let parts = path.basename.split('.');
        path.basename = parts[0] + checksumKeyword + checksum;
        if (parts.length == 2)
          path.basename += '.' + parts[1];
      }))
      .pipe(gulp.dest(outDir + bundleDir));

  // Append md5 checksum to maifest.json.
  let manifestChecksum = md5(fs.readFileSync(bundleMain, 'utf8'));
  gulp.src('public/manifest.json')
      .pipe(rename(function (path) {
        path.basename += checksumKeyword + manifestChecksum;
      }))
      .pipe(gulp.dest(outDir));

  pathsToRewrite = [
    ['/gen/bundle/main.js', `/gen/bundle/main${checksumKeyword}${checksum}.js`],
    ['./manifest.json', `./gen/manifest${checksumKeyword}${manifestChecksum}.json`],
  ];

  // TODO: Find a way to avoid rewriting index.html in place while still
  // having firebase serve up index.html without needing a build step for
  // unbundled local development.
  gulp.src(['public/index.html'])
    .pipe(replace(pathsToRewrite[0][0], pathsToRewrite[0][1]))
    .pipe(replace(pathsToRewrite[1][0], pathsToRewrite[1][1]))
    .pipe(gulp.dest('public'))

  let skipGoogle = process.argv.includes('--skip-google');

  let firebaseDeploy = './node_modules/firebase-tools/lib/bin/firebase.js deploy --project ';
  return gulp.src(['public/index.html'])
    .pipe(shell([firebaseDeploy + 'mk-time']))
    .pipe(gulpif(!skipGoogle, shell([firebaseDeploy + 'google.com:mktime'])))
    .pipe(replace(pathsToRewrite[0][1], pathsToRewrite[0][0]))
    .pipe(replace(pathsToRewrite[1][1], pathsToRewrite[1][0]))
    .pipe(gulp.dest('public'))
});

// TODO also deploy to google.com:mktime
gulp.task('fresh-bundle', gulp.series('delete', 'compile', 'bundle'));
gulp.task('default', gulp.series('fresh-bundle'));
gulp.task('deploy', gulp.series('fresh-bundle', 'upload'));
