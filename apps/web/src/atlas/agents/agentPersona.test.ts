import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { AGENT_NAMES, agentPersona, agentPersonaHeadline, atlasSubagentOrder } from "./agentPersona";

describe("agentPersona", () => {
  it("gives an agent the same name and face every time", () => {
    expect(agentPersona("node:agent-1")).toEqual(agentPersona("node:agent-1"));
    expect(AGENT_NAMES).toContain(agentPersona("node:agent-1").name);
  });

  it("gives the agents of one thread different names", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `node:agent-${index}`);
    const names = ids.map((id) => agentPersona(id, ids).name);
    expect(new Set(names).size).toBe(ids.length);
  });

  it("keeps earlier agents' names when a later agent joins", () => {
    const first = ["node:a", "node:b"];
    const later = [...first, "node:c"];
    expect(agentPersona("node:b", first).name).toBe(agentPersona("node:b", later).name);
  });
});

describe("atlasSubagentOrder", () => {
  it("lists agents oldest first, unstarted last", () => {
    const at = (ms: number) => DateTime.makeUnsafe(ms);
    expect(
      atlasSubagentOrder([
        { id: "c", startedAt: null },
        { id: "b", startedAt: at(2000) },
        { id: "a", startedAt: at(1000) },
      ]),
    ).toBe("a\nb\nc");
  });
});

describe("agentPersonaHeadline", () => {
  it("says what the agent is doing", () => {
    expect(agentPersonaHeadline("Ronny", "running")).toBe("Ronny is working on:");
    expect(agentPersonaHeadline("Ronny", "completed")).toBe("Ronny finished:");
    expect(agentPersonaHeadline("Ronny", "interrupted")).toBe("Ronny stopped:");
  });
});
