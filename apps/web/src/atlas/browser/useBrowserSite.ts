import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import { useFaviconForThreadUrl } from "~/browserFaviconStore";

import { type BrowserSiteInput, sanitizeSiteUrl } from "./browserSites";
import { useBrowserSitesStore } from "./browserSitesStore";

/**
 * The page a browser tab shows, as a site the star button can save. Every
 * page that finishes loading also becomes the first of Recents.
 */
export function useBrowserSite(input: {
  readonly threadRef: ScopedThreadRef;
  readonly url: string;
  readonly title: string | null;
  readonly loaded: boolean;
}): BrowserSiteInput | null {
  const { threadRef, url, title, loaded } = input;
  const favicon = useFaviconForThreadUrl(threadRef, url);
  useEffect(() => {
    if (!loaded || !url) return;
    useBrowserSitesStore.getState().visit({ url, title, favicon });
  }, [favicon, loaded, title, url]);
  return url && sanitizeSiteUrl(url) ? { url, title, favicon } : null;
}
