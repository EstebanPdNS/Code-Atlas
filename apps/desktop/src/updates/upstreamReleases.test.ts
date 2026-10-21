import { describe, expect, it } from "vite-plus/test";

import {
  compareUpstreamVersions,
  decodeUpstreamReleases,
  releaseToAnnounce,
  type UpstreamRelease,
} from "./upstreamReleases.ts";

const release = (tagName: string, prerelease = false): UpstreamRelease => ({
  tagName,
  name: `T3 Code ${tagName}`,
  htmlUrl: `https://github.com/pingdotgg/t3code/releases/tag/${tagName}`,
  prerelease,
  draft: false,
});

describe("compareUpstreamVersions", () => {
  it("orders stable releases after their prereleases", () => {
    expect(compareUpstreamVersions("v0.1.1", "0.1.1-nightly.20261020.3411")).toBeGreaterThan(0);
    expect(compareUpstreamVersions("v0.1.2", "v0.1.1")).toBeGreaterThan(0);
    expect(
      compareUpstreamVersions("v0.1.1-nightly.20261020.3438", "v0.1.1-nightly.20261020.3411"),
    ).toBeGreaterThan(0);
    expect(compareUpstreamVersions("v0.1.1", "v0.1.1")).toBe(0);
  });
});

describe("releaseToAnnounce", () => {
  const base = "0.1.1-nightly.20261020.3411";
  const releases = [
    release("v0.1.2-nightly.20261021.3457", true),
    release("v0.1.1"),
    release("v0.1.1-nightly.20261020.3438", true),
    release("v0.1.0"),
  ];

  it("announces the newest stable release newer than the base", () => {
    expect(releaseToAnnounce(releases, { baseVersion: base, lastAnnounced: null })?.tagName).toBe(
      "v0.1.1",
    );
  });

  it("never announces nightly or preview builds", () => {
    expect(
      releaseToAnnounce([release("v0.2.0-nightly.1", true)], {
        baseVersion: base,
        lastAnnounced: null,
      }),
    ).toBeNull();
  });

  it("announces each release once", () => {
    expect(releaseToAnnounce(releases, { baseVersion: base, lastAnnounced: "v0.1.1" })).toBeNull();
    expect(
      releaseToAnnounce([...releases, release("v0.1.3")], {
        baseVersion: base,
        lastAnnounced: "v0.1.1",
      })?.tagName,
    ).toBe("v0.1.3");
  });
});

describe("decodeUpstreamReleases", () => {
  it("keeps the fields Code Atlas uses and skips malformed entries", () => {
    expect(
      decodeUpstreamReleases([
        { tag_name: "v0.1.1", name: "T3 Code v0.1.1", html_url: "https://x", prerelease: false },
        { name: "no tag" },
        null,
      ]),
    ).toEqual([
      {
        tagName: "v0.1.1",
        name: "T3 Code v0.1.1",
        htmlUrl: "https://x",
        prerelease: false,
        draft: false,
      },
    ]);
    expect(decodeUpstreamReleases({ message: "rate limited" })).toEqual([]);
  });
});
