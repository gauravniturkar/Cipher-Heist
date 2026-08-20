/**
 * Submission grading.
 *
 * Safety: player code runs in the interpreter in `python/`, which has no eval,
 * no host globals and a hard execution budget. Grading itself never runs
 * anything but that interpreter.
 *
 * Answers: the grader never holds the expected answer. It hashes what the
 * player produced and compares hashes, so no answer string is present in the
 * shipped source, in the DOM, or in saved state.
 *
 * Honest limitation: this is a client-only game. A determined player can read
 * the bundle and re-derive a case from its seed. Hashing stops casual answer
 * lookup and stops progression being flipped from the console; it is not a
 * server-side guarantee. `GradingClient` below is the seam where a real
 * backend would take over - implement it against an API and the UI is unchanged.
 */

import type { Challenge, GradeResult } from '../types.js';
import { saltedHash } from '../engine/hash.js';
import { unlockTokenFor } from '../engine/challenges.js';
import { DEFAULT_BUDGET, Interpreter, type Budget } from '../python/interpreter.js';
import { isFunction, pyStr, type PyValue } from '../python/values.js';
import { answerCandidates, normalise } from './normalize.js';

export interface GradingClient {
  grade(challenge: Challenge, source: string): GradeResult;
}

const MAX_SOURCE_LENGTH = 20_000;

export class LocalGrader implements GradingClient {
  constructor(private readonly budget: Budget = DEFAULT_BUDGET) {}

  grade(challenge: Challenge, source: string): GradeResult {
    if (source.trim() === '') {
      return {
        status: 'empty',
        message: 'Nothing to run yet.',
        detail: 'Write some Python in the editor, then run it.',
        stdout: [],
      };
    }
    if (source.length > MAX_SOURCE_LENGTH) {
      return {
        status: 'syntax-error',
        message: 'That program is too long for this terminal.',
        stdout: [],
      };
    }

    const interpreter = new Interpreter(this.budget);
    const run = interpreter.run(source);

    if (run.error) {
      const isSyntax = run.error.kind === 'SyntaxError';
      return {
        status: isSyntax ? 'syntax-error' : 'runtime-error',
        message: run.error.format(),
        detail: isSyntax
          ? explainSyntax(run.error.message)
          : explainRuntime(run.error.kind, run.error.message),
        stdout: run.stdout,
        line: run.error.line,
      };
    }

    return challenge.check.mode === 'function'
      ? this.gradeFunction(challenge, source, run.stdout, run.globals, interpreter)
      : this.gradeStdout(challenge, source, run.stdout);
  }

  // ── stdout challenges ────────────────────────────────────────────────
  private gradeStdout(challenge: Challenge, source: string, stdout: string[]): GradeResult {
    const { check } = challenge;
    const candidates = answerCandidates(stdout, check.numeric ?? false);

    if (stdout.length === 0) {
      return {
        status: 'incorrect',
        message: 'Your code ran, but it never printed anything.',
        detail: 'Whatever you worked out has to reach the page: wrap the result in print(...).',
        stdout,
      };
    }

    for (const candidate of candidates) {
      if (saltedHash(check.salt, candidate) === check.answerHash) {
        return {
          status: 'correct',
          message: 'That matches the evidence.',
          detail: missingWants(challenge, source),
          stdout,
          unlockToken: unlockTokenFor(check.salt, candidate),
        };
      }
    }

    return {
      status: 'incorrect',
      message: 'That runs cleanly, but it is not what the evidence says.',
      detail: nearMissFeedback(challenge, candidates) ?? genericNudge(challenge, stdout),
      stdout,
    };
  }

  // ── function challenges ──────────────────────────────────────────────
  private gradeFunction(
    challenge: Challenge,
    source: string,
    stdout: string[],
    globals: Record<string, PyValue>,
    interpreter: Interpreter,
  ): GradeResult {
    const { check } = challenge;
    const name = check.functionName as string;
    const defined = globals[name];

    if (defined === undefined) {
      return {
        status: 'incorrect',
        message: `No function called ${name} was defined.`,
        detail: `Start with: def ${name}(...): and give it the parameters the brief asks for.`,
        stdout,
      };
    }
    if (!isFunction(defined)) {
      return {
        status: 'incorrect',
        message: `${name} is a variable here, not a function.`,
        detail: `Define it with def ${name}(...): so it can be called with different values.`,
        stdout,
      };
    }

    // Hidden probes: a hard-coded print cannot satisfy them, and any correct
    // implementation can, whatever style it is written in.
    for (const probe of check.probes ?? []) {
      let produced: PyValue;
      try {
        produced = defined.call(probe.args as PyValue[], 1);
      } catch (error) {
        return {
          status: 'runtime-error',
          message: `${name}(${probe.args.join(', ')}) raised an error.`,
          detail: error instanceof Error ? error.message : 'The function did not survive being called.',
          stdout,
        };
      }
      if (produced === null) {
        return {
          status: 'incorrect',
          message: `${name}() does not return anything.`,
          detail: 'Printing inside the function is not the same as returning. Use return so the value can be used.',
          stdout,
        };
      }
      if (typeof produced !== 'number') {
        return {
          status: 'incorrect',
          message: `${name}() returned ${pyStr(produced)}, which is not a number.`,
          detail: 'The weighting model produces a numeric score.',
          stdout,
        };
      }
      if (saltedHash(check.salt, normalise(String(Number(produced.toFixed(4))), true)) !== probe.expectHash) {
        return {
          status: 'incorrect',
          message: `${name}() gives the wrong total for at least one set of values.`,
          detail:
            'Check each weight against the brief, and check you have not swapped two of the parameters ' +
            'around. The order in the definition is the order the caller uses.',
          stdout,
        };
      }
    }

    // The function is right; the stage also asks for the ranking to be printed.
    const candidates = answerCandidates(stdout, true);
    for (const candidate of candidates) {
      if (saltedHash(check.salt, candidate) === check.answerHash) {
        return {
          status: 'correct',
          message: 'The model checks out, and the top score is on the page.',
          detail: missingWants(challenge, source),
          stdout,
          unlockToken: unlockTokenFor(check.salt, candidate),
        };
      }
    }

    void interpreter;
    return {
      status: 'incorrect',
      message: `${name}() is correct — now print the scores.`,
      detail: 'Call it once for every suspect and print what comes back. The highest score is what the stage wants.',
      stdout,
    };
  }
}

/** Matches the submission against known wrong turns, without revealing the answer. */
function nearMissFeedback(challenge: Challenge, candidates: string[]): string | undefined {
  for (const miss of challenge.check.nearMisses) {
    for (const candidate of candidates) {
      if (saltedHash(challenge.check.salt, candidate) === miss.hash) return miss.feedback;
    }
  }
  return undefined;
}

/** Nudges based on the shape of the output rather than its value. */
function genericNudge(challenge: Challenge, stdout: string[]): string {
  const printed = stdout.join('\n');
  if (challenge.check.numeric && !/\d/.test(printed)) {
    return 'This stage wants a number, and nothing you printed contains one.';
  }
  if (!challenge.check.numeric && /^[\d\s.,-]+$/.test(printed.trim())) {
    return 'This stage wants text, and you have printed only numbers. Convert them back to characters.';
  }
  if (printed.includes('None')) {
    return 'Something printed None, which usually means a function ended without returning a value.';
  }
  if (stdout.length > 12) {
    return 'You are printing a lot. Narrow it down to the single value the stage asks for.';
  }
  return 'Re-read the evidence panel: the brief names exactly which value to produce.';
}

/** Soft concept requirements: reported alongside a correct answer, never blocking. */
function missingWants(challenge: Challenge, source: string): string | undefined {
  const missing = (challenge.check.wants ?? []).filter(
    (want) => !new RegExp(`(^|[^\\w])${want.keyword}([^\\w]|$)`, 'm').test(source),
  );
  if (missing.length === 0) return undefined;
  const first = missing[0] as { keyword: string; because: string };
  return `Solved — though you got there without \`${first.keyword}\`, and ${first.because}.`;
}

function explainSyntax(message: string): string {
  if (message.includes("':'")) return 'Lines that open a block — if, for, while, def — end with a colon.';
  if (message.includes('indent')) return 'Python uses indentation to show what is inside a block. Keep it to four spaces per level, consistently.';
  if (message.includes('unterminated string')) return 'A quote was opened and never closed.';
  if (message.includes('unclosed bracket')) return 'Count your brackets — every ( and [ needs its partner.';
  return 'Python could not read this as code. Nothing ran, so the error is in the writing rather than the logic.';
}

function explainRuntime(kind: string, message: string): string {
  switch (kind) {
    case 'NameError':
      return 'Python reached a name it has never been given a value for. Check for a typo, or assign it before you use it.';
    case 'TypeError':
      return 'Two values of different kinds met an operator that cannot join them — often a number and a piece of text.';
    case 'IndexError':
      return 'A position outside the list was asked for. Remember positions start at 0, so the last one is len(list) - 1.';
    case 'ZeroDivisionError':
      return 'Something divided by zero. Check the value on the right of the / or %.';
    case 'ExecutionLimit':
      return 'The program was stopped for its own good. Look for a loop with no way out, or a range far larger than it needs to be.';
    case 'AttributeError':
      return 'That method does not exist on this kind of value.';
    default:
      return message;
  }
}
