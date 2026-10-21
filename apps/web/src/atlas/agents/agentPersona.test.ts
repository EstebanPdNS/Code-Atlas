import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_NAMES,
  agentPersona,
  agentPersonaHeadline,
  atlasSubagentOrder,
} from "./agentPersona";

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
  it("orders agents by id, whatever order they arrive in", () => {
    expect(atlasSubagentOrder([{ id: "c" }, { id: "a" }, { id: "b" }])).toBe("a\nb\nc");
  });

  it("keeps every agent's name when a start time arrives", () => {
    const before = [
      { id: "node:b", startedAt: null },
      { id: "node:a", startedAt: null },
    ];
    const after = [
      { id: "node:b", startedAt: "2026-10-20T00:00:01Z" },
      { id: "node:a", startedAt: "2026-10-20T00:00:02Z" },
    ];
    const names = (agents: typeof before | typeof after) => {
      const order = atlasSubagentOrder(agents).split("\n");
      return agents.map((agent) => agentPersona(agent.id, order).name);
    };
    expect(names(after)).toEqual(names(before));
  });
});

describe("agentPersonaHeadline", () => {
  it("says what the agent is doing", () => {
    expect(agentPersonaHeadline("Ronny", "running")).toBe("Ronny is working on:");
    expect(agentPersonaHeadline("Ronny", "completed")).toBe("Ronny finished:");
    expect(agentPersonaHeadline("Ronny", "interrupted")).toBe("Ronny stopped:");
  });
});
