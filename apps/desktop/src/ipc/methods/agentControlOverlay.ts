import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import { makeAgentControlOverlay } from "../../window/AgentControlOverlay.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_AGENT_CONTROL_OVERLAY_CHANNEL } from "../channels.ts";

const BoundedString = (max: number) => Schema.String.check(Schema.isMaxLength(max));

const AgentControlTarget = Schema.NullOr(
  Schema.Struct({
    key: BoundedString(1024).check(Schema.isMinLength(1)),
    apps: Schema.Array(BoundedString(512).check(Schema.isMinLength(1))).check(
      Schema.isMaxLength(8),
    ),
    hint: Schema.NullOr(BoundedString(4096)),
    agent: BoundedString(80),
    running: Schema.Boolean,
    startedAt: BoundedString(64),
    actionAt: BoundedString(64),
  }),
);

/** Code Atlas: the renderer names the app an agent is driving; macOS frames its window. */
export const installAgentControlOverlay = Effect.fn("desktop.ipc.installAgentControlOverlay")(
  function* () {
    const ipc = yield* DesktopIpc.DesktopIpc;
    const platform = yield* HostProcess.Platform;
    const overlay = makeAgentControlOverlay(platform === "darwin");
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: SET_AGENT_CONTROL_OVERLAY_CHANNEL,
        payload: AgentControlTarget,
        result: Schema.Void,
        handler: (target, event) => Effect.sync(() => overlay.set(target, event?.sender.id)),
      }),
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => overlay.set(null)));
  },
);
