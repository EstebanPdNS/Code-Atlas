// @effect-diagnostics nodeBuiltinImport:off -- Electron's Notification is the native macOS notice.
import * as Electron from "electron";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ElectronShell from "../electron/ElectronShell.ts";
import * as DesktopAppIdentity from "../app/DesktopAppIdentity.ts";
import {
  CODE_ATLAS_UPSTREAM_BASE_VERSION,
  T3_CODE_RELEASES_API_URL,
  decodeUpstreamReleases,
  releaseToAnnounce,
} from "./upstreamReleases.ts";

/**
 * Code Atlas: a macOS notification when T3 Code publishes a new stable
 * release. Nothing is downloaded or installed; clicking the notice opens the
 * release on GitHub so the owner can decide what to bring into Code Atlas.
 */

const FIRST_CHECK_DELAY = Duration.seconds(30);
const CHECK_INTERVAL = Duration.hours(6);
const REQUEST_TIMEOUT = Duration.seconds(15);
const STATE_FILE = "code-atlas-upstream-release.json";

const AnnouncedState = Schema.fromJsonString(Schema.Struct({ lastAnnounced: Schema.String }));
const decodeAnnouncedState = Schema.decodeUnknownEffect(AnnouncedState);
const encodeAnnouncedState = Schema.encodeEffect(AnnouncedState);

const fetchUpstreamReleases = Effect.fn("UpstreamReleaseNotifier.fetchReleases")(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(
    HttpClientRequest.get(T3_CODE_RELEASES_API_URL).pipe(
      HttpClientRequest.setHeaders({
        Accept: "application/vnd.github+json",
        "User-Agent": "Code-Atlas",
      }),
    ),
  );
  const body = yield* HttpClientResponse.schemaBodyJson(Schema.Unknown)(
    yield* HttpClientResponse.filterStatusOk(response),
  );
  return decodeUpstreamReleases(body);
}, Effect.timeout(REQUEST_TIMEOUT));

export const checkUpstreamReleases = Effect.fn("UpstreamReleaseNotifier.check")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shell = yield* ElectronShell.ElectronShell;
  const userDataPath = yield* (yield* DesktopAppIdentity.DesktopAppIdentity).resolveUserDataPath;
  const statePath = path.join(userDataPath, STATE_FILE);
  const lastAnnounced = yield* fileSystem.readFileString(statePath).pipe(
    Effect.flatMap(decodeAnnouncedState),
    Effect.map((state) => state.lastAnnounced),
    Effect.orElseSucceed(() => null),
  );
  const release = releaseToAnnounce(yield* fetchUpstreamReleases(), {
    baseVersion: CODE_ATLAS_UPSTREAM_BASE_VERSION,
    lastAnnounced,
  });
  if (release === null || !Electron.Notification.isSupported()) return;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const notification = new Electron.Notification({
    title: `T3 Code ${release.tagName.replace(/^v/, "")} is out`,
    body: "Code Atlas did not change. Click to see what's new on GitHub.",
  });
  notification.on("click", () => {
    void runPromise(shell.openExternal(release.htmlUrl));
  });
  notification.show();
  yield* fileSystem.writeFileString(
    statePath,
    yield* encodeAnnouncedState({ lastAnnounced: release.tagName }),
  );
});

/** Checks shortly after launch and then every few hours, for the app's lifetime. */
export const startUpstreamReleaseNotifier = checkUpstreamReleases().pipe(
  Effect.catchCause((cause) =>
    Effect.logWarning("Could not check for T3 Code releases", { cause }),
  ),
  Effect.delay(FIRST_CHECK_DELAY),
  Effect.repeat(Schedule.spaced(CHECK_INTERVAL)),
  Effect.forkScoped,
  Effect.asVoid,
);
