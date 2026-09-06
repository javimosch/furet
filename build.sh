#!/usr/bin/env bash
# Build furet. Run from the repo root: the light engine's FFI uses paths
# relative to vendor/qjs, resolved by the C compiler's working directory.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-furet}"
SRC="src/flags.src src/dom.src src/css.src src/jsbridge.src src/engine.src src/main.src"
echo "encoding: $SRC"
machin encode $SRC > build.mfl
echo "building -> $OUT"
machin build build.mfl -o "$OUT"
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
