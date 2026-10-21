import { describe, expect, it } from "vite-plus/test";

import { tokenTypeShares } from "./tokenTypeShares";

const segment = (label: string, value: number) => ({ label, value, color: "black" });

describe("tokenTypeShares", () => {
  it("gives each type its share of the sum, in order", () => {
    const shares = tokenTypeShares([
      segment("Input", 10),
      segment("Cache read", 70),
      segment("Cache write", 15),
      segment("Output", 5),
    ]);
    expect(shares.map(({ label, value, share }) => [label, value, share])).toEqual([
      ["Input", 10, 0.1],
      ["Cache read", 70, 0.7],
      ["Cache write", 15, 0.15],
      ["Output", 5, 0.05],
    ]);
    expect(shares[0]?.color).toBe("black");
  });

  it("leaves out types without tokens and sums the rest to one", () => {
    const shares = tokenTypeShares([
      segment("Input", 3),
      segment("Cache read", 0),
      segment("Cache write", 0),
      segment("Output", 1),
    ]);
    expect(shares.map((row) => row.label)).toEqual(["Input", "Output"]);
    expect(shares.reduce((sum, row) => sum + row.share, 0)).toBe(1);
    expect(shares[0]?.share).toBe(0.75);
  });

  it("is empty when no type has tokens", () => {
    expect(tokenTypeShares([segment("Input", 0), segment("Output", 0)])).toEqual([]);
    expect(tokenTypeShares([])).toEqual([]);
  });
});
