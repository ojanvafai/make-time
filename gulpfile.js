let gulp = require('gulp');
let typescript = require('gulp-typescript');
let sourcemaps = require('gulp-sourcemaps');
let rollup = require('gulp-better-rollup');
let uglify = require('gulp-uglify-es').default;
let stripJsonComments = require('strip-json-comments');

let fs = require('fs');
let tsConfig = JSON.parse(stripJsonComments(fs.readFileSync('./tsconfig.json', 'utf8')));
let outDir = tsConfig.compilerOptions.outDir;

gulp.task("delete-out-dir", function(cb) {
  var rimraf = require('rimraf');
  rimraf.sync(outDir);
  cb();
});

gulp.task("compile", function () {
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
  return gulp.src('public/gen/main.js')
    .pipe(sourcemaps.init({loadMaps: true}))
    .pipe(rollup({}, 'esm'))
    .pipe(uglify())
    // save sourcemap as separate file (in the same folder)
    .pipe(sourcemaps.write(''))
    .pipe(gulp.dest('public/gen/bundle'))
})

gulp.task('default', gulp.series('delete-out-dir', 'compile', 'bundle'));
