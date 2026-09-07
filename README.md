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
| heavy | `--heavy` | ready (verified live) | real Chromium (Chrome/**Edge**) via CDP — launch locally, or **attach to any browser** for stealth |

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
    FURET_CDP_URL=ws://HOST:9222/devtools/page/XXXX  furet feed "<url>" --heavy -s "<sel>"
    FURET_CDP_HTTP=http://HOST:9222                  furet feed "<url>" --heavy -s "<sel>"

Attaching is what makes stealth real: point furet at a genuine desktop Chrome or
a remote browser and its fingerprint, canvas, WebGL, and JA3 are Chrome's, not a
custom engine's.

Heavy commands: `fetch`, `eval`, `extract`, and `feed` (all navigate + run JS in
the real page). `feed <url> --heavy -s <selector>` is a generic infinite-scroll extractor: it scrolls a JS-rendered list and collects every element matching your selector (use it only where permitted — see Responsible use)
(consent dismiss + feed scroll + place extraction).

## Footprint

furet's `--light` engine is a single static binary that embeds a real JavaScript
runtime (QuickJS) **instead of a browser**, so it scrapes JS-capable pages at a
fraction of the memory and disk of browser-based tools. Measured on this machine
with `/usr/bin/time`, extracting 200 structured records over the light engine:

| Tool | Install / binary | RAM (typical) | Extra runtime | Runs page JS |
|---|---|---|---|---|
| **furet --light** | **7.3 MB** static (1.3 MB dynamic) | **~9 MB** | none | yes (QuickJS) |
| obscura | ~70 MB | ~30 MB | none | yes (V8) |
| Headless Chrome / Chromium | ~300 MB+ | ~200 MB+ per tab | none | yes |
| Puppeteer / Playwright | Chromium ~170–280 MB + `node_modules` | ~200 MB+ | Node.js | yes |
| Scrapy / BeautifulSoup | Python packages | ~30–60 MB | Python | no¹ |

¹ Pure-Python HTML parsers don't run page JavaScript; scraping JS-rendered sites
adds Selenium/Playwright + a full browser.

**furet light-engine numbers (measured):**

| Metric | Value |
|---|---|
| Static binary (self-contained) | 7.3 MB |
| Dynamic binary | 1.3 MB (links only libc + OpenSSL) |
| RAM, typical scrape (fetch + parse + JS extract of 200 items) | ~9 MB peak |
| Time, 200-record extract (local page) | ~0.02 s |
| Cold start + HTTPS fetch (incl. TLS) | ~0.23 s |
| Startup runtime | none — no Node, no Python, no Chromium |

The light engine holds the parsed DOM in the JS engine, so peak RAM scales with
page size (a ~900 KB page peaks near ~100 MB while it works, then exits). Numbers
for other tools are typical/published figures, not measured here — obscura's are
its own published claims.

> The lightweight numbers are the **light** engine, the right tool for pages that
> aren't actively defended. furet's `--heavy` engine drives a real Chrome/Edge, so
> its footprint there is a browser's — you reach for it only when a site needs one.

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
| `feed <url> --heavy -s SEL` | scroll a JS-rendered list in a real browser and collect items matching SEL → `{count, items:[{text,href}]}` |
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

The heavy engine works against any Chromium (Chrome or **Microsoft Edge** — same
CDP). It navigates a real page and runs your extractor JavaScript in it, so it
handles JS-rendered sites the light engine can't. **You are responsible for using
it only where you are permitted to** (see Responsible use below).

Attach mode (the production stealth path) points furet at a browser you start
yourself or run remotely:

    microsoft-edge --headless=new --remote-debugging-port=9222 \
      --remote-allow-origins='*' --user-data-dir=/tmp/fe about:blank &
    FURET_CDP_HTTP=http://127.0.0.1:9222 furet extract --heavy "<url>" --js "<extractor>"

Launch mode (`furet feed ... --heavy` with no env) starts a browser itself. Note:
some sandboxes block a *Chrome* debug server but allow *Edge* — set `FURET_BROWSER`
or attach to Edge if so.

The CDP client is pure MFL: a plain-ws client with fragment reassembly
(`src/wsclient.src`), CDP request/response (`src/cdp.src`), and Content-Length
HTTP/1.1 discovery (machin's `http_get` hangs on the DevTools keep-alive).

## Status

- `--light` extracts structured records from server-rendered pages at high volume
  (thousands of items from a large directory page in ~2 s), sniffing `<meta
  charset>` and transcoding legacy encodings to UTF-8.
- `--heavy` drives a real browser (Chrome/Edge) over a pure-MFL CDP client to
  scrape JS-rendered pages, with best-effort dedup and an opt-in `--screenshot`.

Later slices: PDF (Page.captureScreenshot already does screenshots), heavy
text/links/attr, child/sibling CSS combinators.

## Responsible use

furet is a general-purpose tool. **How you use it is your responsibility.** Before
pointing it at a site you do not own:

- Read and respect that site's **Terms of Service** and `robots.txt`. Many
  many services restrict or prohibit automated extraction;
  bulk-extracting from them may breach their terms even when the pages are public.
- Do not collect **personal data** unlawfully. Data-protection law (e.g. the GDPR
  in the EU) can apply to scraped personal data regardless of whether it is public.
- Scrape gently: identify yourself where appropriate, rate-limit, and don't
  degrade the target's service.
- Prefer official **APIs** and data you own or have permission to access. furet
  ships **no built-in target** — you supply every URL and selector.

This project does not endorse or encourage any use that violates a third party's
terms or the law, and it names no site as an approved target.

## Disclaimer

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. The authors and
contributors accept **no liability** for any claim, damages, or other liability
arising from its use, and are **not responsible** for how it is used or for any
consequences of scraping any third-party service. See [LICENSE](LICENSE).

## Credits

Built in [machin](https://github.com/javimosch/machin) (MFL). Developed with
[Claude Code](https://claude.com/claude-code). Embeds
[QuickJS-ng](https://github.com/quickjs-ng/quickjs) (MIT) for the light engine's
JavaScript runtime. Licensed under the MIT License.
