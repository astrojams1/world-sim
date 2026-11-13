// Run: node --experimental-strip-types --test tests/   (Node 22)
import { test } from "node:test";
import assert from "node:assert/strict";
import { VISIT_BEACON_SCRIPT } from "../src/lib/visit-beacon.ts";

test("the visit beacon reports this site and page to the first-party counter", () => {
  const sent = [];
  const env = {
    location: { pathname: "/", search: "?utm_source=hn" },
    document: { referrer: "https://news.ycombinator.com/item" },
    navigator: { sendBeacon: (u) => sent.push(u) },
  };
  new Function("location", "document", "navigator", VISIT_BEACON_SCRIPT)(env.location, env.document, env.navigator);
  assert.deepEqual(sent, [
    "https://astrojams-apps.vercel.app/api/visit?s=world-sim&u=%2F&p=&utm=hn&r=news.ycombinator.com",
  ]);
});
