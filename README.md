# MakeTime
Make-time is an opinionated email client for Gmail.

## Install dependencies
1. Checkout https://github.com/ojanvafai/make-time
2. npm install
  ^^^^ This installs type script, firebase, gulp, etc.
4. Firebase serving needs permissions to start even a local server. To get these permissions,
join this mailing list: https://groups.google.com/forum/#!forum/make-time.
5. Login to firebase:
```
$ ./node_modules/firebase-tools/lib/bin/firebase.js serve
```
6. [Optional] Install Visual Studio Code. It work particularly well with typescript integration. See https://stackoverflow.com/posts/30319507/revisions.

## Starting a dev server
For the dev server to work, you need to both start the firebase server and
compile typescript after every change. You can run both with the following command:
```
$ ./gulp serve
```

Now http://localhost:5000 serves make-time the same as consumer.

### Flags for serving
--google to use google.com credentials and serve from localhost:8000.

--bundle to also generate the bundled/minified JS on each file change.

## Deploying
```
$ ./gulp deploy
```

In order to deploy, Ojan will need to make you a collaborator on the relevant appengine projects first. Use --skip-google to only upload to the mk-time project and skip google.com:mktime.

## Bundling
By default, running locally will serve unbundled and deploying will bundle.
You can override the default behavior (locally and on the server) with the
query parameter bundle=0 for no bundling and bundle=1 for bundling. For
bundle=1 to work locally, need to start the server with "./gulp serve --bundle",
which is generally not recommended because compiles are >10x slower with
bundling.

## Recommendations
If you use VS Code you can get autoformatting of TS code on save with:

1. Install the clang-format extension: https://marketplace.visualstudio.com/items?itemName=xaver.clang-format
2. Added the following to your VSCode settings:
  "clang-format.executable": "${workspaceRoot}/node_modules/clang-format/bin/linux_x64/clang-format",
  "[typescript]": {
    "editor.formatOnSave": true,
    "editor.formatOnType": true
  }

## Navigating the code
index.html is the file that gets served, but it basically just loads main.js,
which in turn loads everything else as ES Modules. Look at the onLoad() method
in main.js to see how the page boots up or the router.add calls to see how the
different routes get initialized.
