/**
 * Code Atlas: which T3 Code release to tell the owner about. Code Atlas never
 * updates itself from upstream; it only announces stable T3 Code releases
 * newer than the version it is built on, once each, so the owner can read
 * them on GitHub and choose what to bring in.
 */

/** The T3 Code version this Code Atlas build is based on. Update it after merging upstream. */
export const CODE_ATLAS_UPSTREAM_BASE_VERSION = "0.1.1-nightly.20261020.3411";

export const T3_CODE_RELEASES_API_URL =
  "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=30";

export interface UpstreamRelease {
  readonly tagName: string;
  readonly name: string;
  readonly htmlUrl: string;
  readonly prerelease: boolean;
  readonly draft: boolean;
}

interface ParsedVersion {
  readonly core: readonly [number, number, number];
  /** Empty for a stable release; a stable release sorts after its prereleases. */
  readonly prerelease: readonly string[];
}

export function parseUpstreamVersion(raw: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(raw.trim());
  if (match === null) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
}

/** Semver precedence: negative when `left` is older than `right`. */
export function compareUpstreamVersions(left: string, right: string): number {
  const a = parseUpstreamVersion(left);
  const b = parseUpstreamVersion(right);
  if (a === null || b === null) return 0;
  for (let index = 0; index < 3; index += 1) {
    const delta = a.core[index]! - b.core[index]!;
    if (delta !== 0) return delta;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumber = /^\d+$/.test(x) ? Number(x) : null;
    const yNumber = /^\d+$/.test(y) ? Number(y) : null;
    if (xNumber !== null && yNumber !== null) {
      if (xNumber !== yNumber) return xNumber - yNumber;
    } else if (xNumber !== null) {
      return -1;
    } else if (yNumber !== null) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The newest stable release worth announcing: newer than the base version and
 * than the last release already announced. Nightly and preview builds never count.
 */
export function releaseToAnnounce(
  releases: readonly UpstreamRelease[],
  options: { readonly baseVersion: string; readonly lastAnnounced: string | null },
): UpstreamRelease | null {
  let best: UpstreamRelease | null = null;
  for (const release of releases) {
    if (release.prerelease || release.draft) continue;
    if (parseUpstreamVersion(release.tagName) === null) continue;
    if (compareUpstreamVersions(release.tagName, options.baseVersion) <= 0) continue;
    if (
      options.lastAnnounced !== null &&
      compareUpstreamVersions(release.tagName, options.lastAnnounced) <= 0
    ) {
      continue;
    }
    if (best === null || compareUpstreamVersions(release.tagName, best.tagName) > 0) {
      best = release;
    }
  }
  return best;
}

/** Reads GitHub's release list, keeping only the fields Code Atlas uses. */
export function decodeUpstreamReleases(json: unknown): UpstreamRelease[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.tag_name !== "string" || typeof record.html_url !== "string") return [];
    return [
      {
        tagName: record.tag_name,
        name:
          typeof record.name === "string" && record.name.length > 0 ? record.name : record.tag_name,
        htmlUrl: record.html_url,
        prerelease: record.prerelease === true,
        draft: record.draft === true,
      },
    ];
  });
}
