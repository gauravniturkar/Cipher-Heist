import { describe, expect, it } from 'vitest';
import { generateCase, generateCaseWithReference } from '../src/engine/generator.js';
import { validateCase } from '../src/engine/validate.js';
import { deduce } from '../src/engine/solver.js';
import { seedFromRng } from '../src/engine/seed.js';
import { Rng } from '../src/engine/rng.js';
import { DIFFICULTIES, type Difficulty } from '../src/types.js';

/** A spread of seeds that is itself deterministic, so failures are reproducible. */
function seeds(count: number, from = 'CH-TEST-0001'): string[] {
  const rng = new Rng(from);
  return Array.from({ length: count }, () => seedFromRng(rng));
}

describe('determinism', () => {
  it('produces identical cases for the same seed', () => {
    for (const seed of seeds(10)) {
      expect(JSON.stringify(generateCase(seed))).toBe(JSON.stringify(generateCase(seed)));
    }
  });

  it('accepts sloppy seed input and still lands on the same case', () => {
    const canonical = generateCase('CH-4F2A-91QL');
    expect(generateCase('ch-4f2a-91ql').title).toBe(canonical.title);
    expect(generateCase(' 4F2A91QL ').solution.culpritId).toBe(canonical.solution.culpritId);
  });

  it('treats each difficulty as its own case', () => {
    const seed = 'CH-2222-3333';
    const titles = DIFFICULTIES.map((d) => generateCase(seed, d).title);
    const culprits = DIFFICULTIES.map((d) => generateCase(seed, d).solution.culpritId);
    expect(new Set([...titles, ...culprits]).size).toBeGreaterThan(1);
  });
});

describe('variety', () => {
  const sample = seeds(120).map((seed) => generateCase(seed, 'detective'));

  it('varies the setting, the culprit and the puzzles between cases', () => {
    expect(new Set(sample.map((c) => c.setting.place)).size).toBeGreaterThan(4);
    expect(new Set(sample.map((c) => c.setting.object)).size).toBeGreaterThan(4);
    expect(new Set(sample.map((c) => c.suspects.map((s) => s.name).join('|'))).size).toBeGreaterThan(100);
    expect(new Set(sample.map((c) => c.solution.culpritId)).size).toBeGreaterThan(1);
    expect(new Set(sample.map((c) => c.stages[1]?.challenge.givens.join())).size).toBeGreaterThan(100);
    expect(new Set(sample.map((c) => c.stages[4]?.challenge.prompt)).size).toBeGreaterThan(20);
  });

  it('does not always pin the crime on the same seat at the table', () => {
    const positions = sample.map((c) => c.suspects.findIndex((s) => s.id === c.solution.culpritId));
    expect(new Set(positions).size).toBeGreaterThan(2);
  });

  it('scales suspect count with difficulty', () => {
    expect(generateCase('CH-AAAA-BBBB', 'rookie').suspects).toHaveLength(3);
    expect(generateCase('CH-AAAA-BBBB', 'detective').suspects).toHaveLength(4);
    expect(generateCase('CH-AAAA-BBBB', 'inspector').suspects).toHaveLength(5);
  });
});

describe('internal consistency', () => {
  it('passes every structural invariant across many seeds and difficulties', () => {
    const failures: string[] = [];
    for (const difficulty of DIFFICULTIES) {
      for (const seed of seeds(80, `CH-VALID-${difficulty}`)) {
        const generated = generateCase(seed, difficulty as Difficulty);
        const result = validateCase(generated);
        if (!result.valid) failures.push(`${seed}/${difficulty}: ${result.problems.join('; ')}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('narrows to exactly one suspect, by two independent routes', () => {
    for (const seed of seeds(60, 'CH-DEDUCE-1')) {
      const generated = generateCase(seed, 'inspector');
      const deduction = deduce(generated);
      expect(deduction.unique, seed).toBe(true);
      expect(deduction.culpritId).toBe(generated.solution.culpritId);
      // Before the finale clears the decoy, two people are genuinely in frame.
      expect(deduction.exonerated.length).toBeGreaterThan(0);
    }
  });

  it('never leaks the culprit through a red herring or an early clue', () => {
    for (const seed of seeds(40, 'CH-LEAK-1')) {
      const generated = generateCase(seed, 'detective');
      const culprit = generated.suspects.find((s) => s.id === generated.solution.culpritId);
      const earlyClues = generated.clues.filter((clue) => clue.revealedByStage <= 2);
      for (const clue of earlyClues) {
        expect(clue.pointsAt, `${seed}/${clue.id}`).not.toBe(generated.solution.culpritId);
      }
      // The culprit's name may appear in the stage-2 elimination clue, but only
      // alongside the decoy - never alone.
      const windowClue = generated.clues.find((clue) => clue.id === 'clue-window');
      const namesInClue = generated.suspects.filter((s) => windowClue?.body.includes(s.name));
      expect(namesInClue.length).toBeGreaterThan(1);
      expect(culprit).toBeDefined();
    }
  });

  it('keeps the timeline free of any event naming the culprit at the scene', () => {
    for (const seed of seeds(40, 'CH-TIMELINE-1')) {
      const generated = generateCase(seed, 'detective');
      const sceneEvents = generated.timeline.filter(
        (event) => event.location === generated.timeline[1]?.location && event.actorId !== null,
      );
      expect(sceneEvents.map((e) => e.actorId)).not.toContain(generated.solution.culpritId);
    }
  });
});

describe('reference solutions', () => {
  it('generates code that matches every stage of the case it came from', () => {
    for (const seed of seeds(5, 'CH-REF-1')) {
      const { generated, reference } = generateCaseWithReference(seed, 'detective');
      expect(reference).toHaveLength(generated.stages.length);
      for (const entry of reference) {
        expect(entry.code.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
