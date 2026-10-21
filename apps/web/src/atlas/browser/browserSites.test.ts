import { describe, expect, it } from "vite-plus/test";

import {
  BROWSER_FAVORITES_MAX,
  BROWSER_RECENTS_MAX,
  type BrowserSite,
  findSite,
  parseStoredSites,
  recordRecent,
  refreshSite,
  removeSite,
  sanitizeSiteUrl,
  siteFaviconFallbackUrl,
  siteInitial,
  siteLabel,
  toggleFavorite,
} from "./browserSites";

const ICON = "data:image/png;base64,AAAA";
const urls = (sites: ReadonlyArray<BrowserSite>) => sites.map((site) => site.url);

describe("sanitizeSiteUrl", () => {
  it("keeps http(s) pages and drops embedded credentials", () => {
    expect(sanitizeSiteUrl("https://user:pw@example.com/docs?q=atlas")).toBe(
      "https://example.com/docs?q=atlas",
    );
    expect(sanitizeSiteUrl("http://localhost:5173/")).toBe("http://localhost:5173/");
  });

  it("drops blank, local-file and internal pages", () => {
    expect(sanitizeSiteUrl("about:blank")).toBeNull();
    expect(sanitizeSiteUrl("")).toBeNull();
    expect(sanitizeSiteUrl("file:///Users/me/index.html")).toBeNull();
    expect(sanitizeSiteUrl("data:text/html,hi")).toBeNull();
  });

  it("drops pairing links and URLs whose query or hash carries a token", () => {
    expect(sanitizeSiteUrl("http://localhost:3773/pair#token=abc")).toBeNull();
    expect(sanitizeSiteUrl("https://app.example.com/login?access_token=x")).toBeNull();
    expect(sanitizeSiteUrl("https://app.example.com/cb?code=123&state=xyz")).toBeNull();
    expect(sanitizeSiteUrl("https://app.example.com/#id_token=eyJ")).toBeNull();
    expect(sanitizeSiteUrl("https://s3.example.com/f?X-Amz-Signature=abc")).toBeNull();
    expect(
      sanitizeSiteUrl("https://example.com/?ref=Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr"),
    ).toBeNull();
  });

  it("keeps ordinary query strings", () => {
    expect(sanitizeSiteUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(sanitizeSiteUrl("https://github.com/search?q=code+atlas&author=me")).not.toBeNull();
  });
});

describe("recordRecent", () => {
  it("puts the newest visit first and dedupes by page", () => {
    let recents: ReadonlyArray<BrowserSite> = [];
    recents = recordRecent(recents, { url: "https://a.dev/" }, 1);
    recents = recordRecent(recents, { url: "https://b.dev/" }, 2);
    recents = recordRecent(recents, { url: "https://a.dev/#section" }, 3);
    expect(urls(recents)).toEqual(["https://a.dev/#section", "https://b.dev/"]);
  });

  it(`keeps at most ${BROWSER_RECENTS_MAX} sites`, () => {
    let recents: ReadonlyArray<BrowserSite> = [];
    for (let index = 0; index < BROWSER_RECENTS_MAX + 3; index += 1) {
      recents = recordRecent(recents, { url: `https://site${index}.dev/` }, index);
    }
    expect(recents).toHaveLength(BROWSER_RECENTS_MAX);
    expect(recents[0]?.url).toBe(`https://site${BROWSER_RECENTS_MAX + 2}.dev/`);
  });

  it("ignores about:blank and token URLs", () => {
    const recents = recordRecent([], { url: "https://a.dev/" }, 1);
    expect(recordRecent(recents, { url: "about:blank" }, 2)).toBe(recents);
    expect(recordRecent(recents, { url: "http://localhost:3773/pair#token=t" }, 2)).toBe(recents);
  });

  it("keeps a known title and icon when a later visit lacks them", () => {
    let recents = recordRecent([], { url: "https://a.dev/", title: " Atlas ", favicon: ICON }, 1);
    recents = recordRecent(recents, { url: "https://b.dev/" }, 2);
    recents = recordRecent(recents, { url: "https://a.dev/", title: "" }, 3);
    expect(recents[0]).toEqual({
      url: "https://a.dev/",
      title: "Atlas",
      favicon: ICON,
      savedAt: 3,
    });
  });

  it("returns the same list when the front entry did not change", () => {
    const recents = recordRecent([], { url: "https://a.dev/", title: "A" }, 1);
    expect(recordRecent(recents, { url: "https://a.dev/", title: "A" }, 2)).toBe(recents);
  });
});

describe("favorites", () => {
  it("toggles a page in and out, appending new favorites", () => {
    let favorites = toggleFavorite([], { url: "https://a.dev/", title: "A" }, 1);
    favorites = toggleFavorite(favorites, { url: "https://b.dev/" }, 2);
    expect(urls(favorites)).toEqual(["https://a.dev/", "https://b.dev/"]);
    expect(findSite(favorites, "https://a.dev")).toBeDefined();
    favorites = toggleFavorite(favorites, { url: "https://a.dev" }, 3);
    expect(urls(favorites)).toEqual(["https://b.dev/"]);
  });

  it("removes a favorite from its tile", () => {
    const favorites = toggleFavorite([], { url: "https://a.dev/" }, 1);
    expect(removeSite(favorites, "https://a.dev/")).toEqual([]);
    expect(removeSite(favorites, "https://other.dev/")).toBe(favorites);
  });

  it("refuses token URLs and a full list", () => {
    expect(toggleFavorite([], { url: "https://a.dev/?token=x" }, 1)).toEqual([]);
    let favorites: ReadonlyArray<BrowserSite> = [];
    for (let index = 0; index < BROWSER_FAVORITES_MAX; index += 1) {
      favorites = toggleFavorite(favorites, { url: `https://site${index}.dev/` }, index);
    }
    expect(toggleFavorite(favorites, { url: "https://one-more.dev/" }, 99)).toBe(favorites);
  });

  it("fills in a favorite's title and icon without reordering", () => {
    let favorites = toggleFavorite([], { url: "https://a.dev/" }, 1);
    favorites = toggleFavorite(favorites, { url: "https://b.dev/" }, 2);
    const refreshed = refreshSite(favorites, { url: "https://a.dev/", title: "A", favicon: ICON });
    expect(refreshed[0]).toEqual({ url: "https://a.dev/", title: "A", favicon: ICON, savedAt: 1 });
    expect(urls(refreshed)).toEqual(urls(favorites));
    expect(refreshSite(refreshed, { url: "https://a.dev/", title: "A" })).toBe(refreshed);
  });
});

describe("tile presentation", () => {
  it("labels a site by title, else by host without www", () => {
    expect(siteLabel({ url: "https://www.example.com/x", title: "Example" })).toBe("Example");
    expect(siteLabel({ url: "https://www.example.com/x" })).toBe("example.com");
    expect(siteInitial("https://www.github.com/")).toBe("G");
    expect(siteFaviconFallbackUrl("https://github.com/a/b?c=1")).toBe(
      "https://github.com/favicon.ico",
    );
  });
});

describe("parseStoredSites", () => {
  it("drops malformed, duplicate and no-longer-storable entries", () => {
    expect(
      urls(
        parseStoredSites(
          [
            { url: "https://a.dev/", savedAt: 1, title: "A" },
            { url: "https://a.dev/#x", savedAt: 2 },
            { url: "about:blank", savedAt: 3 },
            { url: "https://b.dev/?token=x", savedAt: 4 },
            { url: 5, savedAt: 5 },
            { url: "https://c.dev/" },
            "junk",
            { url: "https://d.dev/", savedAt: 6, favicon: "javascript:alert(1)" },
          ],
          8,
        ),
      ),
    ).toEqual(["https://a.dev/", "https://d.dev/"]);
    expect(parseStoredSites(null, 8)).toEqual([]);
  });
});
