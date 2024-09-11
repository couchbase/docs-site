#!/bin/bash

echo "Changing to scripts directory ..."
cd ./scripts || exit


FONTAWESOME_NPM_AUTH_TOKEN=0A6E1AEF-9C2E-40DC-B01E-4C7E702F83B3 npm install

cd .. || exit

echo "Running log build ..."

echo "Building site ..."
npx antora --clean --stacktrace ./doc-12476-antora-playbook.yml


