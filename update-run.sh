#!/bin/bash

RECORD=$(mktemp).json
NEW=$(mktemp).json

cat <<JSON > $RECORD
{
    "$PLAYBOOK": {
        "actor": "$GITHUB_ACTOR",
        "ref": "$(git rev-parse HEAD)",
        "date": "$(date)",
        "run_id": "$GITHUB_RUN_ID"
    }
}
JSON

jq -s add index.json $RECORD > $NEW
mv $NEW index.json

cat index.json
git add index.json
git commit index.json -m "Updated $PLAYBOOK"
git push
