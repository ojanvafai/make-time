module.exports = {
    "testEnvironment": "jest-environment-jsdom-fourteen",
    "roots": [
      "<rootDir>",
    ],
    // This doens't seem to work. Removed rollup-jest from package.json since it
    // prints warnings on npm install.
    "preset": "rollup-jest",
    "transform": {
      "^.+\\.tsx?$": "ts-jest"
    },
    "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
    "moduleFileExtensions": [
      "ts", "js"
    ],
    "moduleDirectories": [
        "src",
        "node_modules",
    ],
    "moduleNameMapper": {
        // For jest, we want to import ts files, not js files.
        // There are a few files for which we don't want this.
        // All camel case can be remapped.
        "^(\.+)/([A-Z][A-Za-z]*)\.js": "$1/$2\.ts",
        // There are a few files that don't follow our naming scheme.
        // Maybe we should just rename them?
        "./idb-keyval.js": "./idb-keyval.ts",
        "./base64.js": "./base64.ts",
        // We need to mock out firebase, or fix the way we wrap it. This is a
        // hacky way of mocking it out. We now import firebase like a regular
        // import from npm, so this can probably be done the right way.
        // "(.*)third_party/firebasejs/5.8.2/firebase-(.*).js" :
        // "$1test_support/firebase-mock.ts"
    }
  }