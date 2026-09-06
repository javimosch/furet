# furet

Agent-first scraping & browser manipulation, as one small static machin binary,
with a **pluggable engine backend** so an agent can trade speed for stealth by
flipping one flag.

```
furet [--light|--heavy|--engine E] <command> <url> [options]
```

Every command prints **one JSON line** with the same envelope regardless of
engine — that uniform shape is the point: an agent parses output identically
whether it ran the fast custom engine or (later) a stealth browser.

```json
{"ok":true,"engine":"light","cmd":"fetch","url":"…","status":200,"data":{…},"error":""}
```

## Engines

| Engine | Flag | Status | For |
|---|---|---|---|
| light | `--light` (default) | ready | fast, tiny; fetch + custom DOM + JS (QuickJS); non-hostile JS sites |
| heavy | `--heavy` | seam only | chrome-in-xvfb for stealth vs anti-bot; **not yet implemented** |

The **light** engine is a from-scratch stack: machin's native HTTP client, a
pragmatic HTML tokenizer building a flat DOM arena (`src/dom.src`), a CSS-lite
selector engine (`src/css.src`), and a real JavaScript core — QuickJS embedded
via machin's C FFI through a thin shim (`vendor/qjs/dombridge.h`,
`src/jsbridge.src`). It is fast and small, but its engine fingerprint is not
Chrome's, so it will **not** pass serious anti-bot defenses.

The **heavy** engine is where that gap is closed later: drive real Chrome under
a virtual display (Xvfb) so the fingerprint, TLS signature, and rendering are
genuinely Chrome's. Today it returns a clean structured "not yet implemented"
so callers can detect it and fall back.

## Commands

| Command | Does |
|---|---|
| `fetch <url>` | status, byte count, content-type, title |
| `text <url> [-s SEL]` | visible text (whole page, or one string per match) |
| `links <url>` | every anchor: `href`, absolute url, text |
| `attr <url> -s SEL -n NAME` | an attribute's value per match |
| `html <url>` | raw response body |
| `eval <url> --js 'EXPR'` | run JS with a `page` object (light only) |
| `guide` | machine-readable capability catalog (JSON) |

`eval` exposes the fetched page to JavaScript as `page.url`, `page.status`,
`page.title`, `page.text`, `page.html`, plus the raw `dom.get`/`dom.set` store.

```
furet eval https://example.com/ --js "page.text.split(/\s+/).length"
```

## Exit codes

`0` ok · `1` command error (network, JS throw) · `2` usage error.

## CSS support

`tag` · `*` · `#id` · `.class` · `[attr]` · compound (`div.card#main[data-x]`) ·
descendant combinator (space). Child `>`, siblings, attribute-value matching,
and pseudo-classes are future slices.

## Build

Needs `machin` on PATH and a C compiler. QuickJS is prebuilt into
`vendor/qjs/libqjs.a`.

```
./build.sh              # -> ./furet (dynamic, ~1.3 MB)
machin build build.mfl --static -o furet   # self-contained (~7 MB)
```

## Architecture — where the next slice plugs in

The seam is `engine_fetch(engine, url) -> Page` and the per-command handlers in
`src/engine.src`. Both engines produce the same `Page`/envelope. To add
chrome-in-xvfb:

1. Implement `heavy_fetch(url)` to drive Chrome under Xvfb (CDP over a local
   socket), returning a populated `Page{ body, status, ... }`.
2. Route JS/interaction commands (`eval`, and future `click`/`screenshot`) to
   the heavy backend when `engine == "heavy"`.
3. Nothing else changes: DOM parsing, selectors, and the JSON envelope are
   engine-agnostic and already work on whatever `body` the engine returns.

## Status

Slice one: light engine (fetch + DOM + CSS-lite + JS eval) and the engine
abstraction. Heavy engine is a wired seam. Rendering (screenshots/PDF) and a
CDP command surface are later slices.
