Could not get Firebase, TypeScript and in browser ES Modules to all work together
without using a bundler on each edit. This directory contains downloaded copies of
the Firebase client JS files.

This directory is full of gross. Steps taken to produce it:

1. Copy firebase-*.js from https://www.gstatic.com/firebasejs/5.8.2/.
2. Copy index.d.ts from node_modules/firebase and name it firebase-app.d.ts so that
 the firebase object can be imported with "import * as firebase from ...".
3. Changed the default export of firebase-app.d.ts to make it place nicely with
the combination of typescript and browser ES Modules imports.
4. Wrap firebase-app.js so that it exports firebase as it's default export
See third_party/README.md for details on the wrapping.
5. Create a dummy firebase-auth.d.ts in order to be able to load firebase auth
using the same import syntax as firebase-app, but have it be sorted after
firebase-app by clang-format.
