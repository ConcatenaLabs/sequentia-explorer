#!/bin/bash
# Build BOTH explorers as static assets under ONE hostname (the demo server root '/' is a
# greeting page served by serve-public.js; the explorers live under sub-paths):
#   /explorer/   -> Sequentia testnet   (API /api,           electrs :3003)
#   /testnet4/   -> Bitcoin testnet4     (API /testnet4/api,  electrs :3004)
# Output: esplora/dist/ (explorer/, testnet4/).
set -xeo pipefail
cd "$(dirname "$0")/esplora"
# build.sh shells out to browserify/pug/uglifyjs/babel-node from node_modules/.bin
export PATH="$PWD/node_modules/.bin:$PWD/client/node_modules/.bin:$PATH"

rm -rf dist   # clean so no stale root-served Sequentia build lingers after the /explorer/ move

REL_MENU='{"Sequentia Testnet":"/explorer/","Bitcoin Testnet4":"/testnet4/"}'

# --- Sequentia under /explorer/ ---
DEST=dist/explorer BASE_HREF=/explorer/ API_URL=/api \
  MENU_ITEMS="$REL_MENU" \
  PARENT_CHAIN_EXPLORER_BLOCK='/testnet4/block/{hash}' \
  ./build.sh sequentia-testnet

# --- Bitcoin testnet4 under /testnet4/ ---
# CUSTOM_CSS='' so the flavor starts clean; we re-append the Sequentia theme
# (switcher + dark chip) and the orange override AFTER, matching the dev order.
DEST=dist/testnet4 BASE_HREF=/testnet4/ API_URL=/testnet4/api \
  MENU_ITEMS="$REL_MENU" MENU_ACTIVE='Bitcoin Testnet4' \
  FOOTER_LINKS='{"img/github_blue.png":"https://sequentia.io"}' \
  CUSTOM_CSS='' \
  ./build.sh bitcoin-testnet4
cat flavors/sequentia-testnet/extras.css \
    flavors/sequentia-testnet/parent-accent.css >> dist/testnet4/style.css

echo "built -> esplora/dist (/explorer/, /testnet4/)"
