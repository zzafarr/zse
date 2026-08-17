// Unit tests for resolveRedirect() in ../index.htm — run: node tests/resolve.test.js
//
// index.htm is a single HTML file, not an importable module, so to avoid a drifting
// copy of the logic we extract the resolveRedirect function's source straight from
// index.htm and eval it here. The tests therefore exercise the exact shipping code.

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
const resolveRedirect = extractFn("function resolveRedirect(redirects, aliasParam) {");
const buildSearchUrl = extractFn("function buildSearchUrl(origin, pathname, placeholder) {");
const buildOpenSearchXml = extractFn("function buildOpenSearchXml(shortName, origin, pathname) {");
const opensearchStrategy = extractFn("function opensearchStrategy(origin, pinnedHost) {");
const parseRedirects = extractFn("function parseRedirects(text) {");

// Test fixture mirroring the real map's shapes: separator, plain, placeholder+raw, placeholder+encoded.
const redirects = {
    "Section": { type: "separator" },
    "ha": { url: "http://192.168.3.3:8123/", description: "home assistant local" },
    "fdm": { url: "https://freedium-mirror.cfd/{argument}", raw: true, description: "Freedium" },
    "g": { url: "https://www.google.com/search?q={argument}", description: "Google search" },
    "mid": { url: "https://x.test/{argument}/end", description: "mid placeholder" }
};

let passed = 0, failed = 0;
function eq(actual, expected, name) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { passed++; }
    else { failed++; console.error(`FAIL: ${name}\n  expected ${e}\n  actual   ${a}`); }
}

// Case 1: no placeholder, no argument -> ok, url as-is
eq(resolveRedirect(redirects, "ha"),
   { status: "ok", url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "case1: plain alias, no arg");

// Case 2 (raw): placeholder + arg, raw:true -> verbatim nested URL (Freedium)
eq(resolveRedirect(redirects, "fdm https://medium.com/@x/post"),
   { status: "ok", url: "https://freedium-mirror.cfd/https://medium.com/@x/post", description: "Freedium" },
   "case2 raw: fdm with nested URL argument");

// Case 2 (encoded): placeholder + arg, default -> encodeURIComponent
eq(resolveRedirect(redirects, "g cute cats"),
   { status: "ok", url: "https://www.google.com/search?q=cute%20cats", description: "Google search" },
   "case2 encoded: google search encodes spaces");

// Case 2: argument itself may contain spaces and '?' — only the FIRST space splits
eq(resolveRedirect(redirects, "g a b?c d"),
   { status: "ok", url: "https://www.google.com/search?q=a%20b%3Fc%20d", description: "Google search" },
   "case2: first-space split keeps rest of argument (incl. '?') intact");

// Case 3: no placeholder + arg -> noarg, argument dropped, url unchanged
eq(resolveRedirect(redirects, "ha extra stuff"),
   { status: "noarg", url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "case3: arg passed to placeholder-less alias is dropped (orange)");

// Case 4: placeholder + no arg -> noarg, token stripped, rest intact
eq(resolveRedirect(redirects, "fdm"),
   { status: "noarg", url: "https://freedium-mirror.cfd/", description: "Freedium" },
   "case4: placeholder alias with no arg strips {argument} (orange)");
eq(resolveRedirect(redirects, "mid"),
   { status: "noarg", url: "https://x.test//end", description: "mid placeholder" },
   "case4: mid-URL placeholder stripped, surrounding text preserved");

// Unknown alias -> red
eq(resolveRedirect(redirects, "zzz"),
   { status: "notfound", alias: "zzz" },
   "unknown alias -> notfound");

// Case-insensitive alias match
eq(resolveRedirect(redirects, "HA"),
   { status: "ok", url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "alias match is case-insensitive");

// Separator entries are never matched as aliases
eq(resolveRedirect(redirects, "Section"),
   { status: "notfound", alias: "Section" },
   "separator is not a matchable alias");

// Chrome %s may percent-encode the whole value (space -> %20); decode before splitting
eq(resolveRedirect(redirects, "g%20hello"),
   { status: "ok", url: "https://www.google.com/search?q=hello", description: "Google search" },
   "percent-encoded space from Chrome is decoded before first-space split");

// Empty argument (trailing space) counts as an argument present -> encoded empty string
eq(resolveRedirect(redirects, "g "),
   { status: "ok", url: "https://www.google.com/search?q=", description: "Google search" },
   "trailing space = empty argument present (case 2, empty value)");

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
function assert(cond, name) { if (cond) { passed++; } else { failed++; console.error("FAIL: " + name); } }
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
assert(html.includes('params.get("alias") ?? params.get("key")'),
       "compat: onload selects alias then falls back to key");
const pick = (qs) => { const p = new URLSearchParams(qs); return p.get("alias") ?? p.get("key"); };
eq(pick("alias=ha"), "ha", "compat: alias present -> alias used");
eq(pick("key=ha"), "ha", "compat: only legacy key present -> key used");
eq(pick("alias=ha&key=gm"), "ha", "compat: alias wins when both present");
eq(pick("foo=bar"), null, "compat: neither present -> null (no redirect)");

// --- parseRedirects: pipe-delimited inline data -> redirects object ---
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

eq(Object.keys(parsed), ["Home Assistant", "ha", "Other", "fdm", "noDesc", "Spaced Title", "spacey"],
   "parseRedirects: keys + order (sections inline, 'bad' skipped)");
eq(parsed["Home Assistant"], { type: "separator" }, "parseRedirects: # line -> separator");
eq(parsed["Spaced Title"], { type: "separator" }, "parseRedirects: header whitespace trimmed");
eq(parsed["ha"], { url: "http://192.168.3.3:8123/", description: "home assistant local" },
   "parseRedirects: basic record");
eq(parsed["fdm"], { url: "https://freedium-mirror.cfd/{argument}", description: "Freedium", raw: true },
   "parseRedirects: 4th field 'raw' -> raw:true");
eq(parsed["noDesc"], { url: "https://x.test/", description: "noDesc" },
   "parseRedirects: missing description defaults to alias");
eq(parsed["spacey"], { url: "https://y.test/", description: "Y" },
   "parseRedirects: extra whitespace around | is trimmed");
assert(!("bad" in parsed), "parseRedirects: url-less line is skipped");

// Whitespace around | is OPTIONAL: no-space and aligned-space rows parse identically.
eq(parseRedirects("a|https://z.test/|Z")["a"],
   parseRedirects("a   |   https://z.test/   |   Z")["a"],
   "parseRedirects: whitespace around | optional (tight == padded)");

// 'true' is also accepted as the raw flag (alias of 'raw')
eq(parseRedirects("t | u | d | true")["t"].raw, true,
   "parseRedirects: 'true' also sets raw");

// --- The real inline #redirectData block parses and matches the shipping map's expectations ---
const dataBlock = html.match(/<script type="text\/plain" id="redirectData">\n([\s\S]*?)<\/script>/)[1];
const live = parseRedirects(dataBlock);
eq(live["fdm"], { url: "https://freedium-mirror.cfd/{argument}", description: "Freedium", raw: true },
   "live data: fdm has {argument} + raw:true");
eq(live["ha"].url, "http://192.168.3.3:8123/", "live data: ha resolves");
assert(live["Home Assistant"] && live["Home Assistant"].type === "separator", "live data: sections present");
// Resolver works end-to-end against the real parsed data (raw arg substitution).
eq(resolveRedirect(live, "fdm https://medium.com/@x/post"),
   { status: "ok", url: "https://freedium-mirror.cfd/https://medium.com/@x/post", description: "Freedium" },
   "live data + resolver: fdm raw substitution end-to-end");
// Every expected alias from today's config is present.
["sf","gm","ha","hass","hal","har","nabu","bi","bilan","unifi","cbb","deluge","tt","todo","zse",
 "frontodoor","driveway","southgate","grill","patio","northgate","garage","amcredit","ecobee","rent","cct","fdm"
].forEach((a) => assert(a in live, "live data: alias '" + a + "' present"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
