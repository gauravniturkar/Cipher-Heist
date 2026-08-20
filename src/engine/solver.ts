/**
 * The deductive solver.
 *
 * It plays the case the way an honest player would: using only what the case
 * makes public, it eliminates suspects until one is left. The test suite runs
 * it over hundreds of seeds, and a case whose solver result disagrees with its
 * own hidden solution is a generator bug, not a hard puzzle.
 */

import type { Case, Suspect } from '../types.js';

export interface Deduction {
  /** Suspects still standing after every line of reasoning. */
  remaining: string[];
  /** Suspects left after alibi elimination alone. */
  byAlibi: string[];
  /** Suspects left after the access list alone. */
  byAccess: string[];
  /** Ids cleared by a stage outcome. */
  exonerated: string[];
  /** True when exactly one suspect survives and both lines agree on them. */
  unique: boolean;
  culpritId: string | null;
}

function covers(window: { start: number; end: number }, incident: { start: number; end: number }): boolean {
  return window.start <= incident.start && window.end >= incident.end;
}

/** Recovers the handover location from the stage that decodes it. */
export function dropLocationOf(generated: Case): string | null {
  const stage = generated.stages.find((s) => s.branch.key.startsWith('stage3.drop:'));
  return stage ? (stage.branch.key.split(':')[1] ?? null) : null;
}

const lettersOnly = (text: string): string => text.toUpperCase().replace(/[^A-Z]/g, '');

export function deduce(generated: Case): Deduction {
  const incident = generated.setting.incidentWindow;
  const exonerated = new Set(generated.stages.flatMap((stage) => stage.branch.exonerates));

  const notCleared = (suspect: Suspect): boolean => !exonerated.has(suspect.id);

  // Line 1: a corroborated alibi spanning the whole window removes you.
  const byAlibi = generated.suspects
    .filter(notCleared)
    .filter((suspect) => !(suspect.alibiCorroborated && covers(suspect.alibiWindow, incident)))
    .map((suspect) => suspect.id);

  // Line 2: the handover point can only be reached by people who hold its credential.
  const drop = dropLocationOf(generated);
  const byAccess = generated.suspects
    .filter(notCleared)
    .filter((suspect) =>
      drop === null ? true : suspect.accessAreas.some((area) => lettersOnly(area) === drop),
    )
    .map((suspect) => suspect.id);

  const remaining = byAlibi.filter((id) => byAccess.includes(id));
  const unique = remaining.length === 1;

  return {
    remaining,
    byAlibi,
    byAccess,
    exonerated: [...exonerated],
    unique,
    culpritId: unique ? (remaining[0] as string) : null,
  };
}

/**
 * What the player can conclude at a given point in the investigation, used by
 * the UI to show how the field is narrowing.
 */
export function narrowingAfterStage(generated: Case, stagesSolved: number): string[] {
  const incident = generated.setting.incidentWindow;
  const exonerated = new Set(
    generated.stages
      .filter((stage) => stage.index <= stagesSolved)
      .flatMap((stage) => stage.branch.exonerates),
  );

  return generated.suspects
    .filter((suspect) => !exonerated.has(suspect.id))
    .filter((suspect) => {
      if (stagesSolved < 2) return true;
      return !(suspect.alibiCorroborated && covers(suspect.alibiWindow, incident));
    })
    .map((suspect) => suspect.id);
}
