/**
 * Code Atlas agent personas: every subagent gets a person's name and a face
 * ("Ronny is working on: Fixing the issue #45"). Both derive from the
 * subagent's stable id, so the same agent keeps its name and face across
 * reloads, devices and views, with nothing stored.
 */
import { AGENT_FACE_COLORS, AGENT_FACE_NAMES, AGENT_SHAPE_NAMES } from "./agentFaces";

export const AGENT_NAMES = [
  "Ronny",
  "Jaime",
  "Marco",
  "Nelson",
  "Lucía",
  "Bruno",
  "Iris",
  "Teo",
  "Nora",
  "Hugo",
  "Vera",
  "Simón",
  "Lola",
  "Iván",
  "Paz",
  "Dante",
  "Inés",
  "Gael",
  "Mila",
  "Rocco",
  "Olga",
  "Félix",
  "Celia",
  "Tomás",
  "Ada",
  "Leo",
  "Rita",
  "Joel",
  "Elsa",
  "Omar",
] as const;

export interface AgentPersona {
  readonly name: string;
  readonly shape: (typeof AGENT_SHAPE_NAMES)[number];
  readonly face: (typeof AGENT_FACE_NAMES)[number];
  readonly color: string;
}

/** 32-bit FNV-1a: small, fast and stable across platforms. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function pick<T>(items: readonly T[], seed: number): T {
  return items[seed % items.length]!;
}

/**
 * The persona for one agent. Pass the ids of its siblings (the thread's other
 * subagents, in atlasSubagentOrder) so agents of one thread get different
 * names: a clash moves the agent later in that order to the next free name.
 */
export function agentPersona(id: string, siblingIds: readonly string[] = []): AgentPersona {
  const taken = new Set<number>();
  for (const sibling of siblingIds) {
    if (sibling === id) break;
    taken.add(freeSlot(hash(sibling), taken));
  }
  const nameSlot = freeSlot(hash(id), taken);
  const look = hash(`${id}:face`);
  return {
    name: AGENT_NAMES[nameSlot]!,
    shape: pick(AGENT_SHAPE_NAMES, look),
    face: pick(AGENT_FACE_NAMES, look >>> 8),
    color: pick(AGENT_FACE_COLORS, look >>> 16),
  };
}

function freeSlot(seed: number, taken: ReadonlySet<number>): number {
  const start = seed % AGENT_NAMES.length;
  if (taken.size >= AGENT_NAMES.length) return start;
  let slot = start;
  while (taken.has(slot)) slot = (slot + 1) % AGENT_NAMES.length;
  return slot;
}

/** "Ronny is working on: …", "Ronny finished: …" for the agent's status. */
export function agentPersonaHeadline(
  name: string,
  status:
    | "idle"
    | "pending"
    | "running"
    | "waiting"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted",
): string {
  switch (status) {
    case "completed":
      return `${name} finished:`;
    case "failed":
      return `${name} failed:`;
    case "cancelled":
    case "interrupted":
      return `${name} stopped:`;
    case "pending":
      return `${name} is about to work on:`;
    case "waiting":
    case "idle":
      return `${name} is waiting on:`;
    case "running":
      return `${name} is working on:`;
  }
}

/**
 * A thread's subagent ids in id order, joined into one string: a stable value
 * for atom selectors, split back for agentPersona's siblings. Ordering by id
 * rather than start time means an agent's name never changes when its start
 * time arrives.
 */
export function atlasSubagentOrder(subagents: ReadonlyArray<{ readonly id: string }>): string {
  return subagents
    .map((agent) => agent.id)
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .join("\n");
}
