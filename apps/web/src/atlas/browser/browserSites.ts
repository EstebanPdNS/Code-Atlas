/**
 * Code Atlas new-tab sites: the Recents and Favorites lists the in-app
 * browser's new tab shows. Both are per client (localStorage), not per project:
 * a site visited in one thread is a recent everywhere.
 *
 * Only http(s) pages are kept, and never a URL that carries a credential: the
 * T3 pairing link (`/pair#token=...`), OAuth callbacks, signed links and any
 * query or hash parameter that looks like a token are dropped whole rather
 * than trimmed, because a trimmed magic link is a broken tile anyway.
 */

export interface BrowserSite {
  readonly url: string;
  readonly title?: string;
  /** A small PNG data URL the in-app browser captured for this site. */
  readonly favicon?: string;
  readonly savedAt: number;
}

export interface BrowserSiteInput {
  readonly url: string;
  readonly title?: string | null | undefined;
  readonly favicon?: string | null | undefined;
}

export const BROWSER_RECENTS_MAX = 8;
export const BROWSER_FAVORITES_MAX = 48;
const URL_MAX_LENGTH = 2048;
const TITLE_MAX_LENGTH = 200;
const FAVICON_MAX_LENGTH = 8192;

const TOKEN_PARAM_NAMES = new Set([
  "auth",
  "authorization",
  "code",
  "jwt",
  "key",
  "nonce",
  "otp",
  "pairing",
  "pass",
  "pwd",
  "sid",
  "sig",
  "state",
  "ticket",
]);
const TOKEN_PARAM_PARTS = [
  "apikey",
  "credential",
  "password",
  "secret",
  "session",
  "signature",
  "token",
];
const TOKEN_VALUE = /^[\w.~+/=-]{32,}$/;

function looksLikeTokenParam(name: string, value: string): boolean {
  const normalized = name.toLowerCase().replace(/[-_]/g, "");
  if (TOKEN_PARAM_NAMES.has(normalized)) return true;
  if (TOKEN_PARAM_PARTS.some((part) => normalized.includes(part))) return true;
  if (normalized.startsWith("xamz") || normalized.startsWith("xgoog")) return true;
  return TOKEN_VALUE.test(value) && /\d/.test(value) && /[a-z]/i.test(value);
}

function hasTokenParams(params: URLSearchParams): boolean {
  for (const [name, value] of params) {
    if (looksLikeTokenParam(name, value)) return true;
  }
  return false;
}

/** The URL to keep for a page, or null when it must not be stored. */
export function sanitizeSiteUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.pathname === "/pair" || parsed.pathname.startsWith("/oauth")) return null;
  if (hasTokenParams(parsed.searchParams)) return null;
  const hash = parsed.hash.slice(1);
  if (hash.includes("=") && hasTokenParams(new URLSearchParams(hash.replace(/^[/!?]+/, "")))) {
    return null;
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.href.length > URL_MAX_LENGTH ? null : parsed.href;
}

/** Two URLs are the same site tile when only their hash or a trailing slash differ. */
export function siteKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function cleanTitle(title: string | null | undefined): string | undefined {
  const trimmed = title?.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, TITLE_MAX_LENGTH) : undefined;
}

function cleanFavicon(favicon: string | null | undefined): string | undefined {
  return favicon && favicon.startsWith("data:image/") && favicon.length <= FAVICON_MAX_LENGTH
    ? favicon
    : undefined;
}

function buildSite(
  url: string,
  input: BrowserSiteInput,
  savedAt: number,
  existing?: BrowserSite,
): BrowserSite {
  const title = cleanTitle(input.title) ?? existing?.title;
  const favicon = cleanFavicon(input.favicon) ?? existing?.favicon;
  return {
    url,
    savedAt,
    ...(title ? { title } : {}),
    ...(favicon ? { favicon } : {}),
  };
}

function sameSite(left: BrowserSite, right: BrowserSite): boolean {
  return left.url === right.url && left.title === right.title && left.favicon === right.favicon;
}

export function findSite(sites: ReadonlyArray<BrowserSite>, url: string): BrowserSite | undefined {
  const key = siteKey(url);
  return sites.find((site) => siteKey(site.url) === key);
}

/** A visit moves the page to the front of Recents, keeping what is already known about it. */
export function recordRecent(
  recents: ReadonlyArray<BrowserSite>,
  input: BrowserSiteInput,
  now: number,
): ReadonlyArray<BrowserSite> {
  const url = sanitizeSiteUrl(input.url);
  if (!url) return recents;
  const key = siteKey(url);
  const existing = recents.find((site) => siteKey(site.url) === key);
  const next = buildSite(url, input, now, existing);
  const first = recents[0];
  if (first && siteKey(first.url) === key && sameSite(first, next)) return recents;
  return [next, ...recents.filter((site) => siteKey(site.url) !== key)].slice(
    0,
    BROWSER_RECENTS_MAX,
  );
}

/** Fills in a saved site's title and icon once the page reports them, without reordering. */
export function refreshSite(
  sites: ReadonlyArray<BrowserSite>,
  input: BrowserSiteInput,
): ReadonlyArray<BrowserSite> {
  const url = sanitizeSiteUrl(input.url);
  if (!url) return sites;
  const key = siteKey(url);
  const index = sites.findIndex((site) => siteKey(site.url) === key);
  const existing = sites[index];
  if (!existing) return sites;
  const next = buildSite(existing.url, input, existing.savedAt, existing);
  return sameSite(existing, next) ? sites : sites.with(index, next);
}

export function removeSite(
  sites: ReadonlyArray<BrowserSite>,
  url: string,
): ReadonlyArray<BrowserSite> {
  const key = siteKey(url);
  const next = sites.filter((site) => siteKey(site.url) !== key);
  return next.length === sites.length ? sites : next;
}

/** Adds the page to the end of Favorites, or removes it when it is already there. */
export function toggleFavorite(
  favorites: ReadonlyArray<BrowserSite>,
  input: BrowserSiteInput,
  now: number,
): ReadonlyArray<BrowserSite> {
  if (findSite(favorites, input.url)) return removeSite(favorites, input.url);
  const url = sanitizeSiteUrl(input.url);
  if (!url || favorites.length >= BROWSER_FAVORITES_MAX) return favorites;
  return [...favorites, buildSite(url, input, now)];
}

export function siteHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function siteLabel(site: Pick<BrowserSite, "url" | "title">): string {
  return site.title ?? siteHost(site.url);
}

/** The letter on a tile whose icon could not load. */
export function siteInitial(url: string): string {
  return (
    siteHost(url)
      .match(/[a-z0-9]/i)?.[0]
      ?.toUpperCase() ?? "?"
  );
}

/** The site's own `/favicon.ico`, tried after any icon the in-app browser captured. */
export function siteFaviconFallbackUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? `${parsed.origin}/favicon.ico`
      : null;
  } catch {
    return null;
  }
}

/** Reads a stored list back, dropping anything malformed or no longer storable. */
export function parseStoredSites(value: unknown, max: number): ReadonlyArray<BrowserSite> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sites: BrowserSite[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const { url, title, favicon, savedAt } = candidate as Record<string, unknown>;
    if (typeof url !== "string" || typeof savedAt !== "number" || !Number.isFinite(savedAt)) {
      continue;
    }
    const clean = sanitizeSiteUrl(url);
    if (!clean || seen.has(siteKey(clean))) continue;
    seen.add(siteKey(clean));
    sites.push(
      buildSite(
        clean,
        {
          url: clean,
          title: typeof title === "string" ? title : null,
          favicon: typeof favicon === "string" ? favicon : null,
        },
        savedAt,
      ),
    );
    if (sites.length >= max) break;
  }
  return sites;
}
