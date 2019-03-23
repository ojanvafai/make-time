var batch = require('gulp-batch');
let fs = require('fs');
let gulp = require('gulp');
let gulpif = require('gulp-if');
let md5 = require('md5');
let rename = require('gulp-rename');
let replace = require('gulp-string-replace');
let rollup = require('gulp-better-rollup');
let shell = require('gulp-shell')
let sourcemaps = require('gulp-sourcemaps');
let stripJsonComments = require('strip-json-comments');
let typescript = require('gulp-typescript');
let terser = require('gulp-terser');
let watch = require('gulp-watch');

let mainFilename = '/main.js';
let bundleDir = '/bundle';

function readJsonFile(path) {
  return JSON.parse(stripJsonComments(fs.readFileSync(path, 'utf8')))
}

function rmDir(path) {
  let rimraf = require('rimraf');
  rimraf.sync(path);
}

let outDir_;
function getOutDir() {
  if (!outDir_) {
    let tsConfig = readJsonFile('./tsconfig.json');
    outDir_ = tsConfig.compilerOptions.outDir;
  }
  return outDir_;
}

gulp.task("delete", (callback) => {
  rmDir(getOutDir());
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
    .pipe(gulp.dest(getOutDir()));
});

// TODO: Figure out why loadMaps:true isn't pulling in the sourcemaps generated
// by the typescript compile step.
gulp.task('bundle', function() {
  return gulp.src(getOutDir() + mainFilename)
    .pipe(sourcemaps.init({loadMaps: true}))
    .pipe(rollup({}, 'esm'))
    .pipe(terser())
    // save sourcemap as separate file (in the same folder)
    .pipe(sourcemaps.write(''))
    .pipe(gulp.dest(getOutDir() + bundleDir));
});

// TODO: Really we should have the serve generate the bundle on demand instead
// of generating it on every file change.
gulp.task('bundle-watch', () => {
  // ignoreInitial:false means it always runs the task on startup.
  // Use batch to avoid bundling once per file.
  watch('static/**/*.ts', { ignoreInitial: false }, batch(function (events, done) {
    return gulp.task(gulp.series(['compile', 'bundle'])())();
  }));
});

gulp.task('symlink-node-modules', (done) => {
  let process = require('process');

  let package = readJsonFile('./package.json');
  let dependencies = Object.keys(package.dependencies);

  const root = './public/node_modules';
  rmDir(root);
  fs.mkdirSync(root);
  process.chdir(root);

  for (let dependency of dependencies) {
    fs.symlinkSync( `../../node_modules/${dependency}`, dependency, 'dir');
  }

  // TODO: Make all the commands agnostic to which subdirectory they run in.
  // Change dir back to the original directory so the next command runs
  // in the right place.
  process.chdir('../..');
  done();
});

gulp.task('npm-install', gulp.series([shell.task('npm install'), 'symlink-node-modules']));

function firebaseServeCommand(port) {
  return shell.task(`./node_modules/firebase-tools/lib/bin/firebase.js serve --project mk-time --port=${port}`)
}
gulp.task('firebase-serve', gulp.parallel([firebaseServeCommand(5000), firebaseServeCommand(8000)]));

gulp.task('tsc-watch', shell.task('./node_modules/typescript/bin/tsc --project tsconfig.json --watch'));

let compileWatch = process.argv.includes('--bundle') ? 'bundle-watch' : 'tsc-watch';
gulp.task('serve', gulp.series(
  ['npm-install', gulp.parallel(['firebase-serve', compileWatch])]));

gulp.task('upload', () => {
  let checksumKeyword = "-checksum-";

  // Append md5 checksum to gen/bundle/main.js and it's sourcemap.
  let bundleMain = getOutDir() + bundleDir + mainFilename;
  let checksum = md5(fs.readFileSync(bundleMain, 'utf8'));
  gulp.src([bundleMain, bundleMain + '.map'])
      .pipe(rename(function (path) {
        let parts = path.basename.split('.');
        path.basename = parts[0] + checksumKeyword + checksum;
        if (parts.length == 2)
          path.basename += '.' + parts[1];
      }))
      .pipe(gulp.dest(getOutDir() + bundleDir));

  // Append md5 checksum to maifest.json.
  let manifestChecksum = md5(fs.readFileSync(bundleMain, 'utf8'));
  gulp.src('public/manifest.json')
      .pipe(rename(function (path) {
        path.basename += checksumKeyword + manifestChecksum;
      }))
      .pipe(gulp.dest(getOutDir()));

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
