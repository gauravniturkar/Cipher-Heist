/**
 * Progression state machine.
 *
 * Two rules hold everything together:
 *
 *   1. Stage N is reachable only when stages 1..N-1 are solved.
 *   2. A stage is solved only when it holds an unlock token whose sha256
 *      matches the hash baked into the challenge.
 *
 * Because state is *derived* from tokens rather than trusted from storage,
 * editing saved JSON, or setting a flag from the browser console, does not
 * unlock anything: without a token minted by a correct answer, the stage
 * re-locks the moment the state is recomputed.
 */

import type {
  Case, CaseResult, GradeResult, PlayerProgress, StageProgress, StageState,
} from '../types.js';
import { CONCEPT_LABELS } from './challenges.js';
import { sha256 } from './hash.js';

export const PROGRESS_VERSION = 2;
const STARTING_ACTIONS = 3;

export function createProgress(generated: Case): PlayerProgress {
  return {
    version: PROGRESS_VERSION,
    seed: generated.seed,
    difficulty: generated.difficulty,
    currentStage: 1,
    stages: generated.stages.map((stage) => ({
      index: stage.index,
      state: stage.index === 1 ? 'active' : 'locked',
      attempts: 0,
      wrongAttempts: 0,
      hintsUsed: 0,
      unlockToken: null,
      solvedAt: null,
    })),
    branches: [],
    unlockedClues: generated.clues.filter((clue) => clue.revealedByStage === 1).map((clue) => clue.id),
    investigationActions: STARTING_ACTIONS,
    accusedId: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
}

/** The one place that decides whether a stage counts as solved. */
export function isStageSolved(generated: Case, progress: PlayerProgress, index: number): boolean {
  const stage = generated.stages.find((s) => s.index === index);
  const record = progress.stages.find((s) => s.index === index);
  if (!stage || !record || record.unlockToken === null) return false;
  return sha256(record.unlockToken) === stage.challenge.check.unlockHash;
}

export function stageState(generated: Case, progress: PlayerProgress, index: number): StageState {
  if (isStageSolved(generated, progress, index)) return 'solved';
  for (let earlier = 1; earlier < index; earlier++) {
    if (!isStageSolved(generated, progress, earlier)) return 'locked';
  }
  return 'active';
}

export function solvedCount(generated: Case, progress: PlayerProgress): number {
  return generated.stages.filter((stage) => isStageSolved(generated, progress, stage.index)).length;
}

/** True once every stage is solved and the accusation can be made. */
export function canAccuse(generated: Case, progress: PlayerProgress): boolean {
  return solvedCount(generated, progress) === generated.stages.length;
}

/**
 * Recomputes every derived field from the tokens. Called after loading from
 * storage and after each submission, so tampered state is corrected rather
 * than trusted.
 */
export function reconcile(generated: Case, progress: PlayerProgress): PlayerProgress {
  const stages: StageProgress[] = generated.stages.map((stage) => {
    const record = progress.stages.find((s) => s.index === stage.index);
    const solved = isStageSolved(generated, progress, stage.index);
    return {
      index: stage.index,
      state: stageState(generated, progress, stage.index),
      attempts: Math.max(0, record?.attempts ?? 0),
      wrongAttempts: Math.max(0, record?.wrongAttempts ?? 0),
      hintsUsed: Math.max(0, record?.hintsUsed ?? 0),
      unlockToken: solved ? (record?.unlockToken ?? null) : null,
      solvedAt: solved ? (record?.solvedAt ?? Date.now()) : null,
    };
  });

  const solvedIndexes = stages.filter((s) => s.state === 'solved').map((s) => s.index);
  const highestSolved = solvedIndexes.length > 0 ? Math.max(...solvedIndexes) : 0;

  // Branches and clues are re-derived from what is genuinely solved.
  const branches = generated.stages
    .filter((stage) => solvedIndexes.includes(stage.index))
    .map((stage) => stage.branch.key);

  // Stage 1's clues set the puzzle up and are always visible; everything else
  // stays sealed until the stage that earns it has actually been solved.
  const unlockedClues = generated.clues
    .filter((clue) => clue.revealedByStage === 1 || clue.revealedByStage <= highestSolved)
    .map((clue) => clue.id);

  const nextStage = Math.min(generated.stages.length, highestSolved + 1);
  const requested = progress.currentStage;
  const currentStage =
    requested >= 1 && requested <= generated.stages.length && stageState(generated, { ...progress, stages }, requested) !== 'locked'
      ? requested
      : nextStage;

  return {
    ...progress,
    version: PROGRESS_VERSION,
    stages,
    branches,
    unlockedClues,
    currentStage,
    investigationActions: Math.max(0, Math.min(STARTING_ACTIONS, progress.investigationActions)),
  };
}

/**
 * Applies a grade to the progress. A correct answer stores its token and opens
 * the next stage; a wrong-but-running answer costs an investigation action,
 * which is what buys the player a free hint.
 */
export function applyGrade(
  generated: Case,
  progress: PlayerProgress,
  stageIndex: number,
  result: GradeResult,
): { progress: PlayerProgress; unlockedStage: number | null; spentAction: boolean } {
  if (stageState(generated, progress, stageIndex) === 'locked') {
    // Nothing a locked stage can do: refuse the submission outright.
    return { progress, unlockedStage: null, spentAction: false };
  }

  const stages = progress.stages.map((record) =>
    record.index === stageIndex ? { ...record, attempts: record.attempts + 1 } : record,
  );
  let next: PlayerProgress = { ...progress, stages };
  let unlockedStage: number | null = null;
  let spentAction = false;

  if (result.status === 'correct' && result.unlockToken) {
    const stage = generated.stages.find((s) => s.index === stageIndex);
    if (stage && sha256(result.unlockToken) === stage.challenge.check.unlockHash) {
      next = {
        ...next,
        stages: next.stages.map((record) =>
          record.index === stageIndex
            ? { ...record, unlockToken: result.unlockToken as string, solvedAt: Date.now(), state: 'solved' }
            : record,
        ),
      };
      // The next stage opens, but the player stays here: the outcome of what
      // they just found is the payoff, and moving on is their call.
      unlockedStage = stageIndex < generated.stages.length ? stageIndex + 1 : null;
    }
  } else if (result.status === 'incorrect') {
    // Only a program that ran and produced a wrong answer costs an action.
    // Syntax and runtime errors are part of learning, not a penalty.
    spentAction = next.investigationActions > 0;
    next = {
      ...next,
      investigationActions: Math.max(0, next.investigationActions - 1),
      stages: next.stages.map((record) =>
        record.index === stageIndex ? { ...record, wrongAttempts: record.wrongAttempts + 1 } : record,
      ),
    };
  }

  return { progress: reconcile(generated, next), unlockedStage, spentAction };
}

export function useHint(progress: PlayerProgress, stageIndex: number): PlayerProgress {
  return {
    ...progress,
    stages: progress.stages.map((record) =>
      record.index === stageIndex ? { ...record, hintsUsed: record.hintsUsed + 1 } : record,
    ),
  };
}

/** How many hints the player has earned at this stage: one, plus one per wrong answer. */
export function availableHints(progress: PlayerProgress, stageIndex: number, total: number): number {
  const record = progress.stages.find((s) => s.index === stageIndex);
  const earned = 1 + Math.min(total - 1, record?.wrongAttempts ?? 0);
  return Math.min(total, Math.max(1, earned));
}

export function accuse(generated: Case, progress: PlayerProgress, suspectId: string): { progress: PlayerProgress; result: CaseResult } {
  const finished: PlayerProgress = {
    ...progress,
    accusedId: suspectId,
    finishedAt: progress.finishedAt ?? Date.now(),
  };

  const solved = generated.stages.filter((stage) => isStageSolved(generated, finished, stage.index));
  const result: CaseResult = {
    correct: suspectId === generated.solution.culpritId,
    accusedId: suspectId,
    culpritId: generated.solution.culpritId,
    method: generated.solution.method,
    motive: generated.solution.motive,
    stagesSolved: solved.length,
    totalStages: generated.stages.length,
    wrongAttempts: finished.stages.reduce((total, record) => total + record.wrongAttempts, 0),
    hintsUsed: finished.stages.reduce((total, record) => total + record.hintsUsed, 0),
    elapsedMs: (finished.finishedAt ?? Date.now()) - finished.startedAt,
    conceptsPractised: generated.stages.map((stage) => ({
      concept: stage.concept,
      label: CONCEPT_LABELS[stage.concept],
      solved: solved.some((s) => s.index === stage.index),
    })),
  };

  return { progress: finished, result };
}
