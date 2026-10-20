import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as Path from "effect/Path";
import {
  DictationError,
  DICTATION_SAMPLE_RATE,
  type DictationFinishResult,
  type DictationModelId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { isQuiet } from "./audio.ts";
import { models, resolveLanguage } from "./models.ts";
import * as DictationArtifacts from "./DictationArtifacts.ts";
import * as ServerConfig from "../config.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import { ChildProcessSpawner } from "effect/process";
import {
  findWhisperServerBinary,
  loadWhisperServerRecognizer,
  whisperServerCandidates,
} from "./WhisperServerRecognizer.ts";

interface OfflineConfig {
  featConfig: { sampleRate: number; featureDim: number };
  modelConfig: ReturnType<(typeof models)[DictationModelId]["modelConfig"]> & {
    numThreads: number;
    provider: "cpu";
    debug: number;
  };
}

interface NativeAddon {
  createOfflineRecognizerAsync(config: OfflineConfig): Promise<unknown>;
  offlineRecognizerSetConfig(handle: unknown, config: OfflineConfig): void;
  createOfflineStream(handle: unknown): unknown;
  acceptWaveformOffline(
    stream: unknown,
    waveform: { samples: Float32Array; sampleRate: number },
  ): void;
  decodeOfflineStreamAsync(handle: unknown, stream: unknown): Promise<unknown>;
  getOfflineStreamResultAsJson(stream: unknown): string;
}

const Result = Schema.fromJsonString(
  Schema.Struct({ text: Schema.String, lang: Schema.optionalKey(Schema.String) }),
);

const decodeResult = Schema.decodeEffect(Result);

export interface Recognizer {
  readonly decode: (
    samples: Float32Array,
    language: string,
    /** Vocabulary for models that take an initial prompt; others ignore it. */
    prompt?: string,
  ) => Effect.Effect<DictationFinishResult, DictationError>;
  /** Drop the N-API external handle; its native finalizer owns freeing model memory. */
  readonly release: Effect.Effect<void>;
}

export class DictationRecognizer extends Context.Service<
  DictationRecognizer,
  {
    readonly load: (
      model: DictationModelId,
      language: string,
    ) => Effect.Effect<Recognizer, DictationError>;
  }
>()("t3/dictation/DictationRecognizer") {}

const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const artifacts = yield* DictationArtifacts.DictationArtifacts;
  const config = yield* ServerConfig.ServerConfig;
  const environment = yield* HostProcess.Environment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const net = yield* NetService.NetService;
  const http = yield* HttpClient.HttpClient;
  const load = Effect.fnUntraced(function* (model: DictationModelId, language: string) {
    const locations = artifacts.paths(model);
    const definition = models[model];
    if ("backend" in definition && definition.backend === "whisper-server") {
      const file = definition.files[0];
      const binary = yield* findWhisperServerBinary(
        whisperServerCandidates(path, {
          override: environment.CODE_ATLAS_WHISPER_SERVER_PATH,
          resourceMonitorPath: config.resourceMonitorPath,
          moduleDirectory: import.meta.dirname,
        }),
      ).pipe(Effect.provideService(FileSystem.FileSystem, fs));
      return yield* loadWhisperServerRecognizer({
        binary,
        modelFile: path.join(locations.model, file?.name ?? ""),
        threads: Math.min(8, Math.max(2, NodeOS.availableParallelism() - 2)),
        cleanText: definition.cleanText,
        resolveLanguage: (requested) => resolveLanguage(model, requested),
        languageCodes: new Map(
          definition.languageOptions.map((option) => [option.label.toLowerCase(), option.code]),
        ),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(NetService.NetService, net),
        Effect.provideService(HttpClient.HttpClient, http),
      );
    }
    const addon = yield* Effect.try({
      // The pinned addon is the native boundary, with only the methods used here typed locally.
      try: () =>
        NodeModule.createRequire(import.meta.url)(
          path.join(locations.runtime, "sherpa-onnx.node"),
        ) as NativeAddon,
      catch: (cause) =>
        new DictationError({
          reason: "load-failed",
          message: "Could not load the dictation runtime.",
          cause,
        }),
    });
    let currentLanguage = resolveLanguage(model, language);
    const configFor = (language: string): OfflineConfig => ({
      featConfig: { sampleRate: DICTATION_SAMPLE_RATE, featureDim: models[model].featureDim },
      modelConfig: {
        ...models[model].modelConfig((name) => path.join(locations.model, name), language),
        numThreads: Math.min(8, Math.max(1, NodeOS.availableParallelism())),
        provider: "cpu",
        debug: 0,
      },
    });
    let handle: unknown = yield* Effect.tryPromise({
      try: () => addon.createOfflineRecognizerAsync(configFor(currentLanguage)),
      catch: (cause) =>
        new DictationError({
          reason: "load-failed",
          message: "Could not load the dictation model.",
          cause,
        }),
    });
    const decode = (samples: Float32Array, language: string) =>
      Effect.gen(function* () {
        const pinnedLanguage = resolveLanguage(model, language);
        if (models[model].skipSilence && isQuiet(samples))
          return { text: "", locale: pinnedLanguage || "en" };
        const json = yield* Effect.tryPromise({
          try: async () => {
            if (pinnedLanguage !== currentLanguage) {
              addon.offlineRecognizerSetConfig(handle, configFor(pinnedLanguage));
              currentLanguage = pinnedLanguage;
            }
            const stream = addon.createOfflineStream(handle);
            addon.acceptWaveformOffline(stream, { samples, sampleRate: DICTATION_SAMPLE_RATE });
            await addon.decodeOfflineStreamAsync(handle, stream);
            return addon.getOfflineStreamResultAsJson(stream);
          },
          catch: (cause) =>
            new DictationError({
              reason: "transcription-failed",
              message: "Could not transcribe the recording.",
              cause,
            }),
        });
        const result = yield* decodeResult(json).pipe(
          // Schema failures can contain transcript fragments, so keep this domain validation error private.
          Effect.mapError(
            () =>
              new DictationError({
                reason: "transcription-failed",
                message: "The dictation runtime returned an invalid result.",
              }),
          ),
        );
        return {
          text: models[model].cleanText(result.text),
          locale: result.lang || pinnedLanguage || "en",
        };
      });
    return {
      decode,
      release: Effect.sync(() => {
        handle = null;
      }),
    } satisfies Recognizer;
  });
  return DictationRecognizer.of({ load });
});

export const layer = Layer.effect(DictationRecognizer, make);
