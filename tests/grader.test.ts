import { describe, expect, it } from 'vitest';
import { generateCase, generateCaseWithReference } from '../src/engine/generator.js';
import { LocalGrader } from '../src/grader/grader.js';
import { seedFromRng } from '../src/engine/seed.js';
import { Rng } from '../src/engine/rng.js';
import { DIFFICULTIES, type Difficulty } from '../src/types.js';

const grader = new LocalGrader();

function seeds(count: number, from: string): string[] {
  const rng = new Rng(from);
  return Array.from({ length: count }, () => seedFromRng(rng));
}

describe('every generated case is solvable end to end', () => {
  it('accepts the reference solution for all five stages, at every difficulty', () => {
    const failures: string[] = [];
    for (const difficulty of DIFFICULTIES) {
      for (const seed of seeds(25, `CH-SOLVE-${difficulty}`)) {
        const { generated, reference } = generateCaseWithReference(seed, difficulty as Difficulty);
        for (const entry of reference) {
          const stage = generated.stages[entry.stage - 1];
          if (!stage) { failures.push(`${seed}: no stage ${entry.stage}`); continue; }
          const result = grader.grade(stage.challenge, entry.code);
          if (result.status !== 'correct') {
            failures.push(`${seed}/${difficulty} stage ${entry.stage}: ${result.status} — ${result.message}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('accepting equivalent solutions', () => {
  const { generated } = generateCaseWithReference('CH-EQ-TEST', 'rookie');
  const stageOne = generated.stages[0]!;
  const entry = stageOne.challenge.givens[0]!.match(/"(.*)"/)![1]!;

  it('does not demand one exact formatting style', () => {
    const variants = [
      `print("${entry}"[::-1])`,
      `entry = "${entry}"\nname = entry[::-1]\nprint(name)`,
      `entry = "${entry}"\nprint("Name:", entry[::-1])`,
      `entry = "${entry}"\nout = ""\nfor c in entry:\n    out = c + out\nprint(f"the log says {out}")`,
      `entry = "${entry}"\nprint("".join(reversed(entry)).lower())`,
    ];
    for (const variant of variants) {
      expect(grader.grade(stageOne.challenge, variant).status, variant).toBe('correct');
    }
  });

  it('accepts 40 and 40.0 alike for numeric answers', () => {
    const stageTwo = generated.stages[1]!;
    const log = stageTwo.challenge.givens[0]!;
    const marker = Number(stageTwo.challenge.givens[1]!.split('=')[1]!.trim());
    const code = `${log}\nposition = sensor_log.index(${marker})\nprint(float(sensor_log[position - 1]))`;
    expect(grader.grade(stageTwo.challenge, code).status).toBe('correct');
  });
});

describe('rejecting wrong answers with useful feedback', () => {
  const { generated } = generateCaseWithReference('CH-FEEDBACK-1', 'rookie');
  const stageOne = generated.stages[0]!;
  const stageTwo = generated.stages[1]!;
  const entry = stageOne.challenge.givens[0]!.match(/"(.*)"/)![1]!;

  it('separates a syntax error from wrong logic', () => {
    const syntax = grader.grade(stageOne.challenge, 'print("hello"');
    expect(syntax.status).toBe('syntax-error');
    expect(syntax.detail).toBeTruthy();

    const logic = grader.grade(stageOne.challenge, 'print("SOMEBODY ELSE")');
    expect(logic.status).toBe('incorrect');
  });

  it('reports a runtime error as its own category', () => {
    const runtime = grader.grade(stageOne.challenge, 'print(unknown_variable)');
    expect(runtime.status).toBe('runtime-error');
    expect(runtime.message).toContain('NameError');
  });

  it('recognises predictable near misses without revealing the answer', () => {
    const untouched = grader.grade(stageOne.challenge, `print("${entry}")`);
    expect(untouched.status).toBe('incorrect');
    expect(untouched.detail).toContain('as written');

    const marker = Number(stageTwo.challenge.givens[1]!.split('=')[1]!.trim());
    const offByOne = grader.grade(stageTwo.challenge, `${stageTwo.challenge.givens[0]}\nprint(${marker})`);
    expect(offByOne.status).toBe('incorrect');
    expect(offByOne.detail).toContain('alarm event');
  });

  it('says so when nothing was printed', () => {
    const silent = grader.grade(stageOne.challenge, `entry = "${entry}"\nname = entry[::-1]`);
    expect(silent.status).toBe('incorrect');
    expect(silent.detail).toContain('print');
  });

  it('treats an empty submission as empty, not as wrong', () => {
    expect(grader.grade(stageOne.challenge, '   ').status).toBe('empty');
  });

  it('never puts the expected answer into its feedback', () => {
    for (const seed of seeds(20, 'CH-NOLEAK-1')) {
      const { generated: c, reference } = generateCaseWithReference(seed, 'detective');
      for (const stage of c.stages) {
        const solution = reference.find((r) => r.stage === stage.index)!;
        const expected = grader.grade(stage.challenge, solution.code).stdout.join(' ').toUpperCase();
        const wrong = grader.grade(stage.challenge, 'print("definitely not it")\nprint(12345)');
        const feedback = `${wrong.message} ${wrong.detail ?? ''}`.toUpperCase();
        for (const token of expected.split(/\s+/).filter((t) => t.length >= 4)) {
          expect(feedback, `${seed}/${stage.index}`).not.toContain(token);
        }
      }
    }
  });
});

describe('function challenges', () => {
  const { generated } = generateCaseWithReference('CH-FUNC-1', 'detective');
  const stageFour = generated.stages[3]!;
  const weights = stageFour.challenge.prompt.match(/× ?([\d.]+)/g)!.map((m) => Number(m.replace(/[^\d.]/g, '')));
  const suspects = generated.suspects;

  it('rejects a hard-coded answer that never defines the function', () => {
    const top = Math.max(
      ...suspects.map((s) => s.stats.opportunity * weights[0]! + s.stats.motive * weights[1]! + s.stats.access * weights[2]!),
    );
    const result = grader.grade(stageFour.challenge, `print(${Number(top.toFixed(4))})`);
    expect(result.status).toBe('incorrect');
    expect(result.message).toContain('suspicion_score');
  });

  it('rejects a function that prints instead of returning', () => {
    const code =
      `def suspicion_score(opportunity, motive, access):\n` +
      `    print(opportunity * ${weights[0]} + motive * ${weights[1]} + access * ${weights[2]})\n` +
      suspects.map((s) => `suspicion_score(${s.stats.opportunity}, ${s.stats.motive}, ${s.stats.access})`).join('\n');
    const result = grader.grade(stageFour.challenge, code);
    expect(result.status).toBe('incorrect');
    expect(result.detail).toContain('return');
  });

  it('catches swapped parameters even when the printed total looks plausible', () => {
    const code =
      `def suspicion_score(opportunity, motive, access):\n` +
      `    return access * ${weights[0]} + motive * ${weights[1]} + opportunity * ${weights[2]}\n` +
      suspects.map((s) => `print(suspicion_score(${s.stats.opportunity}, ${s.stats.motive}, ${s.stats.access}))`).join('\n');
    const result = grader.grade(stageFour.challenge, code);
    expect(result.status).toBe('incorrect');
  });

  it('accepts a differently written but equivalent implementation', () => {
    const code =
      `WEIGHTS = [${weights.join(', ')}]\n` +
      `def suspicion_score(opportunity, motive, access):\n` +
      `    total = 0\n` +
      `    for value, weight in zip([opportunity, motive, access], WEIGHTS):\n` +
      `        total += value * weight\n` +
      `    return total\n` +
      suspects.map((s) => `print("${s.name}", suspicion_score(${s.stats.opportunity}, ${s.stats.motive}, ${s.stats.access}))`).join('\n');
    expect(grader.grade(stageFour.challenge, code).status).toBe('correct');
  });
});

describe('soft concept requirements', () => {
  it('accepts a correct answer written the long way, but says what was skipped', () => {
    const { generated } = generateCaseWithReference('CH-WANTS-1', 'rookie');
    const stageThree = generated.stages[2]!;
    const codes = stageThree.challenge.givens[0]!.match(/\[(.*)\]/)![1]!.split(',').map((n) => Number(n));
    const shift = generated.setting.incidentWindow.start % 10;
    const plain = codes.map((c) => String.fromCharCode(c - shift)).join('');
    const result = grader.grade(stageThree.challenge, `print("${plain}")`);
    expect(result.status).toBe('correct');
    expect(result.detail).toContain('for');
  });
});

describe('grading is not fooled by brute force', () => {
  it('rejects printing every plausible value at once', () => {
    const generated = generateCase('CH-BRUTE-1', 'detective');
    const stageTwo = generated.stages[1]!;
    const spam = `for n in range(70000, 70200):\n    print(n)`;
    expect(grader.grade(stageTwo.challenge, spam).status).toBe('incorrect');
  });
});
