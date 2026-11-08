"use strict";
const {
  isPublishableEvent,
  isSocialActivity,
  hasConfirmedLocation,
} = require("../../lib/externalEventPolicy.cjs");

/** Missing/ambiguous facts are policy exclusions, not corrupt input snapshots. */
async function prepareSocialSnapshot(
  snapshot,
  { now = new Date(), locate } = {},
) {
  const events = [],
    excluded = { dateOrTime: 0, social: 0, location: 0 };
  for (const row of snapshot.events) {
    const event = {
      ...row,
      social_eligible:
        row.social_eligible === true ||
        isSocialActivity(row.title, row.description || ""),
    };
    if (event.status === "cancelled" || event.status === "stale") {
      events.push(event);
      continue;
    }
    if (!event.social_eligible) {
      excluded.social++;
      continue;
    }
    if (
      !event.starts_at ||
      !isPublishableEvent(
        {
          ...event,
          latitude: 40.4168,
          longitude: -3.7038,
          venue: event.venue || "pending",
        },
        now.getTime(),
      )
    ) {
      excluded.dateOrTime++;
      continue;
    }
    if (!hasConfirmedLocation(event) && locate)
      Object.assign(event, (await locate(event)) || {});
    if (!hasConfirmedLocation(event)) {
      excluded.location++;
      continue;
    }
    event.location_verified = true;
    event.location_source = event.location_source || "publisher";
    events.push(event);
  }
  return { ...snapshot, events, excluded };
}
module.exports = { prepareSocialSnapshot };
