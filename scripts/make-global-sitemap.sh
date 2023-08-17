#!/bin/bash

MANIFEST=${1-public/site-manifest.json}
SITEMAP=${2-public/global-sitemap.xml}

(
cat <<HEADER
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
HEADER

jq -r \
    '(.generated / 1000 | todate) as $date |
    .url as $url |

    .components |
    map(.versions[0]) |
    map(.pages) |
    flatten |
    map("<url>" +
        "<loc>" + $url + .url + "</loc>" +
        "<lastmod>" + $date + "</lastmod>" + 
        "</url>") | join("\n")' \
    $MANIFEST

echo '</urlset>'
) > $SITEMAP
