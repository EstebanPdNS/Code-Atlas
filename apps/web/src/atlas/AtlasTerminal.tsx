import { RotateCwIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { useLocalStorage } from "~/hooks/useLocalStorage";

import auroraUrl from "./aurora.mp3";

// The Code Atlas handbook's neofetch-style identity screen: a folded map next
// to "CODE ATLAS". Each map row is split into three tones of orange.
const MAP_ROWS: readonly (readonly [string, string, string])[] = [
  ["      ##", "#        ", "      ##"],
  ["    ## #", " ###     ", "    ####"],
  ["  ##   #", "    ###  ", " ###  ##"],
  ["##     #", "       ##", "#     ##"],
  ["##     #", "        #", "      ##"],
  ["##     #", " ##   ## ", "      ##"],
  ["##      ", "##     ##", "      ##"],
  ["##     ", "##       ##", "     ##"],
  ["##      ", "##     ##", "      ##"],
  ["##     #", " ##   ###", "      ##"],
  ["##     #", "        #", "      ##"],
  ["##    ##", "#       #", "      ##"],
  ["##  ##  ", " ###    #", "    ##  "],
  ["####    ", "    ### #", " ###    "],
  ["##      ", "       ##", "#       "],
];

const WORD_CODE = [
  " ######   #####   ######   #######",
  "##       ##   ##  ##   ##  ##     ",
  "##       ##   ##  ##   ##  ##     ",
  "##       ##   ##  ##   ##  ###### ",
  "##       ##   ##  ##   ##  ##     ",
  "##       ##   ##  ##   ##  ##     ",
  " ######   #####   ######   #######",
];

const WORD_ATLAS = [
  " ####  ###### ##      ####   #####",
  "##  ##   ##   ##     ##  ## ##    ",
  "##  ##   ##   ##     ##  ## ##    ",
  "######   ##   ##     ######  #### ",
  "##  ##   ##   ##     ##  ##     ##",
  "##  ##   ##   ##     ##  ##     ##",
  "##  ##   ##   ###### ##  ## ##### ",
];

// Title lines share the map's row grid: CODE, a blank row, ATLAS.
const TITLE_ROWS: readonly { readonly text: string; readonly tone: 0 | 1 }[] = [
  ...WORD_CODE.map((text) => ({ text, tone: 0 as const })),
  { text: "", tone: 0 },
  ...WORD_ATLAS.map((text) => ({ text, tone: 1 as const })),
];

const TOTAL_ROWS = MAP_ROWS.length;
const SOUND_STORAGE_KEY = "codeatlas:startup-sound";

type Phase = "idle" | "typing" | "logo" | "done";

// The intro plays once per app launch; later drafts show the landed screen.
let introPlayedThisLaunch = false;

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export interface AtlasTerminalProps {
  readonly projectName: string | null;
}

export function AtlasTerminal({ projectName }: AtlasTerminalProps) {
  const command = `atlas --open ${slugify(projectName ?? "workspace")}`;
  const [soundEnabled, setSoundEnabled] = useLocalStorage(SOUND_STORAGE_KEY, true, Schema.Boolean);
  const [run, setRun] = useState(() => (introPlayedThisLaunch ? 0 : 1));
  const [phase, setPhase] = useState<Phase>(introPlayedThisLaunch ? "done" : "idle");
  const [typed, setTyped] = useState(introPlayedThisLaunch ? command.length : 0);
  const [rows, setRows] = useState(introPlayedThisLaunch ? TOTAL_ROWS : 0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  useEffect(() => {
    if (run === 0) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    introPlayedThisLaunch = true;
    if (reducedMotion) {
      setPhase("done");
      setTyped(Number.MAX_SAFE_INTEGER);
      setRows(TOTAL_ROWS);
      return;
    }
    const timers: number[] = [];
    const later = (fn: () => void, delay: number) => {
      timers.push(window.setTimeout(fn, delay));
    };
    let position = 0;
    let revealed = 0;
    setPhase("typing");
    setTyped(0);
    setRows(0);
    const revealRows = () => {
      revealed = Math.min(TOTAL_ROWS, revealed + randomBetween(2, 4));
      setRows(revealed);
      if (revealed < TOTAL_ROWS) later(revealRows, randomBetween(300, 600) / 2.2);
      else later(() => setPhase("done"), 220);
    };
    const startLogo = () => {
      setPhase("logo");
      if (soundEnabledRef.current) {
        const audio = audioRef.current ?? new Audio(auroraUrl);
        audioRef.current = audio;
        audio.currentTime = 0;
        // Autoplay can be refused in a plain browser tab; the logo plays anyway.
        void audio.play().catch(() => undefined);
      }
      revealRows();
    };
    const typeNext = () => {
      position += 1;
      setTyped(position);
      if (position < command.length) later(typeNext, randomBetween(45, 140) / 2.55);
      else later(startLogo, 180);
    };
    later(typeNext, 650);
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      audioRef.current?.pause();
    };
    // The command only seeds a run; renaming the project mid-intro must not restart it.
  }, [run]);

  const booting = phase === "idle" || phase === "typing";
  const shownCommand = command.slice(0, typed);

  return (
    <section
      data-atlas-terminal
      data-phase={phase}
      aria-label="Code Atlas"
      className="mx-auto w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg/5"
    >
      <div className="relative flex h-9 items-center justify-center border-b border-border bg-muted px-20">
        <span aria-hidden className="absolute left-3.5 flex items-center gap-1.5">
          <span data-atlas-light="close" />
          <span data-atlas-light="minimize" />
          <span data-atlas-light="maximize" />
        </span>
        <span className="truncate font-mono text-2xs text-muted-foreground">
          code-atlas — terminal
        </span>
        <span className="absolute right-1.5 flex items-center">
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={soundEnabled ? "Mute startup sound" : "Enable startup sound"}
            aria-pressed={soundEnabled}
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (!next) audioRef.current?.pause();
            }}
          >
            {soundEnabled ? <Volume2Icon /> : <VolumeXIcon />}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Replay the Code Atlas intro"
            disabled={phase !== "done"}
            onClick={() => setRun((value) => value + 1)}
          >
            <RotateCwIcon />
          </Button>
        </span>
      </div>
      <div className="px-5 py-4 font-mono">
        <p aria-hidden className="text-xs">
          <span className="text-primary">~/code_atlas/</span>
          <span className="mx-1.5 text-muted-foreground">&gt;</span>
          <span>{shownCommand}</span>
          {booting ? <span data-atlas-caret /> : null}
        </p>
        <div aria-hidden data-atlas-art className="my-4">
          <pre data-atlas-ascii>
            {MAP_ROWS.map((segments, index) => (
              <span key={index} data-atlas-row data-hidden={index >= rows || undefined}>
                <span data-tone="0">{segments[0]}</span>
                <span data-tone="1">{segments[1]}</span>
                <span data-tone="2">{segments[2]}</span>
                {"\n"}
              </span>
            ))}
          </pre>
          <pre data-atlas-ascii>
            {TITLE_ROWS.map((row, index) => (
              <span
                key={index}
                data-atlas-row
                data-tone={row.tone}
                data-hidden={index >= rows || undefined}
              >
                {row.text}
                {"\n"}
              </span>
            ))}
          </pre>
        </div>
        <div data-atlas-reveal={phase === "done" ? "on" : "off"}>
          <dl className="grid gap-y-0.5 border-t border-border pt-3 text-2xs leading-relaxed">
            <div className="grid grid-cols-[8ch_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-primary">Project</dt>
              <dd className="truncate text-muted-foreground">{projectName ?? "No project"}</dd>
            </div>
            <div className="grid grid-cols-[8ch_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-primary">Agents</dt>
              <dd className="text-muted-foreground">Claude Code · Codex · your subscriptions</dd>
            </div>
            <div className="grid grid-cols-[8ch_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-primary">Mission</dt>
              <dd className="text-muted-foreground">Improve. Preserve. Verify.</dd>
            </div>
          </dl>
          <div aria-hidden data-atlas-palette className="mt-3">
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} />
            ))}
          </div>
          <p className="mt-3 text-2xs text-muted-foreground">
            <span className="text-primary">[ready]</span> workspace loaded · describe your next task
            below
          </p>
        </div>
      </div>
    </section>
  );
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "workspace";
}
