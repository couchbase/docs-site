#!/bin/bash

echo "Changing to scripts directory ..."
cd ./scripts || exit


FONTAWESOME_NPM_AUTH_TOKEN=0A6E1AEF-9C2E-40DC-B01E-4C7E702F83B3 npm install

cd .. || exit

echo "Creating folder (if it doesn't exist) ..."
mkdir /Users/rayoffiah/projects/couchbase/rayoffiah.github.io/"$1";

echo "Building site ..."
npx antora --clean --stacktrace ./doc-12476-antora-playbook.yml --to-dir /Users/rayoffiah/projects/couchbase/rayoffiah.github.io/"$1";

echo "Populating FontAwesome icon set ..."
node ./scripts/populate-icon-defs.js /Users/rayoffiah/projects/couchbase/rayoffiah.github.io/"$1";
