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
| heavy | `--heavy` | ready (attach) | real Chrome via CDP — launch locally, or **attach to any Chrome / remote browser** for stealth |

The **light** engine is a from-scratch stack: machin's native HTTP client, a
pragmatic HTML tokenizer building a flat DOM arena (`src/dom.src`), a CSS-lite
selector engine (`src/css.src`), and a real JavaScript core — QuickJS embedded
via machin's C FFI through a thin shim (`vendor/qjs/dombridge.h`,
`src/jsbridge.src`). It is fast and small, but its engine fingerprint is not
Chrome's, so it will **not** pass serious anti-bot defenses.

The **heavy** engine drives real Chrome over the DevTools Protocol (a pure-MFL
plain-WebSocket CDP client, `src/wsclient.src` + `src/cdp.src`). It either
launches Chrome locally (headful on `$DISPLAY`, else under `xvfb-run`) or, the
production stealth path, **attaches to a browser you already run**:

    # attach to a running / remote Chrome (real fingerprint, real TLS)
    FURET_CDP_URL=ws://HOST:9222/devtools/page/XXXX  furet maps "..." --heavy
    FURET_CDP_HTTP=http://HOST:9222                  furet maps "..." --heavy

Attaching is what makes stealth real: point furet at a genuine desktop Chrome or
a remote browser and its fingerprint, canvas, WebGL, and JA3 are Chrome's, not a
custom engine's.

Heavy commands: `fetch`, `eval`, `extract`, and `maps` (all navigate + run JS in
the real page). `maps <query> --heavy` has the Google Maps recipe built in
(consent dismiss + feed scroll + place extraction).

## Commands

| Command | Does |
|---|---|
| `fetch <url>` | status, byte count, content-type, title |
| `text <url> [-s SEL]` | visible text (whole page, or one string per match) |
| `links <url>` | every anchor: `href`, absolute url, text |
| `attr <url> -s SEL -n NAME` | an attribute's value per match |
| `html <url>` | raw response body |
| `eval <url> --js 'EXPR'` | run JS with a `page` object (light) or in real Chrome (heavy) |
| `extract <url> --js 'EXPR'` | run JS over the DOM, emit `{count, items}` (light or heavy) |
| `maps <query> --heavy` | scrape Google Maps places via real Chrome |
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

## Heavy engine: launching vs attaching

Some sandboxes (including the one furet was developed in) forbid a process from
starting a Chrome remote-debugging server. There, use **attach mode**
(`FURET_CDP_URL` / `FURET_CDP_HTTP`) against a Chrome you start outside furet:

    google-chrome --headless=new --remote-debugging-port=9222 \
      --user-data-dir=/tmp/c --remote-allow-origins='*' about:blank &
    FURET_CDP_HTTP=http://127.0.0.1:9222 furet maps "restaurants Annecy" --heavy

The CDP transport (handshake, masked framing, request/response) is verified
end-to-end; the launch path works wherever the environment permits a debug port.

## Status

Light engine: fetch + custom DOM/CSS + real DOM in JS (`document.querySelector*`)
+ `extract`; charset transcoding; verified extracting 3434 records from a real
French AMAP directory. Heavy engine: Chrome via a pure-MFL CDP client, attach or
launch, with a built-in Google Maps recipe. Screenshots/PDF are a later slice.
