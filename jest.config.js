module.exports = {
    "roots": [
      "<rootDir>",
    ],
    "transform": {
      "^.+\\.tsx?$": "ts-jest"
    },
    "testRegex": "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
    "moduleFileExtensions": [
      "ts", "js"
    ],
    "moduleDirectories": [
        "src",
        "node_modules"
    ],
    "moduleNameMapper": {
        "^(\.+)/([A-Z][A-Za-z]*)\.js": "$1/$2\.ts"
    }
  }