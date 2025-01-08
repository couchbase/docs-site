#!/bin/bash

INPUT=builds.json

PURGE_DAYS=${PURGE_DAYS-30}

SINCE=`date -v -${PURGE_DAYS}d -I`

jq  --arg SINCE "$SINCE" \
    -r \
    'to_entries[] | select(.value.date < $SINCE) | .key' \
    $INPUT
