# MakeTime

Make-time is an opinionated email client for Gmail. See help.js for more details.

## Build dependencies
1. Checkout https://github.com/ojanvafai/make-time
2. npm install
  ^^^^ This installs type script and firebase
3. Use an editor of your choosing, although Visual Studio Code works particularly well with typescript integration. See https://stackoverflow.com/posts/30319507/revisions.

Starting a dev server:
$ cd make-time
$ ./node_modules/firebase-tools/lib/bin/firebase.js serve --project mk-time

Now http://localhost:5000 serves make-time the same as consumer. For google.com credentials, use --port 5555 to serve from localhost:5555.

Compiling typescript:
You need to compile typescript anytime you modify a .ts file.

Compiling once:
$ ./node_modules/.bin/tsc -p tsconfig.json

Compiling any time a .ts file is modified.
$ ./node_modules/.bin/tsc --watch -p tsconfig.json

Deploying:
$ cd make-time
$ ./deploy.py

In order to deploy, Ojan will need to make you a collaborator on the relevant appengine projects first.

Bundling:
By default, running locally will serve unbundled and deploying will bundle. You can override
the default behavior (locally and on the server) with the query parameter bundle=0 for no bundling
and bundle=1 for bundling.

Generating the bundle:
$ cd make-time
$ ./generate_bundle.py

Navigating the code:
index.html is the file that gets served, but it basically just loads main.js, which in turn loads everything
else as ES Modules. the onLoad() method in main.js is a good starting place to see how the page boots up, or
the router.add calls to see how the different routes get initialized.
