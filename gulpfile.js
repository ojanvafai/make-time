const childProcess = require('child_process');
const fs = require('fs');
const {watch, task, series, parallel} = require('gulp');
const md5 = require('md5');
const rimraf = require('rimraf');
const argv = require('yargs').argv;

const OUT_DIR = './public/gen';
const DEFAULT_PROJECT = 'mk-time';

task('delete', (callback) => {
  const rimraf = require('rimraf');
  rimraf.sync(outDir);
  callback();
});

const FIREBASE_PATH = './node_modules/firebase-tools/lib/bin/firebase.js';

function generateIndexHtml(mainJsFilePath, cssFilePath, manifestFilePath) {
  // - maximum-scale=1.0 disables zoom in Chrome and Webkit.
  // - user-scalable=yes reenables user driven zoom in Webkit but not Chrome.
  // - The combination of those two enables user driven zoom but disables
  //   automated browser zooming of form controls.
  return `<!DOCTYPE html><html><head><meta charset='utf-8'>
<script>
const ua = navigator.userAgent;
const isSafari = !ua.includes('AppleWebKit/537.36') && ua.includes('AppleWebKit/');
document.write(
  \`<meta name="viewport" content="width=device-width,initial-scale=1.0\${isSafari ? ',maximum-scale=1.0,user-scalable=yes' : ''}">\`
);
</script>
<script src="https://apis.google.com/js/api.js"></script>
<script type=module src="${mainJsFilePath}"></script>
<link rel=stylesheet href="${cssFilePath}">
<link rel="manifest" href="${manifestFilePath}">
</head><body></body></html>`;
}

async function checksumFileAndReturnNewPath(fileName, extension) {
  const path = `public/${fileName}${extension}`;
  const checksum = md5(await fs.promises.readFile(path, 'utf8'));
  const checksummedPath = `gen/${fileName}-${checksum}${extension}`;
  await fs.promises.copyFile(path, `public/${checksummedPath}`);
  return checksummedPath;
}

async function checksumMainJs() {
  const bundleMain = OUT_DIR + '/main.js';
  // TODO: Run esbuild from gulp instead of commandline so that we
  // can get the bundle JS without writing it to disk just to read it out again.
  // Reading the file out here takes 150ms. esbuild takes 300ms to produce and
  // write out the file. So that should make it 2x faster.
  const mainFileContents = await fs.promises.readFile(bundleMain, 'utf8');
  const mainFileChecksum = md5(mainFileContents);

  const checksummedMainPath = `gen/main-${mainFileChecksum}.js`;
  const publicChecksummedMainPath = `public/${checksummedMainPath}`;
  // Technically appending the sourceMappingURL would change the checksum, but
  // we don't need to care as long as we're consistent.
  await fs.promises.writeFile(publicChecksummedMainPath, `${mainFileContents}
//# sourceMappingURL=/${checksummedMainPath}.map`);

  await fs.promises.rename(
      `${bundleMain}.map`, `${publicChecksummedMainPath}.map`);
  return checksummedMainPath;
}

task('bundle-once', (cb) => {
  // Delete the contents of the out directory instead of the whole directory.
  // Deleting the whole directly confuses tsc watch and has it start an
  // incremental compilation that never finishes.
  rimraf.sync(`${OUT_DIR}/*`);

  const minify = argv.noMinify ? '' : '--minify';
  const esbuild = childProcess.exec(
      `npx esbuild --bundle static/main.ts --bundle static/HeaderFocusPainter.ts ${
          minify} --outdir=${OUT_DIR} --target=esnext --sourcemap=external`,
      async () => {
        const paths = await Promise.all([
          checksumMainJs(), checksumFileAndReturnNewPath('generic', '.css'),
          checksumFileAndReturnNewPath('manifest', '.json')
        ]);
        const indexHtmlContents = generateIndexHtml(...paths);
        // Blech, firebse requires index.html stored at the root of the public
        // directory. So we write it out there and gitignore it instead of
        // putting it in the gen directory.
        await fs.promises.writeFile(`public/index.html`, indexHtmlContents);
        cb();
      });
  esbuild.stdout.on('data', (data) => process.stdout.write(data.toString()));

  // TODO: Stop suppressing after upgrading to the next version of firebase or
  // esbuild since they both fixed it and then switch to using execAndPipe for
  // this function.
  const firestoreWarningSuppressions = [
    // We always get the -0 warning, so strip the 1 warning message.
    `1 warning
`,
    `node_modules/@firebase/firestore/dist/index.cjs.js:718:11: warning: Comparison with -0 using the === operator will also match 0
    return -0 === t && 1 / t == -1 / 0;
           ~~
`
  ];
  esbuild.stderr.on('data', (data) => {
    const message = data.toString();
    if (firestoreWarningSuppressions.includes(message)) {
      return;
    }
    process.stderr.write(message);
  });
});

const execAndPipe =
    (command) => {
      return (cb) => {
        const x = childProcess.exec(command, cb);
        x.stdout.on('data', (data) => process.stdout.write(data.toString()));
        x.stderr.on('data', (data) => process.stderr.write(data.toString()));
      };
    }

task('deploy-firebase', (cb) => {
  const project = argv.project || DEFAULT_PROJECT;
  const output = execAndPipe(`${FIREBASE_PATH} deploy --project ${project}`);
  output(cb);
});

task('serve-firebase', (cb) => {
  const port = argv.project && argv.project !== DEFAULT_PROJECT ? 8000 : 5000;
  const output = execAndPipe(
      `${FIREBASE_PATH} serve --project ${DEFAULT_PROJECT} --port=${port}`);
  output(cb);
});

task(
    'tsc',
    execAndPipe(
        './node_modules/typescript/bin/tsc --project tsconfig.json --watch --noEmit'));

task('bundle', () => watch('**/*.ts', task('bundle-once')));
task('serve', parallel(['serve-firebase', 'bundle', 'tsc']));
task('install', execAndPipe('npm install --no-fund'));
task('install-and-serve', series(['install', 'serve']));
task('deploy', series('bundle-once', 'deploy-firebase'));
