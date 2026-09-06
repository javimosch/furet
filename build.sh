#!/usr/bin/env bash
# Build furet. Run from the repo root: the light engine's FFI uses paths
# relative to vendor/qjs, resolved by the C compiler's working directory.
set -euo pipefail
cd "$(dirname "$0")"
OUT="${1:-furet}"
# embed the JS DOM shim as an MFL string constant
python3 -c "import json;print('func dom_shim_js() (s) { s = '+json.dumps(open('js/domshim.js').read())+' }')" > src/domshim_gen.src
python3 -c "print('func latin1_hi_bytes() (b) { b = from_hex(\"'+''.join(bytes([x]).decode('latin-1').encode('utf-8').hex() for x in range(128,256))+'\") }')" > src/latin1_gen.src
SRC="src/flags.src src/dom.src src/css.src src/charset.src src/latin1_gen.src src/wsclient.src src/cdp.src src/jsbridge.src src/domshim_gen.src src/engine.src src/main.src"
echo "encoding: $SRC"
machin encode $SRC > build.mfl
echo "building -> $OUT"
machin build build.mfl -o "$OUT"
echo "built $OUT ($(du -h "$OUT" | cut -f1))"
