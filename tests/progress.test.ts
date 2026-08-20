import { describe, expect, it } from 'vitest';
import { generateCaseWithReference } from '../src/engine/generator.js';
import { LocalGrader } from '../src/grader/grader.js';
import {
  accuse, applyGrade, canAccuse, createProgress, isStageSolved, reconcile, solvedCount, stageState,
} from '../src/engine/progress.js';
import type { PlayerProgress } from '../src/types.js';

const grader = new LocalGrader();
const { generated, reference } = generateCaseWithReference('CH-PROG-1', 'detective');
const solutionFor = (stage: number): string => reference.find((r) => r.stage === stage)!.code;

function solveThrough(upTo: number): PlayerProgress {
  let progress = createProgress(generated);
  for (let stage = 1; stage <= upTo; stage++) {
    const result = grader.grade(generated.stages[stage - 1]!.challenge, solutionFor(stage));
    progress = applyGrade(generated, progress, stage, result).progress;
  }
  return progress;
}

describe('locking', () => {
  it('starts with only the first stage open', () => {
    const progress = createProgress(generated);
    expect(stageState(generated, progress, 1)).toBe('active');
    for (const stage of [2, 3, 4, 5]) expect(stageState(generated, progress, stage)).toBe('locked');
  });

  it('opens exactly one more stage per correct answer', () => {
    for (let solved = 0; solved <= 5; solved++) {
      const progress = solveThrough(solved);
      expect(solvedCount(generated, progress)).toBe(solved);
      for (let stage = 1; stage <= 5; stage++) {
        const expected = stage <= solved ? 'solved' : stage === solved + 1 ? 'active' : 'locked';
        expect(stageState(generated, progress, stage), `solved=${solved} stage=${stage}`).toBe(expected);
      }
    }
  });

  it('refuses submissions aimed at a locked stage', () => {
    const progress = createProgress(generated);
    const result = grader.grade(generated.stages[4]!.challenge, solutionFor(5));
    expect(result.status).toBe('correct'); // the code itself is right
    const applied = applyGrade(generated, progress, 5, result);
    expect(applied.unlockedStage).toBeNull();
    expect(isStageSolved(generated, applied.progress, 5)).toBe(false);
  });

  it('will not let the accusation happen early', () => {
    expect(canAccuse(generated, solveThrough(4))).toBe(false);
    expect(canAccuse(generated, solveThrough(5))).toBe(true);
  });
});

describe('tamper resistance', () => {
  it('ignores a state flipped to solved without a token', () => {
    const tampered = reconcile(generated, {
      ...createProgress(generated),
      currentStage: 5,
      stages: createProgress(generated).stages.map((stage) => ({ ...stage, state: 'solved' as const })),
    });
    expect(solvedCount(generated, tampered)).toBe(0);
    expect(stageState(generated, tampered, 2)).toBe('locked');
    expect(tampered.currentStage).toBe(1);
  });

  it('ignores a forged unlock token', () => {
    const forged = reconcile(generated, {
      ...createProgress(generated),
      stages: createProgress(generated).stages.map((stage) => ({
        ...stage,
        state: 'solved' as const,
        unlockToken: 'f'.repeat(64),
      })),
    });
    expect(solvedCount(generated, forged)).toBe(0);
    expect(canAccuse(generated, forged)).toBe(false);
  });

  it('does not accept a token minted for another stage', () => {
    const solved = solveThrough(1);
    const stolen = solved.stages.find((s) => s.index === 1)!.unlockToken;
    const moved = reconcile(generated, {
      ...createProgress(generated),
      stages: createProgress(generated).stages.map((stage) =>
        stage.index === 3 ? { ...stage, unlockToken: stolen } : stage,
      ),
    });
    expect(isStageSolved(generated, moved, 3)).toBe(false);
  });

  it('does not accept a token from another case', () => {
    const other = generateCaseWithReference('CH-PROG-2', 'detective');
    const otherProgress = applyGrade(
      other.generated,
      createProgress(other.generated),
      1,
      grader.grade(other.generated.stages[0]!.challenge, other.reference[0]!.code),
    ).progress;
    const foreignToken = otherProgress.stages[0]!.unlockToken;
    expect(foreignToken).toBeTruthy();

    const injected = reconcile(generated, {
      ...createProgress(generated),
      stages: createProgress(generated).stages.map((stage) =>
        stage.index === 1 ? { ...stage, unlockToken: foreignToken } : stage,
      ),
    });
    expect(isStageSolved(generated, injected, 1)).toBe(false);
  });

  it('will not jump currentStage past what is solved', () => {
    const progress = reconcile(generated, { ...createProgress(generated), currentStage: 4 });
    expect(progress.currentStage).toBe(1);
  });
});

describe('branches and consequences', () => {
  it('records a branch key per solved stage, in order', () => {
    const progress = solveThrough(3);
    expect(progress.branches).toEqual(generated.stages.slice(0, 3).map((s) => s.branch.key));
  });

  it('reveals clues only as their stage is reached', () => {
    const early = createProgress(generated);
    const lateClues = generated.clues.filter((clue) => clue.revealedByStage === 5).map((clue) => clue.id);
    for (const id of lateClues) expect(early.unlockedClues).not.toContain(id);

    const finished = solveThrough(5);
    for (const id of lateClues) expect(finished.unlockedClues).toContain(id);
  });

  it('spends an investigation action on a wrong answer but not on a broken one', () => {
    const stageOne = generated.stages[0]!;
    let progress = createProgress(generated);
    const before = progress.investigationActions;

    const broken = applyGrade(generated, progress, 1, grader.grade(stageOne.challenge, 'print('));
    expect(broken.spentAction).toBe(false);
    expect(broken.progress.investigationActions).toBe(before);

    progress = applyGrade(generated, progress, 1, grader.grade(stageOne.challenge, 'print("NOBODY")')).progress;
    expect(progress.investigationActions).toBe(before - 1);
    expect(progress.stages[0]!.wrongAttempts).toBe(1);
  });

  it('never drops below zero actions', () => {
    let progress = createProgress(generated);
    for (let i = 0; i < 10; i++) {
      progress = applyGrade(generated, progress, 1, grader.grade(generated.stages[0]!.challenge, 'print("NOPE")')).progress;
    }
    expect(progress.investigationActions).toBe(0);
    expect(stageState(generated, progress, 1)).toBe('active'); // still playable
  });
});

describe('case result', () => {
  it('confirms a correct accusation and reports the concepts practised', () => {
    const progress = solveThrough(5);
    const { result } = accuse(generated, progress, generated.solution.culpritId);
    expect(result.correct).toBe(true);
    expect(result.stagesSolved).toBe(5);
    expect(result.conceptsPractised.every((c) => c.solved)).toBe(true);
    expect(result.conceptsPractised.map((c) => c.concept)).toEqual([
      'variables-strings', 'lists-indexing', 'loops-ascii', 'functions', 'conditionals',
    ]);
  });

  it('reports a wrong accusation without hiding the truth', () => {
    const progress = solveThrough(5);
    const other = generated.suspects.find((s) => s.id !== generated.solution.culpritId)!;
    const { result } = accuse(generated, progress, other.id);
    expect(result.correct).toBe(false);
    expect(result.culpritId).toBe(generated.solution.culpritId);
    expect(result.method.length).toBeGreaterThan(0);
  });
});
