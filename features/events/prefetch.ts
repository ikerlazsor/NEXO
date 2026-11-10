import { fetchEventPage } from "./api";
import { hydrateEventPage } from "./cache";
import { getIsOnline } from "../../lib/network";

export async function prefetchPublicEvents(): Promise<void> {
  const page = await hydrateEventPage("{}");
  if (getIsOnline() && (!page || Date.now() - page.at > 120000)) {
    await fetchEventPage({}, null);
  }
}
