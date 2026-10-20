import { RotateCwIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { Schema } from "effect";
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";

import { Button } from "~/components/ui/button";
import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import auroraUrl from "./aurora.mp3";
import {
  ATLAS_SOUND_STORAGE_KEY,
  publishAtlasTerminalMeta,
  replayAtlasIntro,
  setAtlasIntroStatus,
  slugifyAtlasCommand,
  useAtlasIntroStatus,
  useAtlasTerminalMeta,
  type AtlasTerminalMeta,
} from "./atlasIntro";

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
const TITLE_ROWS: readonly { readonly key: string; readonly text: string; readonly tone: 0 | 1 }[] =
  [
    ...WORD_CODE.map((text, index) => ({ key: `code-${index}`, text, tone: 0 as const })),
    { key: "gap", text: "", tone: 0 },
    ...WORD_ATLAS.map((text, index) => ({ key: `atlas-${index}`, text, tone: 1 as const })),
  ];

const MAP_ROW_KEYS = MAP_ROWS.map((_, index) => `map-${index}`);
const PALETTE_KEYS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
const TOTAL_ROWS = MAP_ROWS.length;

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

interface AtlasTerminalFrameProps {
  readonly meta: AtlasTerminalMeta;
  readonly typed: number;
  readonly rows: number;
  /** Titlebar, metadata and the ready line; hidden while the intro types. */
  readonly chromeVisible: boolean;
  readonly caret: boolean;
  readonly controls?: React.ReactNode;
  readonly frameRef?: Ref<HTMLElement>;
  readonly commandRef?: Ref<HTMLParagraphElement>;
  readonly artRef?: Ref<HTMLDivElement>;
  readonly className?: string;
  readonly hidden?: boolean;
}

function AtlasTerminalFrame({ frameRef, commandRef, artRef, ...props }: AtlasTerminalFrameProps) {
  const { meta } = props;
  const command = slugifyAtlasCommand(meta.projectName);
  return (
    <section
      ref={frameRef}
      data-atlas-terminal
      data-atlas-chrome={props.chromeVisible ? "on" : "off"}
      aria-label="Code Atlas"
      aria-hidden={props.hidden || undefined}
      className={cn(
        "w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground",
        props.className,
      )}
    >
      <div
        data-atlas-reveal
        className="relative flex h-9 items-center justify-center border-b border-border bg-muted px-20"
      >
        <span aria-hidden className="absolute left-3.5 flex items-center gap-1.5">
          <span data-atlas-light="close" />
          <span data-atlas-light="minimize" />
          <span data-atlas-light="maximize" />
        </span>
        <span className="truncate font-mono text-2xs text-muted-foreground">
          code-atlas — terminal
        </span>
        {props.controls ? (
          <span className="absolute right-1.5 flex items-center">{props.controls}</span>
        ) : null}
      </div>
      <div className="px-5 py-4 font-mono">
        <p ref={commandRef} aria-hidden className="w-fit text-xs">
          <span className="text-primary">~/code_atlas/</span>
          <span className="mx-1.5 text-muted-foreground">&gt;</span>
          <span>{command.slice(0, props.typed)}</span>
          {props.caret ? <span data-atlas-caret /> : null}
        </p>
        <div ref={artRef} aria-hidden data-atlas-art className="my-4 w-fit">
          <pre data-atlas-ascii>
            {MAP_ROWS.map((segments, index) => (
              <span
                key={MAP_ROW_KEYS[index]}
                data-atlas-row
                data-hidden={index >= props.rows || undefined}
              >
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
                key={row.key}
                data-atlas-row
                data-tone={row.tone}
                data-hidden={index >= props.rows || undefined}
              >
                {row.text}
                {"\n"}
              </span>
            ))}
          </pre>
        </div>
        <div data-atlas-reveal>
          <dl className="grid gap-y-0.5 border-t border-border pt-3 text-2xs leading-relaxed">
            <div className="grid grid-cols-[8ch_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-primary">Project</dt>
              <dd className="truncate text-foreground">{meta.projectName ?? "No project"}</dd>
            </div>
            <div className="grid grid-cols-[8ch_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-primary">Agents</dt>
              <dd className="text-muted-foreground">
                {meta.agents.length > 0 ? meta.agents.join(" · ") : "Claude Code · Codex"}
              </dd>
            </div>
            <div className="grid grid-cols-[8ch_minmax(0,1fr)] gap-3">
              <dt className="font-semibold text-primary">Usage</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                {meta.usage.length === 0 ? <span>No usage data yet</span> : null}
                {meta.usage.map((entry) => (
                  <span key={entry.label} className="inline-flex items-center gap-1.5">
                    {entry.label}
                    <span data-atlas-meter aria-hidden>
                      <span style={{ width: `${entry.percent ?? 0}%` }} />
                    </span>
                    <strong className="font-medium text-foreground tabular-nums">
                      {entry.percent === null ? "—" : `${Math.round(entry.percent)}%`}
                    </strong>
                  </span>
                ))}
              </dd>
            </div>
          </dl>
          <div aria-hidden data-atlas-palette className="mt-3">
            {PALETTE_KEYS.map((key) => (
              <span key={key} />
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

/** Keeps the launch intro's project, agents and usage current on every thread. */
export function AtlasTerminalMetaPublisher({ meta }: { readonly meta: AtlasTerminalMeta }) {
  useEffect(() => {
    publishAtlasTerminalMeta(meta);
  }, [meta]);
  return null;
}

/**
 * The landed terminal above the new-thread composer. It publishes the
 * project, agents and usage the launch intro shows, and hides while the
 * intro's camera flies into its slot.
 */
export function AtlasTerminal({ meta }: { readonly meta: AtlasTerminalMeta }) {
  const status = useAtlasIntroStatus();
  const [soundEnabled, setSoundEnabled] = useLocalStorage(
    ATLAS_SOUND_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  useEffect(() => {
    publishAtlasTerminalMeta(meta);
  }, [meta]);
  const command = slugifyAtlasCommand(meta.projectName);
  return (
    <AtlasTerminalFrame
      meta={meta}
      typed={command.length}
      rows={TOTAL_ROWS}
      chromeVisible
      caret={false}
      hidden={status !== "done"}
      className={cn("mx-auto max-w-176 shadow-lg/5", status !== "done" && "invisible")}
      controls={
        <>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={soundEnabled ? "Mute startup sound" : "Enable startup sound"}
            aria-pressed={soundEnabled}
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled ? <Volume2Icon /> : <VolumeXIcon />}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Replay the Code Atlas intro"
            disabled={status !== "done"}
            onClick={replayAtlasIntro}
          >
            <RotateCwIcon />
          </Button>
        </>
      }
    />
  );
}

type IntroPhase = "typing" | "logo" | "zoom" | "reveal";

function findLandedTerminal(): Element | null {
  for (const element of document.querySelectorAll("[data-atlas-terminal]")) {
    if (!element.closest("[data-atlas-intro-overlay]")) return element;
  }
  return null;
}

/**
 * Fullscreen launch intro, like the handbook site: the terminal fills the
 * window, the command types in the corner, the logo loads with the Aurora
 * cue, then the camera zooms out into the terminal above the composer (or a
 * centred window when no new thread is open) and the app appears.
 */
export function AtlasLaunchIntro() {
  const status = useAtlasIntroStatus();
  const meta = useAtlasTerminalMeta();
  useEffect(() => {
    if (status !== "pending") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || typeof Element.prototype.animate !== "function") {
      setAtlasIntroStatus("done");
      return;
    }
    setAtlasIntroStatus("playing");
  }, [status]);
  if (status !== "playing") return null;
  return createPortal(<AtlasLaunchIntroScene meta={meta} />, document.body);
}

function AtlasLaunchIntroScene({ meta }: { readonly meta: AtlasTerminalMeta }) {
  // Fixed for the run: a project rename mid-intro must not restart the typing.
  const [command] = useState(() => slugifyAtlasCommand(meta.projectName));
  const [typed, setTyped] = useState(0);
  const [rows, setRows] = useState(0);
  const [phase, setPhase] = useState<IntroPhase>("typing");
  const [width] = useState(() => {
    const rect = findLandedTerminal()?.getBoundingClientRect();
    return rect && rect.width > 0 ? rect.width : Math.min(704, window.innerWidth - 64);
  });
  const overlayRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLParagraphElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const startTransform = useRef("none");

  // Frame the command in the top-left corner and the logo across the window.
  useLayoutEffect(() => {
    const camera = cameraRef.current;
    const commandEl = commandRef.current;
    const art = artRef.current;
    if (!camera || !commandEl || !art) return;
    const cameraRect = camera.getBoundingClientRect();
    const commandRect = commandEl.getBoundingClientRect();
    const artRect = art.getBoundingClientRect();
    const commandTop = commandRect.top - cameraRect.top;
    const commandLeft = commandRect.left - cameraRect.left;
    const artBottom = artRect.bottom - cameraRect.top;
    const viewportWidth = window.innerWidth;
    const edge = Math.min(40, Math.max(18, viewportWidth * 0.035));
    const top = 36;
    const scale = Math.max(
      1.03,
      Math.min(
        2.6,
        (viewportWidth - edge * 2) / Math.max(artRect.width, commandEl.scrollWidth),
        (window.innerHeight - top - 32) / (artBottom - commandTop),
      ),
    );
    const left = edge - commandLeft * scale;
    startTransform.current = `translate(${left}px, ${top - commandTop * scale}px) scale(${scale})`;
    camera.style.transform = startTransform.current;
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const animations: Animation[] = [];
    const later = (fn: () => void, delay: number) => {
      timers.push(window.setTimeout(fn, delay));
    };
    let audio: HTMLAudioElement | null = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setAtlasIntroStatus("done");
    };
    const reveal = () => {
      setPhase("reveal");
      const backdrop = backdropRef.current;
      const overlay = overlayRef.current;
      if (!backdrop || !overlay) return finish();
      animations.push(
        backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 650,
          easing: "ease",
          fill: "forwards",
        }),
      );
      later(() => {
        const fade = overlay.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 160,
          easing: "linear",
          fill: "forwards",
        });
        animations.push(fade);
        fade.finished.then(finish, finish);
      }, 650);
    };
    const zoomOut = () => {
      setPhase("zoom");
      const camera = cameraRef.current;
      if (!camera) return finish();
      const target = findLandedTerminal()?.getBoundingClientRect();
      const destination =
        target && target.width > 0
          ? `translate(${target.left}px, ${target.top}px) scale(${target.width / width})`
          : `translate(${(window.innerWidth - width) / 2}px, ${Math.max(
              48,
              window.innerHeight * 0.18,
            )}px) scale(1)`;
      const zoom = camera.animate(
        [{ transform: startTransform.current }, { transform: destination }],
        { duration: 1400, easing: "cubic-bezier(.4,0,.15,1)", fill: "forwards" },
      );
      animations.push(zoom);
      zoom.finished.then(reveal, () => undefined);
    };
    let revealed = 0;
    let zoomStarted = false;
    const loadRows = () => {
      const remaining = TOTAL_ROWS - revealed;
      // Land on a three-row boundary so the final burst loads during the zoom.
      const batchRemaining = zoomStarted ? remaining : Math.max(0, remaining - 3);
      let lines = Math.min(batchRemaining, randomBetween(2, 4));
      if (batchRemaining - lines === 1) lines = lines === 2 ? 3 : lines - 1;
      revealed += lines;
      setRows(revealed);
      if (!zoomStarted && TOTAL_ROWS - revealed <= 3) {
        zoomStarted = true;
        zoomOut();
      }
      if (revealed < TOTAL_ROWS) later(loadRows, randomBetween(300, 600) / 2.2);
    };
    const startLogo = () => {
      setPhase("logo");
      if (getLocalStorageItem(ATLAS_SOUND_STORAGE_KEY, Schema.Boolean) ?? true) {
        audio = new Audio(auroraUrl);
        // Autoplay can be refused in a plain browser tab; the logo plays anyway.
        void audio.play().catch(() => undefined);
      }
      loadRows();
    };
    let position = 0;
    const typeNext = () => {
      position += 1;
      setTyped(position);
      if (position < command.length) later(typeNext, randomBetween(45, 140) / 2.55);
      else later(startLogo, 180);
    };
    later(typeNext, 1600);
    // A safety net: never leave the app covered.
    later(finish, 15_000);
    const skip = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("keydown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      for (const timer of timers) window.clearTimeout(timer);
      for (const animation of animations) animation.cancel();
      // Aurora keeps playing into the app unless the intro was skipped early.
      if (!finished) audio?.pause();
    };
  }, [command, width]);

  return (
    <div
      ref={overlayRef}
      data-atlas-intro-overlay
      role="presentation"
      onClick={() => setAtlasIntroStatus("done")}
      className="fixed inset-0 z-100 overflow-hidden"
    >
      <div ref={backdropRef} data-atlas-intro-backdrop className="absolute inset-0 bg-card" />
      <div ref={cameraRef} data-atlas-intro-camera style={{ width }}>
        <AtlasTerminalFrame
          meta={meta}
          typed={typed}
          rows={rows}
          chromeVisible={phase === "zoom" || phase === "reveal"}
          caret={phase === "typing"}
          commandRef={commandRef}
          artRef={artRef}
          className="shadow-2xl/20"
        />
      </div>
    </div>
  );
}
