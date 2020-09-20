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
const globals = {};

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
            argv.project && argv.project !== DEFAULT_PROJECT ? 8000 : 5000}`));

gulp.task(
    'tsc-watch',
    shell.task(
        './node_modules/typescript/bin/tsc --project tsconfig.json --watch --noEmit'));

// TODO: We should do this for HeaderFocusPainter as well so it can get
// sourcemapped.
function appendSourceMappingUrlToMain() {
  gulp.src([outDir + mainFilename])
      .pipe(footer('//# sourceMappingURL=main.js.map'))
      .pipe(gulp.dest(outDir));
}

gulp.task('bundle', (cb) => {
  const esbuildProcess = childProcess.exec(
      `npx esbuild --bundle static/main.ts --bundle static/HeaderFocusPainter.ts --outdir=${
          outDir} --target=esnext --sourcemap=external ${
          argv.noMinify ? '' : '--minify'}`,
      () => {
        appendSourceMappingUrlToMain();
        cb();
      });
  esbuildProcess.stdout.on('data', (data) => {
    process.stdout.write(data.toString());
  });
  const firestoreWarningSuppressions = [
    // We always get the -0 warning, so strip the 1 warning message.
    `1 warning
`,
    `node_modules/@firebase/firestore/dist/index.cjs.js:718:11: warning: Comparison with -0 using the === operator will also match 0
    return -0 === t && 1 / t == -1 / 0;
           ~~
`
  ];
  esbuildProcess.stderr.on('data', (data) => {
    const message = data.toString();
    if (firestoreWarningSuppressions.includes(message)) {
      return;
    }
    process.stderr.write(message);
  });
});

gulp.task('bundle-watch', () => watch('**/*.ts', gulp.task('bundle')));

gulp.task(
    'serve-no-install',
    gulp.parallel(['firebase-serve', 'bundle-watch', 'tsc-watch']));

gulp.task('serve', gulp.series(['npm-install', 'serve-no-install']));

/////////////////////////////////////////////////////////////////////////
// Deploy
/////////////////////////////////////////////////////////////////////////
function replaceChecksums(isAdd) {
  const first = isAdd ? 0 : 1;
  const second = isAdd ? 1 : 0;
  return gulp.src(['public/index.html'])
      .pipe(replace(globals.replaces[0][first], globals.replaces[0][second]))
      .pipe(replace(globals.replaces[1][first], globals.replaces[1][second]))
      .pipe(gulp.dest('public'));
}

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
      .pipe(rename((path) => {
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
      .pipe(rename((path) => {
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
        'fresh-bundle', 'compute-checksums', () => replaceChecksums(true),
        'firebase-deploy', () => replaceChecksums(false)));
