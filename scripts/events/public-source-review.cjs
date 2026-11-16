"use strict";
const { readDocument } = require("./providers.cjs");
const { jsonLdSnapshot } = require("./publisher-jsonld.cjs");
const { prepareSocialSnapshot } = require("./social-snapshot.cjs");

// Public discovery pages inspected on 2026-11-09. This is a review command:
// it never activates providers, writes Supabase or implies publisher permission.
const SOURCES = {
  meetup: {
    pages: ["https://www.meetup.com/find/es--madrid/"],
    host: "www.meetup.com", path: /^\/[^/]+\/events\/\d+\/$/,
  },
  eventbrite: {
    pages: ["https://www.eventbrite.es/d/spain--madrid/language-exchange/", "https://www.eventbrite.es/d/spain--madrid/yoga/", "https://www.eventbrite.es/d/spain--madrid/juegos-de-mesa/", "https://www.eventbrite.es/d/spain--madrid/senderismo/"],
    host: "www.eventbrite.es", path: /^\/e\/[^/]+-\d+\/?$/,
  },
};
function eventLinks(html, source) {
  const urls = new Set();
  for (const match of html.matchAll(/\bhref=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), `https://${source.host}`);
      if (url.protocol !== "https:" || url.hostname !== source.host || url.username || url.password || !source.path.test(url.pathname)) continue;
      url.search = ""; url.hash = ""; urls.add(url.href);
    } catch { /* Ignore non-links. */ }
  }
  return [...urls];
}
async function reviewSource(name, { fetchImpl = fetch, now = new Date(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), limit = 24 } = {}) {
  const source = SOURCES[name];
  if (!source) throw new Error("Unknown reviewed discovery source");
  const links = new Set();
  for (const url of source.pages) {
    await wait(1100);
    for (const link of eventLinks(await readDocument(url, fetchImpl, "text/html"), source)) links.add(link);
  }
  const events = [], failures = [];
  for (const url of [...links].slice(0, limit)) {
    await wait(1100);
    try {
      const snapshot = jsonLdSnapshot(await readDocument(url, fetchImpl, "text/html"), url);
      events.push(...snapshot.events.filter(event => event.source_url.replace(/\/$/, "") === url.replace(/\/$/, "")));
    } catch (error) { failures.push({ url, error: error.message }); }
  }
  const prepared = await prepareSocialSnapshot({ events, rawCount: events.length, rejected: 0, expired: 0, duplicates: 0 }, { now });
  return {
    source: name, checked_at: now.toISOString(), discovery_pages: source.pages,
    candidate_urls: links.size, reviewed_urls: Math.min(links.size, limit),
    truncated: links.size > limit, complete_import_snapshot: false,
    reuse_approved: false, failures, excluded: prepared.excluded, events: prepared.events,
  };
}
if (require.main === module) {
  if (process.env.NEXO_PUBLIC_SOURCE_ACCESS_APPROVED !== "true")
    throw new Error("Automated publisher access is not approved. Obtain a permitted feed/API or publisher authorization before running this collector.");
  const args = process.argv.slice(2);
  const source = args.find(arg => arg.startsWith("--source="))?.slice(9);
  const output = args.find(arg => arg.startsWith("--report="))?.slice(9);
  if (!output) throw new Error("Provide --source=meetup|eventbrite and --report=path.json");
  reviewSource(source).then(report => {
    require("node:fs").writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify({ source, reviewed: report.reviewed_urls, eligible: report.events.length, failures: report.failures.length, report: output }));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { SOURCES, eventLinks, reviewSource };
