/**
 * Code Atlas: Whisper on the Mac GPU. Runs whisper.cpp's `whisper-server`
 * (built with Metal by native/whisper-server/build.sh and shipped in the app's
 * resources) on a loopback port, so the model loads once and every phrase is a
 * local HTTP request. The vocabulary rides along as Whisper's initial prompt,
 * which is what fixes names and mixed-language jargon.
 */
import { DICTATION_SAMPLE_RATE, DictationError } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { isQuiet } from "./audio.ts";

const BINARY_NAME = "whisper-server";

/** Bundled binary first, then the dev build next to the sources. */
export function whisperServerCandidates(
  path: Path.Path,
  input: {
    readonly override: string | undefined;
    readonly resourceMonitorPath: string | undefined;
    readonly moduleDirectory: string;
  },
): readonly string[] {
  const candidates: string[] = [];
  if (input.override) candidates.push(input.override);
  // Packaged desktop: Resources/resource-monitor/<binary> → Resources/whisper-server/<binary>.
  if (input.resourceMonitorPath) {
    const resources = path.dirname(path.dirname(input.resourceMonitorPath));
    candidates.push(path.join(resources, "whisper-server", BINARY_NAME));
  }
  for (const up of ["../../../..", "../../../../..", "../../.."]) {
    candidates.push(
      path.resolve(input.moduleDirectory, up, "native/whisper-server/dist", BINARY_NAME),
    );
  }
  return candidates;
}

export const findWhisperServerBinary = Effect.fnUntraced(function* (candidates: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  for (const candidate of candidates) {
    const info = yield* fs.stat(candidate).pipe(Effect.option);
    if (Option.isSome(info) && info.value.type === "File") return Option.some(candidate);
  }
  return Option.none<string>();
});

/** 16-bit PCM WAV, the only input whisper-server accepts without ffmpeg. */
export function encodeWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++)
      view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, DICTATION_SAMPLE_RATE, true);
  view.setUint32(28, DICTATION_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

/** whisper-server writes segment line breaks raw inside JSON strings. */
export function parseWhisperResponse(body: string): { text: string; language: string | null } {
  const parsed = JSON.parse(body.replace(/[\r\n\t]+/g, " ")) as {
    readonly text?: unknown;
    readonly language?: unknown;
  };
  return {
    text: typeof parsed.text === "string" ? parsed.text.replace(/\s+/g, " ").trim() : "",
    language: typeof parsed.language === "string" ? parsed.language : null,
  };
}

const loadFailed = (message: string) => (cause: unknown) =>
  new DictationError({ reason: "load-failed", message, cause });

// Structurally a DictationRecognizer.Recognizer; importing that module here would
// create an import cycle that degrades the inferred server layer types to any.
export const loadWhisperServerRecognizer = Effect.fnUntraced(function* (input: {
  readonly binary: Option.Option<string>;
  readonly modelFile: string;
  readonly threads: number;
  readonly cleanText: (text: string) => string;
  readonly resolveLanguage: (language: string) => string;
  /** whisper-server names detected languages ("spanish"); clients need BCP 47 codes. */
  readonly languageCodes: ReadonlyMap<string, string>;
}) {
  if (Option.isNone(input.binary))
    return yield* new DictationError({
      reason: "load-failed",
      message: "This build has no whisper.cpp runtime. Rebuild Code Atlas with Metal dictation.",
    });
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const net = yield* NetService.NetService;
  const http = yield* HttpClient.HttpClient;
  const port = yield* net
    .reserveLoopbackPort()
    .pipe(Effect.mapError(loadFailed("Could not reserve a port for Whisper.")));
  const baseUrl = `http://127.0.0.1:${port}`;
  // The server owns GPU memory: it lives exactly as long as this scope.
  const scope = yield* Scope.make();
  const child = yield* spawner
    .spawn(
      ChildProcess.make(
        input.binary.value,
        [
          "-m",
          input.modelFile,
          "--host",
          "127.0.0.1",
          "--port",
          String(port),
          "-t",
          String(input.threads),
        ],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
      ),
    )
    .pipe(
      Scope.provide(scope),
      Effect.tapError(() => Scope.close(scope, Exit.void)),
      Effect.mapError(loadFailed("Could not start Whisper on the GPU.")),
    );
  // Loading the model onto the GPU takes a few seconds the first time.
  yield* Effect.gen(function* () {
    if (!(yield* child.isRunning))
      return yield* new DictationError({ reason: "load-failed", message: "Whisper exited." });
    const response = yield* http.get(`${baseUrl}/`);
    if (response.status !== 200)
      return yield* new DictationError({ reason: "load-failed", message: "Whisper is loading." });
  }).pipe(
    Effect.retry({ schedule: Schedule.spaced("250 millis"), times: 360 }),
    Effect.tapError(() => Scope.close(scope, Exit.void)),
    Effect.mapError(loadFailed("Whisper did not finish loading on the GPU.")),
  );

  const decode = Effect.fn("Dictation.whisperMetal.decode")(function* (
    samples: Float32Array,
    language: string,
    prompt?: string,
  ) {
    const pinned = input.resolveLanguage(language);
    if (isQuiet(samples)) return { text: "", locale: pinned || "en" };
    const form = new FormData();
    form.set("file", new Blob([encodeWav(samples)], { type: "audio/wav" }), "phrase.wav");
    form.set("response_format", "verbose_json");
    form.set("temperature", "0");
    form.set("language", pinned || "auto");
    if (prompt && prompt.trim().length > 0) form.set("prompt", prompt.trim());
    const body = yield* Effect.gen(function* () {
      const response = yield* http.execute(
        HttpClientRequest.post(`${baseUrl}/inference`).pipe(HttpClientRequest.bodyFormData(form)),
      );
      if (response.status !== 200)
        return yield* new DictationError({
          reason: "transcription-failed",
          message: `Whisper answered ${response.status}.`,
        });
      return yield* response.text;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DictationError({
            reason: "transcription-failed",
            message: "Could not transcribe the recording.",
            cause,
          }),
      ),
    );
    const result = yield* Effect.try({
      try: () => parseWhisperResponse(body),
      // The body can contain transcript fragments, so keep the parse error private.
      catch: () =>
        new DictationError({
          reason: "transcription-failed",
          message: "Whisper returned an invalid result.",
        }),
    });
    const detected = result.language?.toLowerCase() ?? "";
    const locale = input.languageCodes.get(detected) ?? (detected.length === 2 ? detected : "");
    return { text: input.cleanText(result.text), locale: locale || pinned || "en" };
  });

  return {
    decode,
    release: Scope.close(scope, Exit.void),
  };
});
