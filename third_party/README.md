This folder is third_party code that is forked from NPM for one reason or another.

A common reason is to add typescript definition files or to convert them to ES Modules.

TODO: Remove those cases. Now that we use esbuild, it handles this for us.

Converting to ES Modules is done by wrapping them with the following taken from
https://medium.com/@backspaces/es6-modules-part-2-libs-wrap-em-up-8715e116d690.
It still pollutes the global scope, but it lets the library work as a proper module.

// Manually wrapped. See third_party/README.md.
if (!window.${name}) {
  function wrap () {
    ${library-code}
  }
  wrap.call(window)
}
const result = window.${name};
if (!result) throw Error("Something went wrong with wrapping ${name}.")
export default result
