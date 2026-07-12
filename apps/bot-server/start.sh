#!/bin/sh
# Runtime entrypoint. nixpacks' runtime image sometimes omits the compiled dist/
# (it re-copies the gitignored-excluded source), so build it here if absent, then run.
set -e

if [ ! -f dist/index.js ]; then
  echo "dist/index.js not found — installing deps and building..."
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  corepack pnpm install --ignore-scripts
  corepack pnpm build
fi

echo "starting bot server..."
exec node dist/index.js
