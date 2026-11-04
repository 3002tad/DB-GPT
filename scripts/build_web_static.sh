#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

SCRIPT_LOCATION=$0
cd "$(dirname "$SCRIPT_LOCATION")"
WORK_DIR=$(pwd)
WORK_DIR="$WORK_DIR/.."
TARGET_DIR="$WORK_DIR/packages/dbgpt-app/src/dbgpt_app/static/web"

echo "Building web static files"
echo "Target directory: $TARGET_DIR"

cd $WORK_DIR/web

source_env=".env"
tmp_env=".env.copy"

if [ -e "$source_env" ]; then
  cp "$source_env" "$tmp_env"
  rm -rf "$source_env"
else
  echo "Do not find .env"
fi


yarn install
rm -rf ../web/out/
yarn compile

if [ "${NEXT_PUBLIC_FUNNELMETRY_IDENTITY:-}" = "1" ]; then
  if [ -z "${NEXT_PUBLIC_FUNNELMETRY_UI_ORIGIN:-}" ]; then
    echo "NEXT_PUBLIC_FUNNELMETRY_UI_ORIGIN is required for the Pipeline return button" >&2
    exit 1
  fi
  if ! grep -R -q 'funnelmetry:ai-back' ../web/out/_next/static/chunks; then
    echo "The compiled UI is missing the Pipeline return button" >&2
    exit 1
  fi
fi

rm -rf $TARGET_DIR \
  && mkdir -p $TARGET_DIR \
  && cp -R ../web/out/* $TARGET_DIR

if [ -e "$tmp_env" ]; then
  cp "$tmp_env" "$source_env" 
  rm -rf "$tmp_env"
fi
