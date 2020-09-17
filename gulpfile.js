const childProcess = require('child_process');
const fs = require('fs');
const gulp = require('gulp');
const {watch} = require('gulp');
const md5 = require('md5');
const rename = require('gulp-rename');
const replace = require('gulp-string-replace');
const shell = require('gulp-shell')
const footer = require('gulp-footer');

const mainFilename = '/main.js';
const outDir = './public/gen';

gulp.task('delete', (callback) => {
  const rimraf = require('rimraf');
  rimraf.sync(outDir);
  callback();
});

gulp.task('npm-install', shell.task('npm install --no-fund'));

gulp.task(
    'firebase-serve',
    shell.task(
        `./node_modules/firebase-tools/lib/bin/firebase.js serve --project mk-time --port=${
            process.argv.includes('--google') ? 8000 : 5000}`));

gulp.task(
    'tsc-watch',
    shell.task(
        './node_modules/typescript/bin/tsc --project tsconfig.json --watch --noEmit'));

gulp.task('bundle', function() {
  childProcess.execSync(
      `npx esbuild --bundle static/main.ts --bundle static/HeaderFocusPainter.ts --outdir=${
          outDir} --target=esnext --sourcemap=external --minify`,
  );
  // TODO: We should do this for HeaderFocusPainter as well so it can get sourcemapped.
  return gulp
      .src([outDir + mainFilename])
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

function deploy(projectName) {
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
  let manifestChecksum = md5(fs.readFileSync(bundleMain, 'utf8'));
  gulp.src('public/manifest.json')
      .pipe(rename(function(path) {
        path.basename += checksumKeyword + manifestChecksum;
      }))
      .pipe(gulp.dest(outDir));
  pathsToRewrite = [
    ['/gen/main.js', `/gen/main${checksumKeyword}${checksum}.js`],
    [
      './manifest.json',
      `./gen/manifest${checksumKeyword}${manifestChecksum}.json`
    ],
  ];

  // TODO: Find a way to avoid rewriting index.html in place while still
  // having firebase serve up index.html without needing a build step for
  // unbundled local development.
  gulp.src(['public/index.html'])
      .pipe(replace(pathsToRewrite[0][0], pathsToRewrite[0][1]))
      .pipe(replace(pathsToRewrite[1][0], pathsToRewrite[1][1]))
      .pipe(gulp.dest('public'))
  let firebaseDeploy =
      './node_modules/firebase-tools/lib/bin/firebase.js deploy --project ';
  return gulp.src(['public/index.html'])
      .pipe(shell([firebaseDeploy + projectName]))
      .pipe(replace(pathsToRewrite[0][1], pathsToRewrite[0][0]))
      .pipe(replace(pathsToRewrite[1][1], pathsToRewrite[1][0]))
      .pipe(gulp.dest('public'))
}

gulp.task('upload', () => {
  return deploy('mk-time');
});

gulp.task('upload-google', () => {
  return deploy('google.com:mktime');
});

gulp.task('fresh-bundle', gulp.series('delete', 'bundle'));
gulp.task('default', gulp.series('fresh-bundle'));
gulp.task('deploy', gulp.series('fresh-bundle', 'upload'));
gulp.task('deploy-google', gulp.series('fresh-bundle', 'upload-google'));
