import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveBrowserFaviconStorage } from "~/browserFaviconStore";

import {
  BROWSER_FAVORITES_MAX,
  BROWSER_RECENTS_MAX,
  type BrowserSite,
  type BrowserSiteInput,
  findSite,
  parseStoredSites,
  recordRecent,
  refreshSite,
  removeSite,
  toggleFavorite,
} from "./browserSites";

interface BrowserSitesState {
  readonly recents: ReadonlyArray<BrowserSite>;
  readonly favorites: ReadonlyArray<BrowserSite>;
  readonly visit: (site: BrowserSiteInput) => void;
  readonly toggleFavorite: (site: BrowserSiteInput) => void;
  readonly removeRecent: (url: string) => void;
  readonly removeFavorite: (url: string) => void;
}

export const useBrowserSitesStore = create<BrowserSitesState>()(
  persist(
    (set) => ({
      recents: [],
      favorites: [],
      visit: (site) =>
        set((state) => {
          const recents = recordRecent(state.recents, site, Date.now());
          const favorites = refreshSite(state.favorites, site);
          return recents === state.recents && favorites === state.favorites
            ? state
            : { recents, favorites };
        }),
      toggleFavorite: (site) =>
        set((state) => ({ favorites: toggleFavorite(state.favorites, site, Date.now()) })),
      removeRecent: (url) => set((state) => ({ recents: removeSite(state.recents, url) })),
      removeFavorite: (url) => set((state) => ({ favorites: removeSite(state.favorites, url) })),
    }),
    {
      name: "codeatlas:browser-sites:v1",
      version: 1,
      // Falls back to memory when localStorage is missing, full or throws.
      storage: createJSONStorage(resolveBrowserFaviconStorage),
      partialize: (state) => ({ recents: state.recents, favorites: state.favorites }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as { recents?: unknown; favorites?: unknown };
        return {
          ...current,
          recents: parseStoredSites(stored.recents, BROWSER_RECENTS_MAX),
          favorites: parseStoredSites(stored.favorites, BROWSER_FAVORITES_MAX),
        };
      },
    },
  ),
);

export function useIsFavoriteSite(url: string): boolean {
  return useBrowserSitesStore((state) => findSite(state.favorites, url) !== undefined);
}
