# zse — a personal redirect "search engine"

Turn short aliases you type in the browser address bar into full URLs. `zse` is a single static HTML file (`index.htm`) hosted on GitHub Pages — no backend, no build, no dependencies.

Type `@`⇥`ha` → land on your Home Assistant. Type `@`⇥`fdm https://medium.com/...` → land on the Freedium version of that article. An alias can even do **two things** — `@`⇥`sf` opens your Seeking Alpha portfolio, `@`⇥`sf MSFT` jumps to the MSFT symbol page.

## How it works

1. You register `zse` as a **custom search engine** in Chrome with a keyword (e.g. `@`).
2. Typing `<keyword>`⇥`<alias> [argument]` sends you to `https://<your-host>/?alias=<alias> <argument>`.
3. `index.htm` looks up the alias in its `redirects` map and redirects you to the target URL, optionally substituting your argument.

Visiting the page with no `?alias=` shows a browsable table of every alias, with a compact setup panel below it.

## Use it yourself (fork & deploy)

1. **Fork** this repo to your account.
2. **Enable GitHub Pages:** repo → Settings → Pages → Source = `main` branch, root. Your site publishes at `https://<you>.github.io/<repo>/`.
3. **Edit `index.htm`** — replace the entries in the `#redirectData` block with your own aliases (see below).
4. **Open your published page.** The setup panel (below the table) auto-detects your host and shows your exact search URL.

## Register it in Chrome

The page helps two ways (host is auto-detected — no editing needed):

- **Auto-discovery (OpenSearch):** just visiting your page makes Chrome offer the **`zse`** engine under **Settings → Search engines**. Open that, find it, and set a keyword (e.g. `@`). Chrome intentionally won't let a page set the keyword for you. (The page links a static [`opensearch.xml`](opensearch.xml) when served from its pinned host; forks on a different host get an equivalent descriptor generated at runtime, so no file edit is needed.)
- **Manual (works everywhere):** click **Copy search URL** on the page, then Chrome → **Settings → Search engines → Manage → Add**, paste into "URL with %s", and choose a name + shortcut keyword.

> **Fully silent, one-click registration is not possible** from a web page — Chrome has no such API (it would be a hijacking vector). OpenSearch + copy button is as close as it gets without installing an extension.

### Daily use

Address bar → type your keyword (`@`) → **Tab** → alias (+ optional argument) → **Enter**.

## Configuring aliases

Aliases live in the **`<script type="text/plain" id="redirectData">`** block near the top of the source (just inside `<body>`, so it's the first thing you reach when editing) — a simple **`|`-delimited** list, parsed at load. One record per line; order = table order.

```
alias[,alias2,…] | url [| description [| raw]]
```

- **`# Section Title`** on its own line = a section header row (also works as a comment).
- **Fields are separated by `|`.** `|` never appears in URLs, so you never have to quote or escape anything (unlike CSV with commas).
- **Whitespace around `|` is optional** — it's trimmed, so `ha | url` and `ha|url` are equivalent. Pad it out to align columns if you like.
- **The alias field may be a comma-separated list** — `ha,hass,hal | url | desc` gives all three the same URL/description in one line (see [Multiple aliases, one URL](#multiple-aliases-one-url)).
- **Description** is optional (defaults to the (first) alias). **4th field `raw`** (or `true`) inserts the argument verbatim — see below.
- **An alias may appear twice** — one row *without* `{argument}` and one *with* — to give it two behaviors (see [Two behaviors for one alias](#two-behaviors-for-one-alias)).
- Blank lines are ignored.

Example (whitespace around `|` is just for readability):

```
# Home Assistant
ha  | http://192.168.3.3:8123/                    | home assistant local

# Other
g   | https://www.google.com/search?q={argument}  | Google search
fdm | https://freedium-mirror.cfd/{argument}       | Freedium | raw
```

> It's parsed inline (no separate file to fetch), so adding an alias doesn't change load time or caching.

### Arguments

Type an alias, a space, then an argument: `@`⇥`g cute cats`.

- The value is split on the **first space** — everything after is the argument (may itself contain spaces, `?`, `://`).
- `{argument}` in the `url` is where the argument goes.
- By default the argument is URL-**encoded** (`cute cats` → `cute%20cats`). Add **`raw: true`** to insert it verbatim — needed for path-style nested URLs like Freedium.

### Multiple aliases, one URL

Give one URL several aliases by listing them **comma-separated** in the alias field:

```
ha,hass,hal | http://192.168.3.3:8123/                  | home assistant local
har,nabu    | https://…ui.nabu.casa/                     | home assistant Nabucasa
```

- Any listed alias resolves to the shared URL — `@`⇥`ha`, `@`⇥`hass`, and `@`⇥`hal` all land on the same place.
- The `description` and `raw`/`{argument}` behavior apply to **every** alias in the list.
- It's pure shorthand: `ha,hass,hal | url | desc` is exactly equivalent to writing those three rows on separate lines. You can still use separate lines if you prefer — mix and match freely.
- Whitespace around commas is trimmed (`ha, hass, hal` works); empty items (stray or trailing commas) are ignored.

**Table auto-merge:** in the browsable index, rows that share the **same URL *and* same description** (within a section) collapse into a **single row** showing all their aliases (`ha, hass, hal`) — whether you authored them comma-separated or on separate lines. Conflicting rows (see below) are never merged, so config errors stay individually visible.

### Two behaviors for one alias

Define the **same alias twice** — once without `{argument}`, once with — and it does the right thing based on whether you pass an argument:

```
sf | https://seekingalpha.com/account/portfolio/summary?portfolioId=65457843 | Seeking Alpha
sf | https://seekingalpha.com/symbol/{argument}                              | Seeking Alpha | true
```

- `@`⇥`sf` → the portfolio (the row **without** `{argument}`).
- `@`⇥`sf MSFT` → `https://seekingalpha.com/symbol/MSFT` (the row **with** `{argument}`).

Rules:
- An alias can have at most **two** rows: one *plain* (no `{argument}`) and one *arg* (has `{argument}`). The one used is picked by whether you typed an argument.
- **Exact duplicate** (same alias, same "slot", **same URL**) → the extra is ignored at redirect time (first one wins). It still shows in the table.
- **Conflict** (same alias, same slot, **different URLs**) → that alias won't redirect; you get a **red config error** naming the two URLs, and the offending rows are highlighted red in the table. A conflict in one slot doesn't break the other slot.

### The four cases (single-variant alias)

For an alias with just **one** row, the redirect and notice depend on `{argument}` vs. what you typed:

| Alias URL has `{argument}`? | You passed an argument? | Result | Notice |
|---|---|---|---|
| No | No | redirect to the URL as-is | green |
| Yes | Yes | substitute the argument (encoded, or raw) | green |
| No | Yes | redirect anyway, argument ignored | **orange** "without argument" |
| Yes | No | redirect with `{argument}` stripped out | **orange** "without argument" |

A **two-variant** alias (both rows defined) never goes orange — each way of typing it has a matching row.

Unknown alias → red "Alias Not Found". Conflicting alias → red config error.

## Caching & refresh

The page is tiny and static, so it caches well. A few realities on **GitHub Pages**:

- `<meta http-equiv="Cache-Control">` tags are **ignored** by browsers for HTTP caching — only real response headers count, so the file doesn't carry one.
- GitHub Pages sets its **own** `Cache-Control` (~10 min) plus an `ETag`, and **does not allow custom headers**. So you can't force a true 1-day browser cache here; instead the browser revalidates via the ETag (usually a fast `304 Not Modified`). For genuine long-lived / offline caching you'd need a service worker (intentionally not used here to keep things simple).

**Force a refresh after editing aliases:**

1. Navigate to a **non-existent alias**, e.g. `…/?alias=xxx`. It shows the page (red "Alias Not Found") and does **not** redirect — so nothing bounces you away mid-refresh.
2. Press **Ctrl+Shift+R** (hard reload) to bypass the cache and re-fetch.

> Don't use a *real* alias for this — real aliases auto-redirect in 0.5–1 s, which races your reload. The bad-alias trick keeps the page still so the hard reload lands cleanly.

## Tests

Pure logic (`resolveRedirect`, `parseRedirects`, `groupRowsForDisplay`, `buildSearchUrl`, `buildOpenSearchXml`, `opensearchStrategy`) is unit-tested — including two-variant aliases (plain/arg selection), duplicate dedup, same-slot conflicts, comma-list alias expansion (raw applies to all, empty items skipped, conflicts still fire), table auto-merge grouping (same url+desc within a section; not across sections or conflicts), and that the real inline `#redirectData` block parses correctly and resolves end-to-end. The tests extract the functions straight from `index.htm`, so there's no separate copy to drift.

```
node tests/resolve.test.js
```

## Notes

- The repo/source and every URL in it are **public** if the repo is public. Don't put secrets/tokens in alias URLs.
- Full design and rebuild spec: [`spec/0.requirements.md`](spec/0.requirements.md).
