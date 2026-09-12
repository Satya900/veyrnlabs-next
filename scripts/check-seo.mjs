import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
const base = new URL(process.argv[2] || "http://localhost:3002");
const canonical = new URL("/", process.argv[3] || "https://veyrnlabs.com").href;
const request = (path) => fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
const response = await request("/");
assert.equal(response.status, 200, "Homepage must return 200");
assert(!/noindex/i.test(response.headers.get("x-robots-tag") || ""), "Homepage HTTP header must allow indexing");
const html = await response.text();
const tags = [...html.matchAll(/<(meta|link)\b[^>]*>/gi)].map(([tag]) =>
  Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value.replaceAll("&amp;", "&")]))
);
const meta = (name) => tags.filter((tag) => tag.name === name || tag.property === name);
assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, "One primary heading");
assert.equal((html.match(/<title>/g) || []).length, 1, "One title");
assert(html.includes("Veyrn Labs | AI Engineering"), "Descriptive brand title");
const canonicalTags = tags.filter((tag) => tag.rel === "canonical");
assert.equal(canonicalTags.length, 1, "One canonical URL");
// Next.js may serialize a root URL without its trailing slash; these are
// equivalent URLs, so compare their parsed representations.
assert.equal(new URL(canonicalTags[0].href).href, canonical, "Canonical uses production origin");
assert.equal(meta("description").length, 1, "One meta description");
assert(meta("description")[0].content.length > 80, "Meaningful description");
assert(meta("robots").some((tag) => /\bindex\b/.test(tag.content) && !/noindex/.test(tag.content)), "Homepage is indexable");
assert.equal(new URL(meta("og:url")[0]?.content).href, canonical, "Open Graph URL matches canonical");
assert.equal(meta("twitter:card")[0]?.content, "summary_large_image");
assert(meta("og:image").length > 0 && meta("twitter:image").length > 0, "Social image tags exist");

const scripts = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, "One structured-data graph");
const data = JSON.parse(scripts[0][1]);
for (const type of ["Organization", "WebSite", "WebPage"]) {
  const entity = data["@graph"].find((entry) => entry["@type"] === type);
  assert(entity, type + " is present");
  assert.equal(entity.url, canonical, type + " URL matches canonical");
}

const robotsResponse = await request("/robots.txt");
assert.equal(robotsResponse.status, 200);
const robots = await robotsResponse.text();
assert(robots.includes("Allow: /"), "Crawling allowed");
assert(robots.includes(new URL("/sitemap.xml", canonical).href), "Sitemap discoverable");
assert(!/^Disallow:\s*\/$/m.test(robots), "No blanket crawl block");
const sitemapResponse = await request("/sitemap.xml");
assert.equal(sitemapResponse.status, 200);
const sitemap = await sitemapResponse.text();
const locations = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
assert.deepEqual(locations, [canonical], "Sitemap contains only the canonical homepage");

for (const [path, expectedWidth, expectedHeight] of [
  ["/icon1.png", 96, 96],
  ["/apple-icon.png", 180, 180],
  ["/brand/veyrn-mark-512.png", 512, 512],
  ["/opengraph-image", 1200, 630],
]) {
  const asset = await request(path);
  assert.equal(asset.status, 200, path + " reachable");
  const metadata = await sharp(Buffer.from(await asset.arrayBuffer())).metadata();
  assert.equal(metadata.width, expectedWidth, path + " width");
  assert.equal(metadata.height, expectedHeight, path + " height");
}
const ico = await request("/favicon.ico");
assert.equal(ico.status, 200);
const bytes = Buffer.from(await ico.arrayBuffer());
assert.equal(bytes.readUInt16LE(2), 1, "Valid ICO signature");
assert.equal(bytes.readUInt16LE(4), 4, "ICO includes four resolutions");
assert(tags.some((tag) => tag.rel === "icon" && tag.href.includes("icon1.png")), "PNG favicon advertised");
assert(tags.some((tag) => tag.rel === "apple-touch-icon"), "Apple icon advertised");
const missing = await request("/seo-check-page-that-does-not-exist");
assert.equal(missing.status, 404, "Unknown pages return 404");
console.log("PASS: server-rendered metadata, indexing, canonical, structured data, sitemap, robots, social image, favicon sizes, and 404.");
