const fs = require('fs');
const path = require('path');

// Autolink the pro submodule's native library ONLY when it is actually on disk. Mirrors the
// fs.existsSync(pro) guard metro.config.js uses for the pro JS: a public clone without the private
// submodule sees an empty/absent pro/ dir, this entry is omitted, and the open build compiles with no
// pro native.
//
// This file says only WHERE pro is. What it contains - the Kotlin package to register, the source
// dir, the podspec - is declared by pro/react-native.config.js, which the CLI reads from this `root`
// and merges underneath. That split is the point: this repo is public, and it should not have to
// carry the private package's class names to link it.
//
// IMPORTANT: check a real file inside pro/, never just the pro/ directory - an uninitialised
// submodule leaves an empty pro/ folder behind.
const proRoot = path.resolve(__dirname, 'pro');
const proHasNative = fs.existsSync(path.join(proRoot, 'react-native.config.js'));

module.exports = {
  dependencies: {
    ...(proHasNative ? { '@offgrid/pro': { root: proRoot } } : {}),
  },
};
