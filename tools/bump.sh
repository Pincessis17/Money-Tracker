#!/bin/sh
# Gives every release a new version number so phones never mix old and new files.
# Usage: sh tools/bump.sh
cd "$(dirname "$0")/.."
N=$(grep -o 'my-money-v[0-9]*' sw.js | grep -o '[0-9]*$'); N=$((N + 1))
sed -i "s/my-money-v[0-9]*/my-money-v$N/" sw.js
sed -i "s/?v=[0-9]*/?v=$N/g" index.html sw.js
echo "version $N"
