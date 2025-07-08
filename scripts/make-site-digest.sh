#!/bin/bash

MANIFEST=${1-public/site-manifest.json}
DIGEST=${2-public/site-digest.txt}

# TODO rewrite this in Javascript?
# update the MD5 into the digest file, instead of a .txt file.
# then any output can be handled with a template iteration.
# (This may be more similar to what OpenDevise end up doing in any case.)

for URL in $(
    jq -r \
        '.components | .. | select(.url?) | select(.alias? | not) |  .url' \
        $MANIFEST \
    | grep -v '^null$' \
    | sort -u)
do
    FILE=public$URL
    # fillet out just the <main><article> section of the HTML file
    <$FILE htmlq main article > $FILE.digest
    md5sum $FILE.digest
done > $DIGEST
