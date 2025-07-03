#!/bin/bash

MANIFEST=${1-public/site-manifest.json}
DIGEST=${2-public/site-digest.txt}

for URL in $(
    jq -r \
        '.components | .. | select(.url?) | select(.alias? | not) |  .url' \
        $MANIFEST \
    | grep -v '^null$')
do
    md5sum public$URL
done > $DIGEST
