#!/usr/bin/python

import subprocess

subprocess.call(['./node_modules/rollup/bin/rollup', '--config', 'rollup.config.js'])
# TODO: Replace this with an actual minifier.
subprocess.call(['sed', 's/^[ \t]*//', '-i', 'public/gen/bundle.js'])
