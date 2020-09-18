const childProcess = require('child_process');
const fs = require('fs');
const gulp = require('gulp');
const {watch} = require('gulp');
const md5 = require('md5');
const rename = require('gulp-rename');
const replace = require('gulp-string-replace');
const shell = require('gulp-shell')
const footer = require('gulp-footer');
const argv = require('yargs').argv;
const mainFilename = '/main.js';
const outDir = './public/gen';

const DEFAULT_PROJECT = 'mk-time';

gulp.task('delete', (callback) => {
  const rimraf = require('rimraf');
  rimraf.sync(outDir);
  callback();
});

/////////////////////////////////////////////////////////////////////////
// Local development
/////////////////////////////////////////////////////////////////////////
gulp.task('npm-install', shell.task('npm install --no-fund'));

gulp.task(
    'firebase-serve',
    shell.task(
        `./node_modules/firebase-tools/lib/bin/firebase.js serve --project ${
            DEFAULT_PROJECT} --port=${
            argv.project !== DEFAULT_PROJECT ? 8000 : 5000}`));

gulp.task(
    'tsc-watch',
    shell.task(
        './node_modules/typescript/bin/tsc --project tsconfig.json --watch --noEmit'));

gulp.task('bundle', function() {
  childProcess.execSync(
      `npx esbuild --bundle static/main.ts --bundle static/HeaderFocusPainter.ts --outdir=${
          outDir} --target=esnext --sourcemap=external ${
          argv.noMinify ? '' : '--minify'}`,
  );
  // TODO: We should do this for HeaderFocusPainter as well so it can get
  // sourcemapped.
  return gulp.src([outDir + mainFilename])
      .pipe(footer('//# sourceMappingURL=main.js.map'))
      .pipe(gulp.dest(outDir));
});

gulp.task('bundle-watch', () => {watch('**/*.ts', {queue: true}, () => {
                            return gulp.task('bundle')();
                          })});

gulp.task(
    'serve-no-install',
    gulp.parallel(['firebase-serve', 'bundle-watch', 'tsc-watch']));

gulp.task('serve', gulp.series(['npm-install', 'serve-no-install']));

/////////////////////////////////////////////////////////////////////////
// Deploy
/////////////////////////////////////////////////////////////////////////
gulp.task('add-checksums', function() {
  return gulp.src(['public/index.html'])
      .pipe(replace(globals.replaces[0][0], globals.replaces[0][1]))
      .pipe(replace(globals.replaces[1][0], globals.replaces[1][1]))
      .pipe(gulp.dest('public'));
});

gulp.task('remove-checksums', function() {
  return gulp.src(['public/index.html'])
      .pipe(replace(globals.replaces[0][1], globals.replaces[0][0]))
      .pipe(replace(globals.replaces[1][1], globals.replaces[1][0]))
      .pipe(gulp.dest('public'));
});

gulp.task('firebase-deploy', (cb) => {
  const deployProcess = childProcess.exec(
      `./node_modules/firebase-tools/lib/bin/firebase.js deploy --project ${
          argv.project || DEFAULT_PROJECT}`,
      cb);
  deployProcess.stdout.on('data', (data) => {
    process.stdout.write(data.toString());
  });
  deployProcess.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });
});

gulp.task('compute-checksums', (cb) => {
  let checksumKeyword = '-checksum-';
  // Append md5 checksum to gen/main.js and it's sourcemap.
  let bundleMain = outDir + mainFilename;
  let checksum = md5(fs.readFileSync(bundleMain, 'utf8'));
  gulp.src([bundleMain, bundleMain + '.map'])
      .pipe(rename(function(path) {
        let parts = path.basename.split('.');
        path.basename = parts[0] + checksumKeyword + checksum;
        if (parts.length == 2)
          path.basename += '.' + parts[1];
      }))
      .pipe(gulp.dest(outDir));

  // Append md5 checksum to maifest.json.
  const manifestJsonPath = 'public/manifest.json';
  let manifestChecksum = md5(fs.readFileSync(manifestJsonPath, 'utf8'));
  gulp.src(manifestJsonPath)
      .pipe(rename(function(path) {
        path.basename += checksumKeyword + manifestChecksum;
      }))
      .pipe(gulp.dest(outDir));

  globals.replaces = [
    ['gen/main.js', `gen/main${checksumKeyword}${checksum}.js`],
    ['manifest.json', `gen/manifest${checksumKeyword}${manifestChecksum}.json`],
  ];
  cb();
});

gulp.task('fresh-bundle', gulp.series('delete', 'bundle'));

gulp.task(
    'deploy',
    gulp.series(
        'fresh-bundle', 'compute-checksums', 'add-checksums', 'firebase-deploy',
        'remove-checksums'));
