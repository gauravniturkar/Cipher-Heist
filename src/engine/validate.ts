/**
 * Structural invariants for a generated case.
 *
 * `validateCase` is cheap enough to run in the app itself (the loader calls it
 * and falls back to another seed if a case ever fails), and it is what the
 * generator tests assert against across many seeds.
 */

import type { Case, ConceptId } from '../types.js';
import { deduce } from './solver.js';

const EXPECTED_CONCEPTS: ConceptId[] = [
  'variables-strings',
  'lists-indexing',
  'loops-ascii',
  'functions',
  'conditionals',
];

export interface ValidationResult {
  valid: boolean;
  problems: string[];
}

export function validateCase(generated: Case): ValidationResult {
  const problems: string[] = [];
  const fail = (condition: boolean, message: string): void => {
    if (!condition) problems.push(message);
  };

  // People
  fail(generated.suspects.length >= 3 && generated.suspects.length <= 5, 'a case needs 3-5 suspects');
  fail(new Set(generated.suspects.map((s) => s.id)).size === generated.suspects.length, 'suspect ids must be unique');
  fail(new Set(generated.suspects.map((s) => s.name)).size === generated.suspects.length, 'suspect names must be unique');
  fail(new Set(generated.suspects.map((s) => s.role)).size === generated.suspects.length, 'suspect roles must be unique');
  fail(
    generated.suspects.every((s) => s.motive.trim().length > 0),
    'every suspect needs a motive',
  );

  // The hidden solution has to name someone who exists.
  const culprit = generated.suspects.find((s) => s.id === generated.solution.culpritId);
  fail(culprit !== undefined, 'the culprit must be one of the suspects');

  // Relationships must reference real people and not be self-loops.
  for (const relation of generated.relationships) {
    fail(relation.from !== relation.to, 'a relationship cannot point at one person twice');
    fail(
      generated.suspects.some((s) => s.id === relation.from) && generated.suspects.some((s) => s.id === relation.to),
      'relationships must reference real suspects',
    );
  }

  // Timeline
  fail(generated.timeline.length >= 5, 'the timeline is too thin to reason about');
  const sorted = [...generated.timeline].every(
    (event, index, all) => index === 0 || (all[index - 1] as { at: number }).at <= event.at,
  );
  fail(sorted, 'timeline events must be in chronological order');
  fail(
    generated.timeline.every((event) => event.actorId === null || generated.suspects.some((s) => s.id === event.actorId)),
    'timeline events must reference real suspects',
  );
  fail(
    generated.setting.incidentWindow.end > generated.setting.incidentWindow.start,
    'the incident window must have positive length',
  );

  // Clues
  const clueIds = new Set(generated.clues.map((clue) => clue.id));
  fail(clueIds.size === generated.clues.length, 'clue ids must be unique');
  for (const clue of generated.clues) {
    fail(clue.revealedByStage >= 1 && clue.revealedByStage <= 5, `clue ${clue.id} unlocks outside the stage range`);
    fail(clue.body.trim().length > 0, `clue ${clue.id} has no body`);
    if (clue.isRedHerring) {
      fail(clue.defusedBy !== undefined, `red herring ${clue.id} must be defused by another clue`);
      fail(
        clue.defusedBy === undefined || clueIds.has(clue.defusedBy),
        `red herring ${clue.id} points at a clue that does not exist`,
      );
      fail(clue.pointsAt !== generated.solution.culpritId, `red herring ${clue.id} must not point at the culprit`);
    }
  }
  fail(generated.clues.some((clue) => clue.isRedHerring), 'a case needs at least one red herring');
  for (const clueId of generated.solution.provingClues) {
    fail(clueIds.has(clueId), `proving clue ${clueId} is missing from the case`);
  }

  // Stages
  fail(generated.stages.length === 5, 'a case has five stages');
  generated.stages.forEach((stage, index) => {
    fail(stage.index === index + 1, `stage ${index + 1} is numbered wrongly`);
    fail(stage.concept === EXPECTED_CONCEPTS[index], `stage ${index + 1} teaches the wrong concept`);
    fail(stage.story.length > 0, `stage ${index + 1} has no story`);
    fail(stage.challenge.lesson.length >= 2, `stage ${index + 1} needs a proper explanation`);
    fail(stage.challenge.hints.length >= 1, `stage ${index + 1} needs at least one hint`);
    fail(stage.challenge.prompt.trim().length > 0, `stage ${index + 1} has no prompt`);
    fail(/^[0-9a-f]{64}$/.test(stage.challenge.check.answerHash), `stage ${index + 1} has no answer hash`);
    fail(/^[0-9a-f]{64}$/.test(stage.challenge.check.unlockHash), `stage ${index + 1} has no unlock hash`);
    // A near miss that hashes to the answer would hand the answer out as feedback.
    for (const miss of stage.challenge.check.nearMisses) {
      fail(miss.hash !== stage.challenge.check.answerHash, `stage ${index + 1} has a near miss equal to the answer`);
    }
    for (const id of stage.branch.exonerates) {
      fail(generated.suspects.some((s) => s.id === id), `stage ${index + 1} clears someone who is not a suspect`);
    }
    fail(
      !stage.branch.exonerates.includes(generated.solution.culpritId),
      `stage ${index + 1} clears the culprit`,
    );
  });

  // Solvability: the public deduction must land on the hidden culprit.
  const deduction = deduce(generated);
  fail(deduction.unique, 'the clues must narrow to exactly one suspect');
  fail(
    deduction.culpritId === generated.solution.culpritId,
    'the deduction must reach the same person as the hidden solution',
  );
  fail(deduction.byAlibi.length >= 1, 'alibi elimination must leave someone standing');
  fail(deduction.byAccess.length >= 1, 'access elimination must leave someone standing');

  return { valid: problems.length === 0, problems };
}
