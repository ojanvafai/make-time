# MakeTime
Make-time is an opinionated email client for Gmail.

## Build dependencies
1. Checkout https://github.com/ojanvafai/make-time
2. npm install
  ^^^^ This installs type script, firebase, gulp, etc.
3. Use an editor of your choosing, although Visual Studio Code works
particularly well with typescript integration.
See https://stackoverflow.com/posts/30319507/revisions.

## Starting a dev server
For the dev server to work, you need to both start the firebase server and
compile typescript after every change.

You can run both with the following command:
```
$ ./node_modules/concurrently/bin/concurrently.js --kill-others './node_modules/firebase-tools/lib/bin/firebase.js serve --project mk-time' './node_modules/typescript/bin/tsc --project tsconfig.json --watch'
```

Now http://localhost:5000 serves make-time the same as consumer. For google.com
credentials, use --port 5555 to serve from localhost:5555.

TODO: Create a gulp command does the above.

### To start just the server
```
$ ./node_modules/firebase-tools/lib/bin/firebase.js serve --project mk-time
```

### Compiling typescript
```
$ ./node_modules/.bin/tsc -p tsconfig.json
```

## Deploying
```
$ ./node_modules/gulp/bin/gulp.js deploy
```

### Or to only upload to the mk-time project:
```
$ ./node_modules/gulp/bin/gulp.js deploy --skip-google
```

In order to deploy, Ojan will need to make you a collaborator on the relevant appengine projects first.

## Bundling
By default, running locally will serve unbundled and deploying will bundle.
You can override the default behavior (locally and on the server) with the
query parameter bundle=0 for no bundling and bundle=1 for bundling. For the
latter you'll need to manually run the command to generate the bundle.

// TODO: Integrate gulp-watch or something like it to run gulp on file saves.

```
$ ./node_modules/gulp/bin/gulp.js
```

## Recommendations
If you use VS Code you can get autoformatting of TS code on save with:

1. Install the clang-format extension: https://marketplace.visualstudio.com/items?itemName=xaver.clang-format
2. Added the following to your VSCode settings:
  "clang-format.executable": "${workspaceRoot}/node_modules/clang-format/bin/linux_x64/clang-format",
  "[typescript]": {
      "editor.formatOnSave": true,
      "editor.formatOnPaste": true,
      "editor.formatOnType": true
  }


## Navigating the code
index.html is the file that gets served, but it basically just loads main.js,
which in turn loads everything else as ES Modules. Look at the onLoad() method
in main.js to see how the page boots up or the router.add calls to see how the
different routes get initialized.
