#!/bin/bash

MANIFEST=${1-public/site-manifest.json}
DIGEST=${2-public/site-digest.txt}

for URL in $(
    jq -r \
        '.components | .. | select(.url?) | select(.alias? | not) |  .url' \
        $MANIFEST \
    | grep -v '^null$')
do
    FILE=public$URL
    # fillet out just the <main> section of the HTML file
    <$FILE htmlq main > $FILE.digest
    md5sum $FILE.digest
done > $DIGEST
