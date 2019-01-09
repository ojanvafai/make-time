This folder is forked NPM modules that are just forked so we can import
them directly as ES Modules. This is done by wrapping them with the following
taken from https://medium.com/@backspaces/es6-modules-part-2-libs-wrap-em-up-8715e116d690).
It still pollutes the global scope, but it lets the library work as a proper module.

// Manually wrapped. See deps/README.md.
if (!window.${name}) {
  function wrap () {
    ${library-code}
  }
  wrap.call(window)
}
const result = window.${name}
if (!result) throw Error("Something went wrong with wrapping ${name}.")
export default result
