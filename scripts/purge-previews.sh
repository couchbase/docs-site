#!/bin/bash

INPUT=builds.json

PURGE_DAYS=${PURGE_DAYS-30}

# `date` is different on Mac/Linux so we have to do some fiddling
UNAME="$(uname -s)"
case "${UNAME}" in
    Linux*)     machine=Linux;;
    Darwin*)    machine=Mac;;
    CYGWIN*)    machine=Cygwin;;
    MINGW*)     machine=MinGw;;
    MSYS_NT*)   machine=MSys;;
    *)          machine="UNKNOWN:${unameOut}"
esac

if [ $machine == "Mac" ];
then
    SINCE=`date -v -${PURGE_DAYS}d -I`
else
    SINCE=`date -d "${PURGE_DAYS} days ago" -I`
fi


jq  --arg SINCE "$SINCE" \
    -r \
    'to_entries[] | select(.value.date < $SINCE) | .key' \
    $INPUT
