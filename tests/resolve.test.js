// Unit tests for the pure logic in ../index.htm — run: node tests/resolve.test.js
//
// index.htm is a single HTML file, not an importable module, so to avoid a drifting
// copy of the logic we extract each function's source straight from index.htm and eval
// it here. The tests therefore exercise the exact shipping code.

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.htm"), "utf8");
// Extract each function's source straight from index.htm (no drifting copy). Each is matched
// up to its closing brace at the script's 8-space indent level.
function extractFn(signature) {
    const re = new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?\\n        \\}");
    const m = html.match(re);
    if (!m) { console.error("FAIL: could not locate " + signature + " in index.htm"); process.exit(1); }
    // eslint-disable-next-line no-eval
    return eval("(" + m[0] + ")");
}
const resolveRedirect = extractFn("function resolveRedirect(aliases, aliasParam) {");
const buildSearchUrl = extractFn("function buildSearchUrl(origin, pathname, placeholder) {");
const buildOpenSearchXml = extractFn("function buildOpenSearchXml(shortName, origin, pathname) {");
const opensearchStrategy = extractFn("function opensearchStrategy(origin, pinnedHost) {");
const parseRedirects = extractFn("function parseRedirects(text) {");

let passed = 0, failed = 0;
function eq(actual, expected, name) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { passed++; }
    else { failed++; console.error(`FAIL: ${name}\n  expected ${e}\n  actual   ${a}`); }
}
function assert(cond, name) { if (cond) { passed++; } else { failed++; console.error("FAIL: " + name); } }

// Build the resolution map (parseRedirects().aliases) from inline data, the same way index.htm does.
// resolveRedirect operates on this map, so tests exercise the real parse -> resolve path end-to-end.
function aliasesFrom(text) { return parseRedirects(text).aliases; }

// Fixture covering the shapes: plain, placeholder+raw, placeholder+encoded, mid-URL placeholder,
// and a section header (which must NOT become a matchable alias).
const fixture = aliasesFrom([
    "# Section",
    "ha  | http://192.168.3.3:8123/                    | home assistant local",
    "fdm | https://freedium-mirror.cfd/{argument}      | Freedium | raw",
    "g   | https://www.google.com/search?q={argument}  | Google search",
    "mid | https://x.test/{argument}/end               | mid placeholder"
].join("\n"));

// Case 1: no placeholder, no argument -> ok, url as-is
eq(resolveRedirect(fixture, "ha"),
   { status: "ok", url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "case1: plain alias, no arg");

// Case 2 (raw): placeholder + arg, raw:true -> verbatim nested URL (Freedium)
eq(resolveRedirect(fixture, "fdm https://medium.com/@x/post"),
   { status: "ok", url: "https://freedium-mirror.cfd/https://medium.com/@x/post", description: "Freedium" },
   "case2 raw: fdm with nested URL argument");

// Case 2 (encoded): placeholder + arg, default -> encodeURIComponent
eq(resolveRedirect(fixture, "g cute cats"),
   { status: "ok", url: "https://www.google.com/search?q=cute%20cats", description: "Google search" },
   "case2 encoded: google search encodes spaces");

// Case 2: argument itself may contain spaces and '?' — only the FIRST space splits
eq(resolveRedirect(fixture, "g a b?c d"),
   { status: "ok", url: "https://www.google.com/search?q=a%20b%3Fc%20d", description: "Google search" },
   "case2: first-space split keeps rest of argument (incl. '?') intact");

// Case 3: no placeholder + arg -> noarg, argument dropped, url unchanged (single-variant fallback)
eq(resolveRedirect(fixture, "ha extra stuff"),
   { status: "noarg", url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "case3: arg passed to placeholder-less single-variant alias is dropped (orange)");

// Case 4: placeholder + no arg -> noarg, token stripped, rest intact (single-variant fallback)
eq(resolveRedirect(fixture, "fdm"),
   { status: "noarg", url: "https://freedium-mirror.cfd/", description: "Freedium" },
   "case4: placeholder-only alias with no arg strips {argument} (orange)");
eq(resolveRedirect(fixture, "mid"),
   { status: "noarg", url: "https://x.test//end", description: "mid placeholder" },
   "case4: mid-URL placeholder stripped, surrounding text preserved");

// Unknown alias -> red
eq(resolveRedirect(fixture, "zzz"),
   { status: "notfound", alias: "zzz" },
   "unknown alias -> notfound");

// Case-insensitive alias match
eq(resolveRedirect(fixture, "HA"),
   { status: "ok", url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "alias match is case-insensitive");

// Section headers are never matchable aliases (they're not in the aliases map at all)
eq(resolveRedirect(fixture, "Section"),
   { status: "notfound", alias: "Section" },
   "separator/header is not a matchable alias");

// Chrome %s may percent-encode the whole value (space -> %20); decode before splitting
eq(resolveRedirect(fixture, "g%20hello"),
   { status: "ok", url: "https://www.google.com/search?q=hello", description: "Google search" },
   "percent-encoded space from Chrome is decoded before first-space split");

// Empty argument (trailing space) counts as an argument present -> encoded empty string
eq(resolveRedirect(fixture, "g "),
   { status: "ok", url: "https://www.google.com/search?q=", description: "Google search" },
   "trailing space = empty argument present (case 2, empty value)");

// --- Two variants per alias: plain (no {argument}) + arg (has {argument}), keyed on (alias, slot) ---
// The motivating example: "sf" -> portfolio when bare, /symbol/{argument} when given a ticker.
const sf = aliasesFrom([
    "sf | https://seekingalpha.com/account/portfolio/summary?portfolioId=65457843 | Seeking Alpha",
    "sf | https://seekingalpha.com/symbol/{argument}                              | Seeking Alpha | true"
].join("\n"));
eq(resolveRedirect(sf, "sf"),
   { status: "ok", url: "https://seekingalpha.com/account/portfolio/summary?portfolioId=65457843", description: "Seeking Alpha" },
   "variants: bare 'sf' -> plain variant (portfolio), green");
eq(resolveRedirect(sf, "sf MSFT"),
   { status: "ok", url: "https://seekingalpha.com/symbol/MSFT", description: "Seeking Alpha" },
   "variants: 'sf MSFT' -> arg variant (/symbol/MSFT), green (raw:true so no encoding)");
// Two-variant aliases never go orange — each usage has its own matching slot.
assert(resolveRedirect(sf, "sf").status === "ok" && resolveRedirect(sf, "sf X").status === "ok",
   "variants: both usages resolve green (no orange when both slots defined)");

// Variant order in the data doesn't matter (arg row first, plain row second still resolves correctly).
const sfReversed = aliasesFrom([
    "sf | https://seekingalpha.com/symbol/{argument} | Seeking Alpha | true",
    "sf | https://seekingalpha.com/portfolio        | Seeking Alpha"
].join("\n"));
eq(resolveRedirect(sfReversed, "sf").url, "https://seekingalpha.com/portfolio",
   "variants: slot selection is independent of row order (bare -> plain)");
eq(resolveRedirect(sfReversed, "sf MSFT").url, "https://seekingalpha.com/symbol/MSFT",
   "variants: slot selection is independent of row order (arg -> arg)");

// --- Exact-duplicate rows (same alias, same slot, same URL) are IGNORED at resolve time ---
// Description of a later exact-URL dup is ignored: the FIRST row's description wins.
const dup = aliasesFrom([
    "d | https://d.test/ | First",
    "d | https://d.test/ | Second"          // exact-URL dup -> ignored; 'First' description kept
].join("\n"));
eq(resolveRedirect(dup, "d"),
   { status: "ok", url: "https://d.test/", description: "First" },
   "dedup: exact-URL dup ignored, first description wins");

// --- Conflict: same alias, same slot, DIFFERENT urls -> red config error, never redirects ---
const conflict = aliasesFrom([
    "c | https://a.test/ | C",
    "c | https://b.test/ | C"               // same slot (plain), different url -> conflict
].join("\n"));
eq(resolveRedirect(conflict, "c"),
   { status: "conflict", alias: "c", slot: "plain", urls: ["https://a.test/", "https://b.test/"] },
   "conflict: same-slot different-url -> conflict status naming both urls");

// Conflict is PER-SLOT: a broken plain slot does not poison a valid arg slot on the same alias.
const mixed = aliasesFrom([
    "m | https://a.test/            | M",   // plain #1
    "m | https://b.test/            | M",   // plain #2 (different) -> plain slot conflicts
    "m | https://m.test/{argument}  | M"    // arg slot, single + valid
].join("\n"));
eq(resolveRedirect(mixed, "m").status, "conflict",
   "conflict per-slot: bare 'm' hits the conflicted plain slot -> conflict");
eq(resolveRedirect(mixed, "m QQQ"),
   { status: "ok", url: "https://m.test/QQQ", description: "M" },
   "conflict per-slot: 'm QQQ' hits the valid arg slot -> still works");

// --- buildSearchUrl: auto-detect host + append ?alias=<placeholder> ---
// Owner's exact Chrome custom-search-engine URL — guards against param/host/shape regressions.
eq(buildSearchUrl("https://zzafarr.github.io", "/zse/", "%s"),
   "https://zzafarr.github.io/zse/?alias=%s",
   "buildSearchUrl: owner's live Chrome engine URL");
eq(buildSearchUrl("https://u.github.io", "/zse/", "%s"),
   "https://u.github.io/zse/?alias=%s",
   "buildSearchUrl: project pages path with trailing slash");
eq(buildSearchUrl("https://u.github.io", "/zse/index.htm", "%s"),
   "https://u.github.io/zse/?alias=%s",
   "buildSearchUrl: strips index.htm filename to its directory");
eq(buildSearchUrl("https://example.com", "/", "{searchTerms}"),
   "https://example.com/?alias={searchTerms}",
   "buildSearchUrl: root path with OpenSearch placeholder");

// --- buildOpenSearchXml: valid descriptor, absolute template, {searchTerms}, XML-escaped ---
const xml = buildOpenSearchXml("zse", "https://u.github.io", "/zse/");
assert(xml.includes('<ShortName>zse</ShortName>'), "openSearch: ShortName present");
assert(xml.includes('template="https://u.github.io/zse/?alias={searchTerms}"'),
       "openSearch: absolute template with {searchTerms}");
assert(xml.includes('xmlns="http://a9.com/-/spec/opensearch/1.1/"'), "openSearch: correct namespace");
// A template containing '&' must be XML-escaped to '&amp;' to stay well-formed.
const xmlAmp = buildOpenSearchXml("zse", "https://u.github.io", "/p/");
assert(!/&(?!amp;)/.test(xmlAmp.split('template="')[1].split('"')[0]) , "openSearch: '&' escaped in template");

// --- opensearchStrategy: static file only on the pinned host, Blob elsewhere (forks) ---
eq(opensearchStrategy("https://zzafarr.github.io", "https://zzafarr.github.io"), "static",
   "strategy: pinned host -> static opensearch.xml");
eq(opensearchStrategy("https://someone-else.github.io", "https://zzafarr.github.io"), "blob",
   "strategy: fork host -> runtime Blob descriptor");

// --- static opensearch.xml must not drift from what buildOpenSearchXml would generate ---
// The pinned host in index.htm and the static file's <ShortName>/template must agree.
const staticXml = fs.readFileSync(path.join(__dirname, "..", "opensearch.xml"), "utf8");
const pinnedHost = html.match(/PINNED_OPENSEARCH_HOST = "([^"]+)"/)[1];
assert(staticXml.includes("<ShortName>zse</ShortName>"), "static xml: ShortName is zse");
const staticTemplate = staticXml.split('template="')[1].split('"')[0];
assert(staticTemplate.startsWith(pinnedHost + "/"),
       "static xml: template host matches PINNED_OPENSEARCH_HOST (" + pinnedHost + ")");
assert(staticTemplate.includes("?alias={searchTerms}"),
       "static xml: template uses ?alias={searchTerms}");

// --- Backward-compat param selection: prefer ?alias=, fall back to legacy ?key= ---
// The selection lives in window.onload (not the pure resolver). Guard the exact line is present,
// then reproduce its semantics with URLSearchParams to prove precedence.
assert(html.includes('params.get("alias") || params.get("key")'),
       "compat: onload selects alias then falls back to key");
// "||" (not "??") so an EMPTY ?alias= is treated as absent and still falls through to legacy ?key=.
const pick = (qs) => { const p = new URLSearchParams(qs); return p.get("alias") || p.get("key"); };
eq(pick("alias=ha"), "ha", "compat: alias present -> alias used");
eq(pick("key=ha"), "ha", "compat: only legacy key present -> key used");
eq(pick("alias=ha&key=gm"), "ha", "compat: alias wins when both present");
eq(pick("alias=&key=ha"), "ha", "compat: EMPTY alias falls through to legacy key");
eq(pick("foo=bar"), null, "compat: neither present -> null (no redirect)");

// --- parseRedirects: pipe-delimited inline data -> { rows, aliases } ---
const sample = [
    "# Home Assistant",
    "ha | http://192.168.3.3:8123/ | home assistant local",
    "",
    "# Other",
    "fdm | https://freedium-mirror.cfd/{argument} | Freedium | raw",
    "noDesc | https://x.test/",                        // description omitted -> defaults to alias
    "  # Spaced Title  ",                              // header with surrounding whitespace
    "bad",                                              // alias only, no url -> skipped
    "spacey |   https://y.test/   |   Y  "             // extra whitespace around | trimmed
].join("\n");
const parsed = parseRedirects(sample);

// rows: every authored (non-blank, non-malformed) row, in order — separators carry their title.
eq(parsed.rows.map(r => r.type === "separator" ? "#" + r.title : r.alias),
   ["#Home Assistant", "ha", "#Other", "fdm", "noDesc", "#Spaced Title", "spacey"],
   "parseRedirects.rows: order preserved, headers as #title, 'bad' skipped");
eq(parsed.rows.find(r => r.alias === "ha"),
   { type: "entry", alias: "ha", url: "http://192.168.3.3:8123/", description: "home assistant local", raw: false },
   "parseRedirects.rows: basic entry row shape");
eq(parsed.rows.find(r => r.alias === "fdm").raw, true, "parseRedirects.rows: raw flag on row");
eq(parsed.rows.find(r => r.alias === "noDesc").description, "noDesc",
   "parseRedirects.rows: missing description defaults to alias");
eq(parsed.rows.find(r => r.alias === "spacey"),
   { type: "entry", alias: "spacey", url: "https://y.test/", description: "Y", raw: false },
   "parseRedirects.rows: whitespace around | trimmed");

// aliases: resolution map, lowercased keys, no separators.
eq(Object.keys(parsed.aliases).sort(), ["fdm", "ha", "nodesc", "spacey"],
   "parseRedirects.aliases: lowercased alias keys only (no separators)");
eq(parsed.aliases["ha"].variants.plain,
   { url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "parseRedirects.aliases: plain-slot entry");
eq(parsed.aliases["fdm"].variants.arg,
   { url: "https://freedium-mirror.cfd/{argument}", description: "Freedium", raw: true },
   "parseRedirects.aliases: {argument} url -> arg slot, raw:true");
assert(!parsed.aliases["ha"].conflict.plain && !parsed.aliases["ha"].conflict.arg,
   "parseRedirects.aliases: no conflict on a clean single-variant alias");

// Whitespace around | is OPTIONAL: no-space and aligned-space rows parse identically.
eq(parseRedirects("a|https://z.test/|Z").rows[0],
   parseRedirects("a   |   https://z.test/   |   Z").rows[0],
   "parseRedirects: whitespace around | optional (tight == padded)");

// 'true' is also accepted as the raw flag (alias of 'raw')
eq(parseRedirects("t | u | d | true").rows[0].raw, true,
   "parseRedirects: 'true' also sets raw");

// parseRedirects marks conflicts + records the clashing urls in slot order.
const cParsed = parseRedirects("c | https://a.test/ | C\nc | https://b.test/ | C");
assert(cParsed.aliases["c"].conflict.plain, "parseRedirects: same-slot diff-url sets conflict.plain");
eq(cParsed.aliases["c"].urls.plain, ["https://a.test/", "https://b.test/"],
   "parseRedirects: conflicting urls recorded in order");
// Exact-URL dup does NOT set conflict, and both rows still appear in the table (rows keeps them).
const dParsed = parseRedirects("d | https://d.test/ | First\nd | https://d.test/ | Second");
assert(!dParsed.aliases["d"].conflict.plain, "parseRedirects: exact-URL dup is not a conflict");
eq(dParsed.rows.length, 2, "parseRedirects: duplicate rows are BOTH kept in rows (shown in table)");
eq(dParsed.aliases["d"].variants.plain.description, "First",
   "parseRedirects: first row's description wins on dup");

// --- The real inline #redirectData block parses and matches the shipping map's expectations ---
const dataBlock = html.match(/<script type="text\/plain" id="redirectData">\n([\s\S]*?)<\/script>/)[1];
const live = parseRedirects(dataBlock);
eq(live.aliases["fdm"].variants.arg,
   { url: "https://freedium-mirror.cfd/{argument}", description: "Freedium", raw: true },
   "live data: fdm has {argument} + raw:true in arg slot");
eq(live.aliases["ha"].variants.plain.url, "http://192.168.3.3:8123/", "live data: ha resolves");
assert(live.rows.some(r => r.type === "separator"), "live data: section headers present in rows");
// Resolver works end-to-end against the real parsed data (raw arg substitution).
eq(resolveRedirect(live.aliases, "fdm https://medium.com/@x/post"),
   { status: "ok", url: "https://freedium-mirror.cfd/https://medium.com/@x/post", description: "Freedium" },
   "live data + resolver: fdm raw substitution end-to-end");
// Every expected alias from today's config is present.
["sf","gm","ha","hass","hal","har","nabu","bi","bilan","unifi","cbb","deluge","tt","todo","zse",
 "frontodoor","driveway","southgate","grill","patio","northgate","garage","amcredit","ecobee","rent","cct","fdm"
].forEach((a) => assert(a in live.aliases, "live data: alias '" + a + "' present"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
