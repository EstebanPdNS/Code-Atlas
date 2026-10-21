import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { countLocalRunningAgents } from "./runningAgents";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;

describe("countLocalRunningAgents", () => {
  it("counts working and waiting threads of the local environment only", () => {
    expect(
      countLocalRunningAgents(
        [
          { environmentId: local, status: "working" },
          { environmentId: local, status: "waiting" },
          { environmentId: local, status: "ready" },
          { environmentId: remote, status: "working" },
        ],
        local,
      ),
    ).toBe(2);
  });

  it("counts nothing before the local environment is known", () => {
    expect(countLocalRunningAgents([{ environmentId: local, status: "working" }], null)).toBe(0);
  });
});
