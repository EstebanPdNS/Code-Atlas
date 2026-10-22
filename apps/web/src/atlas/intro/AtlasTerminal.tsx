import {
  BotIcon,
  CalendarIcon,
  ChartNoAxesColumnIcon,
  FolderIcon,
  GithubIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { Schema } from "effect";
import { useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";

import { Button } from "~/components/ui/button";
import { getLocalStorageItem, useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import auroraUrl from "./aurora.mp3";
import { atlasProviderFill } from "../brand/providerColors";
import { CODE_ATLAS_VERSION } from "../brand/version";
import {
  ATLAS_SOUND_STORAGE_KEY,
  formatAtlasCount,
  formatAtlasWeekCounts,
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

// Launch intro timing. The handbook's typing and row cadence felt slow inside
// the app, so its random delays are divided by these speedups.
const TYPE_SPEEDUP = 2.55;
const ROW_SPEEDUP = 2.2;
const INTRO_START_DELAY_MS = 1600;
// The longest the intro waits for a fresh launch to mount the new thread's terminal.
const INTRO_READY_TIMEOUT_MS = 6000;
const LOGO_START_DELAY_MS = 180;
const ZOOM_DURATION_MS = 1400;
const BACKDROP_FADE_MS = 650;
// A safety net: never leave the app covered.
const INTRO_SAFETY_TIMEOUT_MS = 20_000;
// Well below the macOS window buttons, which sit over the fullscreen intro.
const INTRO_COMMAND_TOP_PX = 104;

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * A panel's outline: a "+" on each corner and four separate edges that stop
 * short of them, so no line shows through a "+" and each edge can draw in on
 * its own when the chrome appears.
 */
function AtlasFrameMarks() {
  return (
    <>
      <span aria-hidden data-atlas-edge="top" />
      <span aria-hidden data-atlas-edge="right" />
      <span aria-hidden data-atlas-edge="bottom" />
      <span aria-hidden data-atlas-edge="left" />
      <span aria-hidden data-atlas-corner="tl" />
      <span aria-hidden data-atlas-corner="tr" />
      <span aria-hidden data-atlas-corner="br" />
      <span aria-hidden data-atlas-corner="bl" />
    </>
  );
}

/** One section heading of the terminal's data grid: icon, label and a rule. */
function AtlasInfoHeading(props: { readonly icon: React.ReactNode; readonly label: string }) {
  return (
    <p data-atlas-info-heading>
      <span aria-hidden data-atlas-info-icon>
        {props.icon}
      </span>
      <span>{props.label}</span>
      <span aria-hidden data-atlas-rule-line />
    </p>
  );
}

function AtlasInfoCell(props: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section data-atlas-info-cell aria-label={props.label}>
      <AtlasInfoHeading icon={props.icon} label={props.label} />
      {props.children}
    </section>
  );
}

interface AtlasTerminalFrameProps {
  readonly meta: AtlasTerminalMeta;
  readonly typed: number;
  readonly rows: number;
  /**
   * Everything but the command and the art: titlebar, panel outlines, rules,
   * data grid and the ready line. Hidden while the intro types; they play
   * their entrance when it turns on.
   */
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
  // Parts hidden by a short window replay their entrance when shown again;
  // once the prompt (the last step) has faded in, resizing shows them as is.
  const [entered, setEntered] = useState(false);
  return (
    <section
      ref={frameRef}
      data-atlas-terminal
      data-atlas-chrome={props.chromeVisible ? "on" : "off"}
      data-atlas-entered={entered || undefined}
      onAnimationEnd={(event) => {
        if (event.animationName === "atlas-fade-in" && event.target instanceof HTMLElement) {
          if (event.target.hasAttribute("data-atlas-prompt")) setEntered(true);
        }
      }}
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
        <p ref={commandRef} aria-hidden className="mb-4 w-fit text-xs">
          <span className="text-primary">C:/code_atlas/</span>
          <span className="mx-1.5 text-muted-foreground">&gt;</span>
          <span>{command.slice(0, props.typed)}</span>
          {props.caret ? <span data-atlas-caret /> : null}
          {/* The untyped rest keeps its width, so the intro frames the whole command from the start. */}
          <span className="invisible">{command.slice(props.typed)}</span>
        </p>
        {/* The art sits in a dashed frame with "+" corners, like a terminal UI panel. */}
        <div data-atlas-art-frame>
          <AtlasFrameMarks />
          <div aria-hidden data-atlas-enter data-atlas-rule className="mb-3 text-2xs uppercase">
            <span>// Code Atlas</span>
            <span data-atlas-rule-line />
            <span data-atlas-dots>
              <span />
              <span />
              <span />
            </span>
          </div>
          {/* The box takes the height left over by everything else; the glyphs scale to fit it. */}
          <div ref={artRef} aria-hidden data-atlas-art>
            <div data-atlas-art-glyphs>
              <pre data-atlas-ascii>
                {MAP_ROWS.map((segments, index) => (
                  <span
                    key={MAP_ROW_KEYS[index]}
                    data-atlas-art-row
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
                    data-atlas-art-row
                    data-tone={row.tone}
                    data-hidden={index >= props.rows || undefined}
                  >
                    {row.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
            </div>
          </div>
        </div>
        <div data-atlas-enter data-atlas-info>
          <AtlasFrameMarks />
          <AtlasInfoCell icon={<FolderIcon />} label="Project">
            <p className="truncate font-semibold text-foreground">
              {meta.projectName ?? "No project"}
            </p>
            <AtlasInfoHeading icon={<BotIcon />} label="Agents" />
            <p className="text-muted-foreground">
              {meta.agents.length > 0 ? meta.agents.join(" · ") : "Claude Code · Codex"}
            </p>
          </AtlasInfoCell>
          <AtlasInfoCell icon={<ChartNoAxesColumnIcon />} label="Usage">
            {meta.usage.length === 0 ? (
              <p className="text-muted-foreground">No usage data yet</p>
            ) : (
              <ul className="grid gap-1.5">
                {meta.usage.map((entry) => {
                  const fill = atlasProviderFill(entry.label);
                  return (
                    <li key={entry.label} className="flex items-center gap-2.5">
                      <span className="shrink-0 truncate text-foreground">{entry.label}</span>
                      <span data-atlas-meter aria-hidden>
                        <span
                          style={{
                            width: `${entry.percent ?? 0}%`,
                            ...(fill === null ? {} : { background: fill }),
                          }}
                        />
                      </span>
                      <strong className="w-9 text-right font-medium text-foreground tabular-nums">
                        {entry.percent === null ? "—" : `${Math.round(entry.percent)}%`}
                      </strong>
                    </li>
                  );
                })}
              </ul>
            )}
          </AtlasInfoCell>
          <AtlasInfoCell icon={<CalendarIcon />} label="This week">
            {meta.week === null ? (
              <p className="text-muted-foreground">—</p>
            ) : (
              <div className="grid gap-1 tabular-nums">
                <p>
                  <span className="text-success">+{formatAtlasCount(meta.week.linesAdded)}</span>
                  <span className="text-muted-foreground"> / </span>
                  <span className="text-destructive">
                    −{formatAtlasCount(meta.week.linesRemoved)}
                  </span>
                  <span className="text-muted-foreground"> lines</span>
                </p>
                <p className="text-muted-foreground">{formatAtlasWeekCounts(meta.week)}</p>
              </div>
            )}
          </AtlasInfoCell>
          <AtlasInfoCell icon={<GithubIcon />} label="GitHub">
            {meta.github.length === 0 ? (
              <p className="text-muted-foreground">Not signed in</p>
            ) : (
              <ul className="grid gap-1">
                {meta.github.map((entry) => (
                  <li key={entry.account} className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        entry.connected ? "bg-success" : "bg-muted-foreground/40",
                      )}
                    />
                    <span
                      className={cn(
                        "truncate",
                        entry.connected ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {entry.account}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AtlasInfoCell>
        </div>
        <div aria-hidden data-atlas-enter data-atlas-rule className="mt-3 text-2xs uppercase">
          <span data-atlas-palette>
            {PALETTE_KEYS.map((key) => (
              <span key={key} />
            ))}
          </span>
          <span data-atlas-rule-line />
          <span className="truncate">
            {meta.projectName ?? "Code Atlas"} <span className="mx-1">//</span> Code Atlas
          </span>
        </div>
        <div data-atlas-enter className="mt-4 text-xs">
          <p data-atlas-rule data-atlas-status className="text-muted-foreground">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
            <span>
              <span className="text-primary">[ready]</span> workspace loaded · describe your next
              task below
            </span>
            <span aria-hidden data-atlas-rule-line data-dashed />
            <span className="tabular-nums">v{CODE_ATLAS_VERSION}</span>
          </p>
          <p aria-hidden data-atlas-prompt className="mt-2">
            <span className="text-primary">C:/code_atlas/</span>
            <span className="mx-1.5 text-muted-foreground">&gt;</span>
            <span data-atlas-caret data-atlas-caret-idle />
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
 * The landed terminal above the new-thread composer. It hides while the
 * intro's camera flies into its slot; AtlasTerminalMetaPublisher keeps the
 * meta the intro shows current.
 */
export function AtlasTerminal({ meta }: { readonly meta: AtlasTerminalMeta }) {
  const status = useAtlasIntroStatus();
  const [soundEnabled, setSoundEnabled] = useLocalStorage(
    ATLAS_SOUND_STORAGE_KEY,
    true,
    Schema.Boolean,
  );
  const command = slugifyAtlasCommand(meta.projectName);
  return (
    <AtlasTerminalFrame
      meta={meta}
      typed={command.length}
      rows={TOTAL_ROWS}
      chromeVisible
      caret={false}
      hidden={status !== "done"}
      className={cn("mx-auto shadow-lg/5", status !== "done" && "invisible")}
      controls={
        <>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label={soundEnabled ? "Mute startup sound" : "Enable startup sound"}
            aria-pressed={soundEnabled}
            data-atlas-press
            onClick={() => setSoundEnabled(!soundEnabled)}
          >
            {soundEnabled ? <Volume2Icon /> : <VolumeXIcon />}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Replay the Code Atlas intro"
            disabled={status !== "done"}
            data-atlas-press
            onClick={replayAtlasIntro}
          >
            <RotateCwIcon />
          </Button>
        </>
      }
    />
  );
}

/** The terminal for an empty thread, fed by the active thread's published meta. */
export function AtlasEmptyThreadTerminal() {
  const meta = useAtlasTerminalMeta();
  return <AtlasTerminal meta={meta} />;
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
  // Decided before the first render, so a skipped intro never mounts its scene.
  const [introSkipped] = useState(
    () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      typeof Element.prototype.animate !== "function",
  );
  useEffect(() => {
    if (status !== "pending") return;
    setAtlasIntroStatus(introSkipped ? "done" : "playing");
  }, [status, introSkipped]);
  // Mount while still "pending" too, so the first painted frame is already the
  // fullscreen terminal rather than the app flashing in underneath it.
  if (status === "done" || introSkipped) return null;
  return createPortal(<AtlasLaunchIntroScene meta={meta} />, document.body);
}

/**
 * Frames the command in the top-left corner and the logo across the window,
 * and returns that transform (the zoom-out starts from it).
 */
function frameIntroCamera(
  camera: HTMLElement | null,
  commandEl: HTMLElement | null,
  art: HTMLElement | null,
): string {
  if (!camera || !commandEl || !art) return "none";
  // Measure untransformed: the camera may already be framed.
  camera.style.transform = "none";
  const cameraRect = camera.getBoundingClientRect();
  const commandRect = commandEl.getBoundingClientRect();
  const artRect = art.getBoundingClientRect();
  const commandTop = commandRect.top - cameraRect.top;
  const commandLeft = commandRect.left - cameraRect.left;
  const artBottom = artRect.bottom - cameraRect.top;
  const viewportWidth = window.innerWidth;
  const edge = Math.min(40, Math.max(18, viewportWidth * 0.035));
  const top = INTRO_COMMAND_TOP_PX;
  // Like the handbook: the logo spans most of the window width, limited only
  // by the window height.
  const scale = Math.max(
    1.03,
    Math.min(
      6,
      (viewportWidth * 0.8) / Math.max(artRect.width, commandEl.scrollWidth),
      (window.innerHeight - top - 40) / (artBottom - commandTop),
    ),
  );
  const left = edge - commandLeft * scale;
  const transform = `translate(${left}px, ${top - commandTop * scale}px) scale(${scale})`;
  camera.style.transform = transform;
  return transform;
}

function landedTerminalSize(): { readonly width: number; readonly height: number } | null {
  const rect = findLandedTerminal()?.getBoundingClientRect();
  return rect && rect.width > 0 ? { width: rect.width, height: rect.height } : null;
}

function AtlasLaunchIntroScene({ meta }: { readonly meta: AtlasTerminalMeta }) {
  // On a fresh launch the project loads during the opening pause: the typing
  // reads the latest meta, so it types the project the terminal lands on.
  const metaRef = useRef(meta);
  useLayoutEffect(() => {
    metaRef.current = meta;
  }, [meta]);
  const [typed, setTyped] = useState(0);
  const [rows, setRows] = useState(0);
  const [phase, setPhase] = useState<IntroPhase>("typing");
  const phaseRef = useRef<IntroPhase>("typing");
  useLayoutEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  // The landing terminal's box. On a fresh launch the app mounts it after the
  // intro, so it is measured again when the typing starts; the zoom-out then
  // animates the size to wherever it is by then.
  const [{ width, height }] = useState(
    () =>
      landedTerminalSize() ?? {
        width: Math.min(704, window.innerWidth - 64),
        height: Math.max(360, Math.min(620, window.innerHeight - 240)),
      },
  );
  const sizeRef = useRef({ width, height });
  const overlayRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLParagraphElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const startTransform = useRef("none");
  const skipRef = useRef(() => setAtlasIntroStatus("done"));

  // Frame the command in the top-left corner and the logo across the window,
  // and again if the window changes before the zoom (a fresh window can still
  // be maximizing when the intro mounts).
  useLayoutEffect(() => {
    startTransform.current = frameIntroCamera(
      cameraRef.current,
      commandRef.current,
      artRef.current,
    );
    const onResize = () => {
      if (phaseRef.current !== "typing" && phaseRef.current !== "logo") return;
      startTransform.current = frameIntroCamera(
        cameraRef.current,
        commandRef.current,
        artRef.current,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
    const reveal = (zoom: Animation | null) => {
      setPhase("reveal");
      const backdrop = backdropRef.current;
      const overlay = overlayRef.current;
      if (!backdrop || !overlay) return finish();
      // Data can still reflow the page during the zoom; follow the terminal to where it is now.
      const camera = cameraRef.current;
      const target = findLandedTerminal()?.getBoundingClientRect();
      if (zoom && camera && target && target.width > 0) {
        zoom.cancel();
        camera.style.transform = `translate(${target.left}px, ${target.top}px)`;
        camera.style.width = `${target.width}px`;
        camera.style.height = `${target.height}px`;
      }
      const fade = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: BACKDROP_FADE_MS,
        easing: "ease",
        fill: "forwards",
      });
      animations.push(fade);
      // The camera already sits on the landed terminal: hand over in one
      // commit (overlay out, terminal in) instead of fading the camera first,
      // which blinked the terminal out and back.
      fade.finished.then(finish, finish);
    };
    const zoomOut = () => {
      setPhase("zoom");
      const camera = cameraRef.current;
      if (!camera) return finish();
      const { width, height } = sizeRef.current;
      const target = findLandedTerminal()?.getBoundingClientRect();
      const landed =
        target && target.width > 0
          ? { left: target.left, top: target.top, width: target.width, height: target.height }
          : {
              left: (window.innerWidth - width) / 2,
              top: Math.max(48, window.innerHeight * 0.18),
              width,
              height,
            };
      // Size and position both end on the landed terminal, so the reveal has nothing to jump.
      const zoom = camera.animate(
        [
          { transform: startTransform.current, width: `${width}px`, height: `${height}px` },
          {
            transform: `translate(${landed.left}px, ${landed.top}px) scale(1)`,
            width: `${landed.width}px`,
            height: `${landed.height}px`,
          },
        ],
        { duration: ZOOM_DURATION_MS, easing: "cubic-bezier(.4,0,.15,1)", fill: "forwards" },
      );
      animations.push(zoom);
      zoom.finished.then(
        () => reveal(target && target.width > 0 ? zoom : null),
        () => undefined,
      );
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
      if (revealed < TOTAL_ROWS) later(loadRows, randomBetween(300, 600) / ROW_SPEEDUP);
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
      const command = slugifyAtlasCommand(metaRef.current.projectName);
      if (position < command.length) later(typeNext, randomBetween(45, 140) / TYPE_SPEEDUP);
      else later(startLogo, LOGO_START_DELAY_MS);
    };
    // The backdrop covers the app from the first frame, but the terminal stays
    // hidden until it has its final size. On a fresh launch the app is still
    // loading the new thread, whose terminal is where the zoom lands; starting
    // with a guessed size made the prompt, then the logo, jump to the real one
    // mid-animation (Replay never did: the terminal already exists). So the
    // intro waits for that terminal to settle, then shows and starts typing.
    // A view without one (an open thread) starts with the default size.
    let waitedMs = 0;
    let previous: { readonly width: number; readonly height: number } | null = null;
    let withoutTerminalMs = 0;
    const startWhenReady = () => {
      const camera = cameraRef.current;
      if (!camera) return;
      const landed = landedTerminalSize();
      const settled =
        landed !== null &&
        previous !== null &&
        landed.width === previous.width &&
        landed.height === previous.height;
      const chatShown = document.querySelector('[data-chat-composer-overlay="true"]') !== null;
      withoutTerminalMs = landed === null && chatShown ? withoutTerminalMs + 100 : 0;
      previous = landed;
      if (!settled && withoutTerminalMs < 600 && waitedMs < INTRO_READY_TIMEOUT_MS) {
        waitedMs += 100;
        later(startWhenReady, 100);
        return;
      }
      if (landed) {
        sizeRef.current = landed;
        camera.style.width = `${landed.width}px`;
        camera.style.height = `${landed.height}px`;
      }
      startTransform.current = frameIntroCamera(camera, commandRef.current, artRef.current);
      camera.dataset.atlasReady = "";
      // A beat of blinking caret before the typing, as when the intro starts at once.
      later(typeNext, Math.max(INTRO_START_DELAY_MS - waitedMs, 450));
    };
    startWhenReady();
    later(finish, INTRO_SAFETY_TIMEOUT_MS);
    // Escape and a click both skip: the app appears and Aurora stops with it.
    const skip = () => {
      audio?.pause();
      finish();
    };
    skipRef.current = skip;
    const skipOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip();
    };
    window.addEventListener("keydown", skipOnEscape);
    return () => {
      window.removeEventListener("keydown", skipOnEscape);
      for (const timer of timers) window.clearTimeout(timer);
      for (const animation of animations) animation.cancel();
      // Aurora keeps playing into the app unless the intro was skipped early.
      if (!finished) audio?.pause();
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      data-atlas-intro-overlay
      role="presentation"
      onClick={() => skipRef.current()}
      className="fixed inset-0 z-100 overflow-hidden"
    >
      <div ref={backdropRef} data-atlas-intro-backdrop className="absolute inset-0 bg-card" />
      <div ref={cameraRef} data-atlas-intro-camera data-atlas-fill style={{ width, height }}>
        <AtlasTerminalFrame
          meta={meta}
          typed={typed}
          rows={rows}
          chromeVisible={phase === "zoom" || phase === "reveal"}
          caret={phase === "typing"}
          commandRef={commandRef}
          artRef={artRef}
          // Lands with the landed terminal's shadow, so the handover shows no seam.
          className={phase === "reveal" ? "shadow-lg/5" : "shadow-2xl/20"}
        />
      </div>
    </div>
  );
}
