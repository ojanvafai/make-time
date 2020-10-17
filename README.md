# MakeTime
Make-time is an opinionated email client for Gmail.

Contributions in the form of filing bugs or pull requests for anything ranging from
typo fixes to substantial changes are very welcome.

## Install dependencies
1. Checkout https://github.com/ojanvafai/make-time
2. installs type script, firebase, gulp, etc:
```
npm install --no-fund
```
3. Firebase serving needs permissions to start even a local server. To get these permissions,
join this mailing list: https://groups.google.com/forum/#!forum/make-time.
4. Login to firebase:
```
$ ./node_modules/firebase-tools/lib/bin/firebase.js login
```
5. [Optional] Install Visual Studio Code. It work particularly well with typescript integration. See https://stackoverflow.com/posts/30319507/revisions.

## Starting a dev server
For the dev server to work, you need to both start the firebase server and
compile typescript after every change. You can run both with the following command:
```
$ ./gulp install-and-serve
```

Start http://localhost:5000 serves make-time for consumer accounts, and http://localhost:8000 for google.com accounts.

## Deploying
```
$ ./gulp deploy
```

Or for a Firebase project other than the default one:
```
$ ./gulp deploy --project FIREBASE_PROJECT_NAME
```

In order to deploy, Ojan will need to make you a collaborator on the relevant
appengine projects first.

## Recommendations
If you use VS Code you can get autoformatting of TS code on save with:

1. Install the clang-format extension: https://marketplace.visualstudio.com/items?itemName=xaver.clang-format
2. Added the following to your VSCode settings (change linux_x64 to darwin_x64 on mac):
  "clang-format.executable": "${workspaceRoot}/node_modules/clang-format/bin/linux_x64/clang-format",
  "[typescript]": {
    "editor.formatOnSave": true
  }

## Navigating the code
index.html is the file that gets served, but it basically just loads main.js,
which in turn loads everything else as ES Modules. Look at the onLoad() method
in main.js to see how the page boots up or the router.add calls to see how the
different routes get initialized.
