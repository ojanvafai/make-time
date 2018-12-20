#!/usr/bin/python

from argparse import ArgumentParser
import os
import re
import shutil
import subprocess
import tempfile
import time

parser = ArgumentParser(usage='./deploy.py --projects="mk-time,google.com:mktime"')
parser.add_argument("--projects", dest="projects", help="Comma separated list of projects to deploy to")
args = parser.parse_args()

projects_arg = args.projects if args.projects else "mk-time,google.com:mktime"
projects = projects_arg.split(',')

INDEXES = ['.js']
FILES_TO_MODIFY = ['manifest.json']

# Convert time to an int first to remove decimals.
SUFFIX = '-' + str(int(time.time()))
TEMP_DIR_NAME = 'make_time_deploy'

temp_dir = os.path.join(tempfile.gettempdir(), TEMP_DIR_NAME)
if os.path.exists(temp_dir):
  shutil.rmtree(temp_dir)

root_dir = os.path.dirname(os.path.realpath(__file__))

return_code = subprocess.call([os.path.join(root_dir, 'node_modules/gulp/bin/gulp.js')])
if return_code != 0:
  raise Exception('Gulp steps failed.')

print 'Copying files to temp directory ' + temp_dir + '...'
shutil.copytree(root_dir, temp_dir, ignore=shutil.ignore_patterns('.git', 'static', 'node_modules', 'tests'))

substitutions = dict()

print 'Appending suffixes to file names...'
for root, directories, files in os.walk(temp_dir, topdown=True):
  for index, directory in enumerate(directories):
    # Exclude things like .git directories.
    if directory[0] == '.' or directory == 'tests':
      del directories[index]

  for file in files:
    name, extension = os.path.splitext(file)
    if file in FILES_TO_MODIFY or extension in INDEXES:
      newFile = name + SUFFIX + extension
    elif extension == '.map':
      name, sub_extension = os.path.splitext(name)
      newFile = name + SUFFIX + sub_extension + extension
    else:
      newFile = file;

    substitutions[file] = newFile
    os.rename(os.path.join(temp_dir, root, file), os.path.join(temp_dir, root, newFile))

for root, directories, files in os.walk(temp_dir, topdown=True):
  for file in files:
    with open (os.path.join(temp_dir, root, file), 'r+' ) as f:
      content = f.read()
      for old, new in substitutions.iteritems():
        content = re.sub(old, new, content, flags=re.M)

      # Change to 1 year cache expiration since these are unique URLs.
      if (file == 'firebase.json'):
        content = re.sub('max-age=0', 'max-age=31536000', content, flags=re.M)

      f.seek(0)
      f.write(content)
      f.truncate()

os.chdir(temp_dir)
try:
  firebase_path = os.path.join(root_dir, 'node_modules/firebase-tools/lib/bin/firebase.js')
  for project in projects:
    # TODO: Add in deleting old version automatically https://gist.github.com/mbleigh/5be2e807746cdd9549d0c33260871d21.
    subprocess.call([firebase_path, 'deploy', '--project', project])

finally:
  os.chdir(root_dir)

shutil.rmtree(temp_dir)
