#!/usr/bin/python

from argparse import ArgumentParser
import os
import re
import shutil
import subprocess
import tempfile
import time

parser = ArgumentParser(usage='./deploy.py --version stable --projects="make-time,google.com:make-time"')
parser.add_argument("--version", dest="version", help="Appengine version")
parser.add_argument("--projects", dest="projects", help="Comma separated list of projects to deploy to")
args = parser.parse_args()

version = args.version
projects = args.projects.split(',')

INDEXES = ['.js', '.json'];
# Convert time to an int first to remove decimals.
SUFFIX = '-' + str(int(time.time()))
TEMP_DIR_NAME = 'make_time_deploy'

temp_dir = os.path.join(tempfile.gettempdir(), TEMP_DIR_NAME)
if os.path.exists(temp_dir):
  shutil.rmtree(temp_dir)
shutil.copytree(os.path.dirname(__file__), temp_dir, ignore=shutil.ignore_patterns('.git'))

substitutions = dict()

for root, directories, files in os.walk(temp_dir, topdown=True):
  for index, directory in enumerate(directories):
    # Exclude things like .git directories.
    if directory[0] == '.' or directory == 'tests':
      del directories[index]

  for file in files:
    name, extension = os.path.splitext(file)
    if extension in INDEXES:
      newFile = name + SUFFIX + extension
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
      f.seek(0)
      f.write(content)
      f.truncate()

yaml_path = os.path.join(temp_dir, 'app.yaml');
for project in projects:
  deploy_command = ['gcloud', 'app', 'deploy', '-q', '--project', project, '--version', version, yaml_path]
  subprocess.call(deploy_command)

shutil.rmtree(temp_dir)
