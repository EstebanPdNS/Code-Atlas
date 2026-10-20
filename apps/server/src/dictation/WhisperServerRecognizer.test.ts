import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { cleanWhisperText } from "./audio.ts";
import {
  encodeWav,
  findWhisperServerBinary,
  loadWhisperServerRecognizer,
  parseWhisperResponse,
  whisperServerCandidates,
} from "./WhisperServerRecognizer.ts";

describe("whisper-server helpers", () => {
  it("encodes 16 kHz mono 16-bit PCM WAV", () => {
    const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5]));
    const view = new DataView(wav.buffer);
    assert.strictEqual(new TextDecoder().decode(wav.slice(0, 4)), "RIFF");
    assert.strictEqual(view.getUint32(24, true), 16_000);
    assert.strictEqual(view.getUint32(40, true), 8);
    assert.deepStrictEqual(
      [1, 2, 3].map((index) => view.getInt16(44 + index * 2, true)),
      [32_767, -32_768, 16_383],
    );
  });

  it("reads whisper-server JSON with raw line breaks inside strings", () => {
    const body = '{"text":" Oye, abre el worktree\n de Starwing.\n","language":"es"}';
    assert.deepStrictEqual(parseWhisperResponse(body), {
      text: "Oye, abre el worktree de Starwing.",
      language: "es",
    });
  });

  it.effect("looks for the bundled binary beside the resource monitor first", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const candidates = whisperServerCandidates(path, {
        override: undefined,
        resourceMonitorPath: "/App/Contents/Resources/resource-monitor/t3-resource-monitor",
        moduleDirectory: "/repo/apps/server/src/dictation",
      });
      assert.strictEqual(candidates[0], "/App/Contents/Resources/whisper-server/whisper-server");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});

const binary = process.env.CODE_ATLAS_WHISPER_SERVER_PATH;
const modelFile = process.env.CODE_ATLAS_WHISPER_E2E_MODEL;
const wavFile = process.env.CODE_ATLAS_WHISPER_E2E_WAV;

/** Run explicitly: needs the Metal build, the GGML model and a 16 kHz WAV. */
it.live.skipIf(!binary || !modelFile || !wavFile)(
  "transcribes mixed Spanish and English jargon on the GPU with a vocabulary prompt",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const found = yield* findWhisperServerBinary([binary!]);
      assert.isTrue(Option.isSome(found));
      const recognizer = yield* loadWhisperServerRecognizer({
        binary: found,
        modelFile: modelFile!,
        threads: 4,
        cleanText: cleanWhisperText,
        resolveLanguage: () => "",
        languageCodes: new Map([["spanish", "es"]]),
      });
      const bytes = yield* fs.readFile(wavFile!);
      const pcm = new Int16Array(bytes.buffer, bytes.byteOffset + 44, (bytes.length - 44) >> 1);
      const samples = Float32Array.from(pcm, (value) => value / 32_768);
      const result = yield* recognizer.decode(
        samples,
        "auto",
        "Starwing, 3DS, citro2d, worktree, ChatComposer",
      );
      yield* recognizer.release;
      assert.include(result.text, "Starwing");
      assert.include(result.text, "citro2d");
      assert.strictEqual(result.locale, "es");
    }).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, FetchHttpClient.layer)),
    ),
  120_000,
);
