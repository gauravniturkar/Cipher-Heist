/**
 * Seeded case generation.
 *
 * The generator fixes the truth first - who did it, when they walked in, where
 * the handover was to happen - and only then derives clues, timeline and
 * challenges from that truth. Nothing downstream invents facts, which is what
 * keeps a randomised case internally consistent.
 *
 * Two independent lines of deduction are always built in, and both must land
 * on the same person (see `solver.ts`, which the test suite runs over hundreds
 * of seeds):
 *
 *   1. Alibi elimination - corroborated alibis remove suspects until one is left.
 *   2. Access - the decoded handover point can only be reached by two people,
 *      one of whom the finale clears.
 */

import type {
  Case, Clue, Difficulty, Relationship, Suspect, TimelineEvent,
} from '../types.js';
import {
  buildReferenceSolutions, buildStages, secondsToClock, type NameTransform, type PuzzleInputs,
} from './challenges.js';
import {
  ARCHETYPES, EXONERATION_TEMPLATES, FAMILY_NAMES, GIVEN_NAMES, METHODS, MOTIVES,
  RED_HERRING_REASONS, RELATION_TEMPLATES,
} from './data/pools.js';
import { Rng } from './rng.js';
import { normaliseSeed } from './seed.js';

interface DifficultyProfile {
  suspects: number;
  sensorEntries: number;
  markerOffsets: number[];
  cipherShifts: number[];
  transforms: NameTransform[];
  lockLimit: [number, number];
  /** Shift is stated outright only at the easiest level. */
  shiftIsGiven: boolean;
}

const PROFILES: Record<Difficulty, DifficultyProfile> = {
  rookie: {
    suspects: 3,
    sensorEntries: 6,
    markerOffsets: [1],
    cipherShifts: [1, 2, 3],
    transforms: ['reverse'],
    lockLimit: [60, 100],
    shiftIsGiven: true,
  },
  detective: {
    suspects: 4,
    sensorEntries: 9,
    markerOffsets: [1, 2],
    cipherShifts: [2, 3, 4, 5],
    transforms: ['reverse', 'rotate'],
    lockLimit: [100, 180],
    shiftIsGiven: false,
  },
  inspector: {
    suspects: 5,
    sensorEntries: 12,
    markerOffsets: [2, 3],
    cipherShifts: [3, 4, 5, 6, 7],
    transforms: ['reverse', 'rotate', 'padded-reverse'],
    lockLimit: [150, 300],
    shiftIsGiven: false,
  },
};

export function generateCase(rawSeed: string, difficulty: Difficulty = 'detective'): Case {
  return build(rawSeed, difficulty).generated;
}

/**
 * The case plus Python that solves every stage of it. Only the test suite uses
 * this - it is how "is this case solvable?" is answered by solving it.
 */
export function generateCaseWithReference(
  rawSeed: string,
  difficulty: Difficulty = 'detective',
): { generated: Case; reference: { stage: number; code: string }[] } {
  const { generated, inputs } = build(rawSeed, difficulty);
  return { generated, reference: buildReferenceSolutions(inputs) };
}

function build(rawSeed: string, difficulty: Difficulty): { generated: Case; inputs: PuzzleInputs } {
  const seed = normaliseSeed(rawSeed) ?? rawSeed.toUpperCase();
  const profile = PROFILES[difficulty];
  // Difficulty is part of the seed material: the same seed at two difficulties
  // is deliberately two different cases, not the same one rescaled.
  const rng = new Rng(`${seed}|${difficulty}`);
  const salt = `${seed}|${difficulty}|v2`;

  // ── setting ────────────────────────────────────────────────────────────
  const archetype = rng.pick(ARCHETYPES);
  const place = rng.pick(archetype.places);
  const city = rng.pick(archetype.cities);
  const object = rng.pick(archetype.objects);
  const incident = rng.pick(archetype.incidents);
  const atmosphere = rng.pick(archetype.atmosphere);

  const locations = rng.shuffle(archetype.locations);
  const incidentLocation = locations[0] as string;
  const dropLocation = locations[1] as string;
  const elsewhere = locations.slice(2);

  // ── times ──────────────────────────────────────────────────────────────
  // Entry lands in the evening, and its last digit doubles as the cipher shift
  // on the harder levels, so stage 2's answer genuinely feeds stage 3.
  const shift = rng.pick(profile.cipherShifts);
  const entryTime = pickEntryTime(rng, shift);
  const incidentEnd = entryTime + rng.int(4, 12) * 60;

  const markerOffset = rng.pick(profile.markerOffsets);
  const timestamps = buildSensorLog(rng, entryTime, markerOffset, profile.sensorEntries);
  const markerTime = timestamps[timestamps.indexOf(entryTime) + markerOffset] as number;

  // ── people ─────────────────────────────────────────────────────────────
  const suspects = buildSuspects(rng, profile.suspects, archetype.roles, elsewhere, {
    start: entryTime,
    end: incidentEnd,
  });

  const culpritIndex = rng.int(0, suspects.length - 1);
  let herringIndex = rng.int(0, suspects.length - 1);
  if (herringIndex === culpritIndex) herringIndex = (herringIndex + 1) % suspects.length;
  const culprit = suspects[culpritIndex] as Suspect;
  const redHerring = suspects[herringIndex] as Suspect;

  applyAlibis(suspects, culprit, redHerring, { start: entryTime, end: incidentEnd }, incidentLocation, rng);
  const weights = pickWeights(rng);
  applyStats(suspects, culprit, redHerring, weights, rng);
  applyAccess(suspects, culprit, redHerring, dropLocation, elsewhere, rng);

  const relationships = buildRelationships(rng, suspects);
  const method = rng.pick(METHODS);

  // ── clues ──────────────────────────────────────────────────────────────
  const clues = buildClues({
    rng, suspects, culprit, redHerring, place, object, incidentLocation, dropLocation,
    entryTime, incidentEnd, markerTime, weights,
  });

  const timeline = buildTimeline({
    rng, suspects, culprit, redHerring, entryTime, incidentEnd, markerTime,
    incidentLocation, dropLocation, timestamps,
  });

  // ── stages ─────────────────────────────────────────────────────────────
  const puzzleInputs: PuzzleInputs = {
    rng,
    salt,
    difficulty,
    suspects,
    culprit,
    redHerring,
    firstLead: redHerring,
    place,
    object,
    incidentLocation,
    dropLocation,
    entryTime,
    markerTime,
    timestamps,
    markerOffset,
    weights,
    lockPuzzle: buildLockPuzzle(rng, profile.lockLimit),
    nameTransform: rng.pick(profile.transforms),
    rotateBy: rng.int(2, 4),
    padding: rng.pick(['##', 'ZZ', '**', 'QQ']),
    cipherShift: shift,
  };

  const stages = buildStages(puzzleInputs);
  const title = rng
    .pick(archetype.titleForms)
    .replace('{object}', capitalise(object.replace(/^the /, '')))
    .replace('{place}', place.replace(/^the /, ''))
    .replace('{city}', city);

  const generated: Case = {
    seed,
    difficulty,
    title,
    subtitle: `${capitalise(object)} — ${incident}`,
    setting: {
      place,
      city,
      object,
      incident: `${capitalise(object)} was ${incident}. ${atmosphere}`,
      incidentWindow: { start: entryTime, end: incidentEnd },
    },
    suspects,
    relationships,
    timeline,
    clues,
    stages,
    solution: {
      culpritId: culprit.id,
      method,
      motive: culprit.motive,
      provingClues: ['clue-window', 'clue-access', 'clue-exoneration'],
    },
  };

  return { generated, inputs: puzzleInputs };
}

// ── helpers ──────────────────────────────────────────────────────────────
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Entry time between 20:00 and 23:30, on a whole 5-second boundary, whose last
 * digit equals the cipher shift.
 */
function pickEntryTime(rng: Rng, shift: number): number {
  const base = rng.int(72_000, 84_600);
  const rounded = base - (base % 10);
  return rounded + shift;
}

/** A strictly ascending log containing the entry time with room on both sides. */
function buildSensorLog(rng: Rng, entryTime: number, markerOffset: number, count: number): number[] {
  const before = rng.int(1, Math.max(1, count - markerOffset - 2));
  const values = new Set<number>([entryTime]);

  let cursor = entryTime;
  for (let i = 0; i < count - before - 1; i++) {
    cursor += rng.int(11, 240);
    values.add(cursor);
  }
  cursor = entryTime;
  for (let i = 0; i < before; i++) {
    cursor -= rng.int(11, 240);
    values.add(cursor);
  }
  return [...values].sort((a, b) => a - b);
}

function buildSuspects(
  rng: Rng,
  count: number,
  roles: readonly string[],
  elsewhere: string[],
  window: { start: number; end: number },
): Suspect[] {
  const given = rng.sample(GIVEN_NAMES, count);
  const family = rng.sample(FAMILY_NAMES, count);
  const chosenRoles = rng.sample(roles, count);
  const motives = rng.sample(MOTIVES, count);

  return Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    name: `${given[index]} ${family[index]}`,
    role: chosenRoles[index] as string,
    claimedLocation: elsewhere[index % elsewhere.length] as string,
    motive: motives[index] as string,
    stats: { opportunity: 0, motive: 0, access: 0 },
    alibiWindow: { start: window.start, end: window.end },
    alibiCorroborated: false,
    accessAreas: [],
  }));
}

/**
 * The culprit is the one person whose account of the window does not hold. The
 * red herring's does hold, but nobody can prove it until the final stage.
 */
function applyAlibis(
  suspects: Suspect[],
  culprit: Suspect,
  redHerring: Suspect,
  window: { start: number; end: number },
  incidentLocation: string,
  rng: Rng,
): void {
  for (const suspect of suspects) {
    if (suspect.id === culprit.id) {
      // An account that starts too late and ends too early to cover the window.
      suspect.alibiWindow = { start: window.start + rng.int(120, 400), end: window.end + rng.int(60, 300) };
      suspect.alibiCorroborated = false;
      suspect.claimedLocation = incidentLocation === suspect.claimedLocation ? suspect.claimedLocation : suspect.claimedLocation;
      continue;
    }
    // Everyone else can account for the whole window; only the corroboration
    // differs, and for the red herring it arrives last.
    suspect.alibiWindow = { start: window.start - rng.int(300, 1200), end: window.end + rng.int(300, 1200) };
    suspect.alibiCorroborated = suspect.id !== redHerring.id;
  }
  redHerring.alibiCorroborated = false;
}

function pickWeights(rng: Rng): [number, number, number] {
  const options = [1, 1.5, 2, 2.5, 3];
  const picked = rng.sample(options, 3) as [number, number, number];
  return picked;
}

/**
 * Stats are generated, scored, then *assigned* by rank, so the ordering the
 * story depends on (red herring first, culprit second) is guaranteed rather
 * than hoped for.
 */
function applyStats(
  suspects: Suspect[],
  culprit: Suspect,
  redHerring: Suspect,
  weights: [number, number, number],
  rng: Rng,
): void {
  const score = (s: { opportunity: number; motive: number; access: number }): number =>
    s.opportunity * weights[0] + s.motive * weights[1] + s.access * weights[2];

  const pool: { opportunity: number; motive: number; access: number }[] = [];
  const seen = new Set<number>();
  let guard = 0;
  while (pool.length < suspects.length && guard++ < 500) {
    const candidate = { opportunity: rng.int(2, 10), motive: rng.int(2, 10), access: rng.int(2, 10) };
    const value = Number(score(candidate).toFixed(4));
    // Distinct totals keep "who ranks highest" unambiguous.
    if (seen.has(value)) continue;
    seen.add(value);
    pool.push(candidate);
  }
  pool.sort((a, b) => score(b) - score(a));

  const order = [redHerring, culprit, ...suspects.filter((s) => s.id !== culprit.id && s.id !== redHerring.id)];
  order.forEach((suspect, index) => {
    suspect.stats = pool[index] as Suspect['stats'];
  });
}

/** Exactly two people can reach the handover point: the culprit and the decoy. */
function applyAccess(
  suspects: Suspect[],
  culprit: Suspect,
  redHerring: Suspect,
  dropLocation: string,
  elsewhere: string[],
  rng: Rng,
): void {
  for (const suspect of suspects) {
    const others = rng.sample(elsewhere, Math.min(2, elsewhere.length));
    suspect.accessAreas = suspect.id === culprit.id || suspect.id === redHerring.id
      ? [dropLocation, ...others.slice(0, 1)]
      : others;
  }
}

function buildRelationships(rng: Rng, suspects: Suspect[]): Relationship[] {
  const pairs: [Suspect, Suspect][] = [];
  for (let i = 0; i < suspects.length; i++) {
    for (let j = i + 1; j < suspects.length; j++) {
      pairs.push([suspects[i] as Suspect, suspects[j] as Suspect]);
    }
  }
  const count = Math.min(pairs.length, suspects.length);
  const templates = rng.shuffle(RELATION_TEMPLATES);
  return rng.sample(pairs, count).map(([a, b], index) => {
    const template = templates[index % templates.length] as (typeof RELATION_TEMPLATES)[number];
    return {
      from: a.id,
      to: b.id,
      kind: template.kind,
      note: template.note.replace('{a}', a.name).replace('{b}', b.name),
    };
  });
}

interface ClueInputs {
  rng: Rng;
  suspects: Suspect[];
  culprit: Suspect;
  redHerring: Suspect;
  place: string;
  object: string;
  incidentLocation: string;
  dropLocation: string;
  entryTime: number;
  incidentEnd: number;
  markerTime: number;
  weights: [number, number, number];
}

function buildClues(input: ClueInputs): Clue[] {
  const { rng, suspects, culprit, redHerring, dropLocation, entryTime, incidentEnd } = input;
  const cleared = suspects.filter((s) => s.id !== culprit.id && s.id !== redHerring.id);
  const window = `${secondsToClock(entryTime)}–${secondsToClock(incidentEnd)}`;

  const clues: Clue[] = [
    {
      id: 'clue-log',
      kind: 'document',
      title: 'Visitor log, ground floor',
      body: `One handwritten line does not match any name on the staff list. Everything else on the page is printed by the badge reader.`,
      revealedByStage: 1,
      isRedHerring: false,
      pointsAt: redHerring.id,
    },
    {
      id: 'clue-motive-lead',
      kind: 'testimony',
      title: `What people say about ${redHerring.name}`,
      body: `${redHerring.name} ${redHerring.motive}. Also, ${redHerring.name} ${rng.pick(RED_HERRING_REASONS)}.`,
      revealedByStage: 1,
      isRedHerring: true,
      pointsAt: redHerring.id,
      defusedBy: 'clue-exoneration',
    },
    {
      id: 'clue-window',
      kind: 'digital',
      title: `Corroborated whereabouts, ${window}`,
      body:
        cleared.length > 0
          ? `${cleared.map((s) => s.name).join(', ')} ${cleared.length === 1 ? 'is' : 'are'} accounted for across the whole window by someone other than themselves. ` +
            `${culprit.name} and ${redHerring.name} are not.`
          : `${culprit.name} and ${redHerring.name} cannot be placed elsewhere for the whole window.`,
      revealedByStage: 2,
      isRedHerring: false,
      pointsAt: null,
    },
    {
      id: 'clue-drop',
      kind: 'digital',
      title: 'Decoded message',
      body: `The intercepted numbers spell a place inside the building: ${dropLocation}. The message was sent four minutes after the door sensor fired.`,
      revealedByStage: 3,
      isRedHerring: false,
      pointsAt: null,
    },
    {
      id: 'clue-access',
      kind: 'digital',
      title: `Credential list for ${dropLocation}`,
      body: `Two people on this list can badge into ${dropLocation}: ${[culprit.name, redHerring.name].sort().join(' and ')}. Nobody else can get through that door without help.`,
      revealedByStage: 3,
      isRedHerring: false,
      pointsAt: null,
    },
    {
      id: 'clue-score',
      kind: 'document',
      title: 'Insurer’s weighting model',
      body: `The model weights opportunity ×${input.weights[0]}, motive ×${input.weights[1]} and access ×${input.weights[2]}. It ranks ${redHerring.name} first — the model has never once been asked to explain itself.`,
      revealedByStage: 4,
      isRedHerring: true,
      pointsAt: redHerring.id,
      defusedBy: 'clue-exoneration',
    },
    {
      id: 'clue-exoneration',
      kind: 'testimony',
      title: `${redHerring.name} is cleared`,
      body: rng
        .pick(EXONERATION_TEMPLATES)
        .replace(/\{name\}/g, redHerring.name)
        .replace('{place}', redHerring.claimedLocation),
      revealedByStage: 5,
      isRedHerring: false,
      pointsAt: null,
    },
    {
      id: 'clue-method',
      kind: 'physical',
      title: 'How it was done',
      body: `Whoever took it ${rng.pick(METHODS)}. That takes a credential for ${dropLocation} and a reason to be in the building late.`,
      revealedByStage: 5,
      isRedHerring: false,
      pointsAt: null,
    },
  ];

  return clues;
}

interface TimelineInputs {
  rng: Rng;
  suspects: Suspect[];
  culprit: Suspect;
  redHerring: Suspect;
  entryTime: number;
  incidentEnd: number;
  markerTime: number;
  incidentLocation: string;
  dropLocation: string;
  timestamps: number[];
}

/**
 * The timeline never names the culprit. Crime-scene events are recorded by
 * machines (`actorId: null`); people appear only where a witness or a badge
 * puts them, which is what the deduction is made of.
 */
function buildTimeline(input: TimelineInputs): TimelineEvent[] {
  const { suspects, culprit, entryTime, incidentEnd, markerTime, incidentLocation, dropLocation } = input;
  const first = input.timestamps[0] as number;

  const events: TimelineEvent[] = [
    {
      at: first - 600,
      label: 'Building switches to night staffing',
      location: 'Main entrance',
      actorId: null,
      revealedByStage: 1,
    },
    {
      at: entryTime,
      label: 'Door sensor fires — no badge presented',
      location: incidentLocation,
      actorId: null,
      revealedByStage: 2,
    },
    {
      at: markerTime,
      label: 'Alarm loop cut',
      location: incidentLocation,
      actorId: null,
      revealedByStage: 2,
    },
    {
      at: markerTime + 240,
      label: 'Encoded message sent from an internal terminal',
      location: dropLocation,
      actorId: null,
      revealedByStage: 3,
    },
    {
      at: incidentEnd,
      label: 'Item confirmed missing',
      location: incidentLocation,
      actorId: null,
      revealedByStage: 1,
    },
  ];

  for (const suspect of suspects) {
    events.push({
      at: suspect.alibiWindow.start,
      label: suspect.alibiCorroborated
        ? `${suspect.name} placed in ${suspect.claimedLocation} by an independent witness`
        : `${suspect.name} says they were in ${suspect.claimedLocation}`,
      location: suspect.claimedLocation,
      actorId: suspect.id,
      revealedByStage: suspect.id === culprit.id ? 2 : suspect.alibiCorroborated ? 2 : 4,
    });
  }

  return events.sort((a, b) => a.at - b.at);
}

/**
 * A lock puzzle with at least two matches (so "largest" and "smallest" are
 * different questions) and few enough that the answer is checkable by hand.
 */
function buildLockPuzzle(rng: Rng, limitRange: [number, number]): PuzzleInputs['lockPuzzle'] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const divisorA = rng.int(3, 9);
    const divisorB = rng.int(3, 9);
    if (divisorA === divisorB) continue;
    const limit = rng.int(limitRange[0], limitRange[1]);
    const step = lcm(divisorA, divisorB);
    if (step > limit / 2) continue;
    const floor = rng.int(Math.floor(limit / 4), Math.floor(limit / 2));
    const matches: number[] = [];
    for (let n = step; n <= limit; n += step) if (n > floor) matches.push(n);
    if (matches.length < 2 || matches.length > 6) continue;
    return { limit, divisorA, divisorB, floor, want: rng.pick(['largest', 'smallest', 'count'] as const) };
  }
  // Deterministic fallback that satisfies every constraint above.
  return { limit: 100, divisorA: 7, divisorB: 4, floor: 20, want: 'largest' };
}

function lcm(a: number, b: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  return (a * b) / gcd(a, b);
}
