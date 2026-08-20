/**
 * Stage and challenge construction.
 *
 * Every challenge is derived *forward* from facts the generator already fixed:
 * the cipher is produced by encoding the real drop point, the timestamp puzzle
 * is built around the real entry time. Nothing is hand-written, so a generated
 * clue can never contradict the solution the way the old hard-coded Act III
 * did.
 */

import type { Challenge, ChallengeCheck, ConceptId, Difficulty, Stage, Suspect } from '../types.js';
import { saltedHash, sha256 } from './hash.js';
import { normalise } from '../grader/normalize.js';
import type { Rng } from './rng.js';

export const CONCEPT_LABELS: Record<ConceptId, string> = {
  'variables-strings': 'Variables & Strings',
  'lists-indexing': 'Lists & Indexing',
  'loops-ascii': 'Loops & ASCII ciphers',
  functions: 'Functions',
  conditionals: 'Conditionals & deduction',
};

export type NameTransform = 'reverse' | 'rotate' | 'padded-reverse';

/** Everything stage construction needs, all of it already decided and consistent. */
export interface PuzzleInputs {
  rng: Rng;
  salt: string;
  difficulty: Difficulty;
  suspects: Suspect[];
  culprit: Suspect;
  redHerring: Suspect;
  /** Person whose name is scrambled in stage 1. */
  firstLead: Suspect;
  place: string;
  object: string;
  incidentLocation: string;
  /** Where the item was to be handed over; decoded in stage 3. */
  dropLocation: string;
  entryTime: number;
  markerTime: number;
  timestamps: number[];
  /** How many entries before the marker the entry time sits. */
  markerOffset: number;
  weights: [number, number, number];
  lockPuzzle: { limit: number; divisorA: number; divisorB: number; floor: number; want: 'largest' | 'smallest' | 'count' };
  nameTransform: NameTransform;
  rotateBy: number;
  padding: string;
  cipherShift: number;
}

export function secondsToClock(seconds: number): string {
  const h = Math.floor(seconds / 3600) % 24;
  const m = Math.floor(seconds / 60) % 60;
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Builds the hashed check for a challenge. The answer itself is discarded. */
function makeCheck(
  salt: string,
  answer: string,
  options: {
    numeric?: boolean;
    mode?: 'stdout' | 'function';
    functionName?: string;
    probes?: { args: number[]; expected: number }[];
    nearMisses?: { value: string; feedback: string }[];
    wants?: { keyword: string; because: string }[];
  } = {},
): ChallengeCheck {
  const numeric = options.numeric ?? false;
  const canonical = normalise(answer, numeric);
  const check: ChallengeCheck = {
    mode: options.mode ?? 'stdout',
    answerHash: saltedHash(salt, canonical),
    salt,
    numeric,
    nearMisses: (options.nearMisses ?? [])
      .map((miss) => ({ hash: saltedHash(salt, normalise(miss.value, numeric)), feedback: miss.feedback }))
      // A near miss that collides with the answer would hand out the answer.
      .filter((miss) => miss.hash !== saltedHash(salt, canonical)),
    unlockHash: sha256(unlockTokenFor(salt, canonical)),
  };
  if (options.functionName) check.functionName = options.functionName;
  if (options.probes) {
    check.probes = options.probes.map((probe) => ({
      args: probe.args,
      expectHash: saltedHash(salt, normalise(String(probe.expected), true)),
    }));
  }
  if (options.wants) check.wants = options.wants;
  return check;
}

/** The token a correct submission mints. Only its sha256 ships in the case. */
export function unlockTokenFor(salt: string, canonicalAnswer: string): string {
  return saltedHash(`${salt}|unlock`, canonicalAnswer);
}

// ── stage 1: variables & strings ─────────────────────────────────────────
export function scrambleName(name: string, inputs: PuzzleInputs): string {
  const upper = name.toUpperCase();
  switch (inputs.nameTransform) {
    case 'reverse':
      return [...upper].reverse().join('');
    case 'rotate':
      // The last k characters are moved to the front, so the player recovers it
      // with `entry[k:] + entry[:k]` - the taught slice, not a second scramble.
      return upper.slice(-inputs.rotateBy) + upper.slice(0, -inputs.rotateBy);
    case 'padded-reverse':
      return inputs.padding + [...upper].reverse().join('') + inputs.padding;
  }
}

function stageOne(inputs: PuzzleInputs): Stage {
  const answer = inputs.firstLead.name.toUpperCase();
  const scrambled = scrambleName(inputs.firstLead.name, inputs);
  const padLength = inputs.padding.length;

  const explanation: Record<NameTransform, string> = {
    reverse: 'The letters are in reverse order. `text[::-1]` walks a string backwards.',
    rotate: `The last ${inputs.rotateBy} characters were cut off and pasted at the front. Slice the two halves and swap them back: \`text[${inputs.rotateBy}:] + text[:${inputs.rotateBy}]\`.`,
    'padded-reverse': `The entry is padded with \`${inputs.padding}\` at both ends, and the rest is reversed. Slice the padding off first, then reverse.`,
  };

  const hints: Record<NameTransform, string> = {
    reverse: 'entry = "..."\nprint(entry[::-1])',
    rotate: `entry = "..."\nprint(entry[${inputs.rotateBy}:] + entry[:${inputs.rotateBy}])`,
    'padded-reverse': `entry = "..."\ncore = entry[${padLength}:-${padLength}]\nprint(core[::-1])`,
  };

  const nearMisses = [
    { value: scrambled, feedback: 'That is the entry exactly as written. It still needs to be untangled.' },
    { value: inputs.firstLead.name.split(' ')[0] ?? '', feedback: 'That is only part of the name - recover the whole entry.' },
  ];
  if (inputs.nameTransform === 'padded-reverse') {
    nearMisses.push({
      value: [...scrambled].reverse().join(''),
      feedback: 'Close - you reversed it, but the padding characters are still attached.',
    });
  }

  const challenge: Challenge = {
    concept: 'variables-strings',
    lesson: [
      'A variable is a name you attach to a value: `word = "DRAWKCAB"`. Nothing is stored twice; the name simply points at the text.',
      'Strings can be sliced with `text[start:stop:step]`. Leave a slot empty to mean "from the beginning" or "to the end", and use a negative step to walk backwards.',
      explanation[inputs.nameTransform],
    ],
    prompt: `Recover the real name written in the visitor log and print it.`,
    givens: [`entry = "${scrambled}"`],
    starterCode: `entry = "${scrambled}"\n# untangle the entry, then print the real name\n`,
    hints: [
      'Start by storing the entry in a variable, then print the variable to see what you have.',
      hints[inputs.nameTransform],
    ],
    check: makeCheck(inputs.salt, answer, { nearMisses }),
  };

  return {
    index: 1,
    title: 'The Signature That Reads Backwards',
    concept: 'variables-strings',
    conceptLabel: CONCEPT_LABELS['variables-strings'],
    story: [
      `The item is gone from ${inputs.incidentLocation}, and the first thing worth having is the visitor log by the door.`,
      `One line was filled in by hand and does not read as any name on the staff list: “${scrambled}”. Whoever wrote it was pleased with themselves.`,
    ],
    challenge,
    branch: {
      key: `stage1.identified:${inputs.firstLead.id}`,
      outcome: `${inputs.firstLead.name}, ${inputs.firstLead.role}. Signed in and, according to the log, never signed out.`,
      implicates: [inputs.firstLead.id],
      exonerates: [],
      revealsClues: ['clue-log', 'clue-motive-lead'],
    },
  };
}

// ── stage 2: lists & indexing ────────────────────────────────────────────
function stageTwo(inputs: PuzzleInputs): Stage {
  const answer = String(inputs.entryTime);
  const markerIndex = inputs.timestamps.indexOf(inputs.markerTime);
  const before = inputs.timestamps[markerIndex - inputs.markerOffset - 1];
  const after = inputs.timestamps[markerIndex - inputs.markerOffset + 1];

  const nearMisses = [
    { value: String(inputs.markerTime), feedback: 'That is the alarm event itself. You need the entry that comes before it.' },
    ...(before === undefined ? [] : [{ value: String(before), feedback: 'One entry too early - count the offset again.' }]),
    ...(after === undefined ? [] : [{ value: String(after), feedback: 'One entry too late - count the offset again.' }]),
    { value: String(markerIndex), feedback: 'That is the position in the list, not the timestamp stored there.' },
  ];

  const challenge: Challenge = {
    concept: 'lists-indexing',
    lesson: [
      'A list holds values in order: `readings = [10, 20, 30]`. Positions count from 0, so `readings[0]` is 10.',
      '`readings.index(20)` searches the list and gives back the position where it found the value - 1 here.',
      'Once you have a position you can do arithmetic with it: `readings[i - 1]` is the entry immediately before position `i`.',
      'Negative positions count from the end, so `readings[-1]` is the last entry.',
    ],
    prompt: `The alarm loop was cut at second ${inputs.markerTime}. The intruder tripped the door sensor ${inputs.markerOffset} ${inputs.markerOffset === 1 ? 'entry' : 'entries'} earlier in the same log. Print that timestamp.`,
    givens: [`sensor_log = [${inputs.timestamps.join(', ')}]`, `alarm_cut = ${inputs.markerTime}`],
    starterCode: `sensor_log = [${inputs.timestamps.join(', ')}]\nalarm_cut = ${inputs.markerTime}\n# find where the alarm sits, then step back ${inputs.markerOffset}\n`,
    hints: [
      'Ask the list where the alarm value is: `position = sensor_log.index(alarm_cut)`.',
      `position = sensor_log.index(alarm_cut)\nprint(sensor_log[position - ${inputs.markerOffset}])`,
    ],
    check: makeCheck(inputs.salt, answer, { numeric: true, nearMisses }),
  };

  return {
    index: 2,
    title: 'A Gap in the Sensor Log',
    concept: 'lists-indexing',
    conceptLabel: CONCEPT_LABELS['lists-indexing'],
    story: [
      `Every door in ${inputs.place} writes a line to the same log, in seconds past midnight, in order.`,
      'The alarm loop was cut cleanly. Whoever did it walked in first and was already inside when it went quiet.',
    ],
    challenge,
    branch: {
      key: `stage2.window:${inputs.entryTime}`,
      outcome: `Entry at ${secondsToClock(inputs.entryTime)}. Anyone who can account for that minute in front of a witness is no longer your problem.`,
      implicates: [],
      exonerates: [],
      revealsClues: ['clue-window'],
    },
  };
}

// ── stage 3: loops & ASCII ───────────────────────────────────────────────
export function encodeCipher(plain: string, shift: number): number[] {
  return [...plain].map((ch) => ch.charCodeAt(0) + shift);
}

function stageThree(inputs: PuzzleInputs): Stage {
  const plain = inputs.dropLocation.toUpperCase().replace(/[^A-Z]/g, '');
  const codes = encodeCipher(plain, inputs.cipherShift);
  const wrongDirection = codes.map((code) => String.fromCharCode(code + inputs.cipherShift)).join('');
  const rawCodes = codes.map((code) => String.fromCharCode(code)).join('');

  const shiftIsGiven = inputs.difficulty === 'rookie';
  const shiftSentence = shiftIsGiven
    ? `Each number is an ASCII code with **${inputs.cipherShift}** added to it.`
    : `Each number is an ASCII code with a fixed amount added. The amount is the **last digit of the entry timestamp** you recovered in the previous stage.`;

  const challenge: Challenge = {
    concept: 'loops-ascii',
    lesson: [
      'Every character has a number. `ord("A")` is 65, and `chr(65)` gives back `"A"`. That pairing is all a shift cipher is.',
      'A `for` loop visits each item in turn: `for code in codes:` runs the indented body once per number.',
      'Build the answer up as you go. Start with `message = ""` and add to it with `message += chr(...)` inside the loop.',
      shiftIsGiven
        ? 'Subtract the shift before converting, not after.'
        : 'Work the shift out first, store it in a variable, and use that variable inside the loop.',
    ],
    prompt: 'Decode the intercepted numbers and print the message.',
    givens: [`codes = [${codes.join(', ')}]`],
    starterCode: `codes = [${codes.join(', ')}]\nmessage = ""\nfor code in codes:\n    # convert each code back to a letter\n    pass\nprint(message)\n`,
    hints: [
      'Try one number first: `print(chr(codes[0] - shift))`. If that letter looks like the start of a word, the rest will follow.',
      `shift = ${shiftIsGiven ? inputs.cipherShift : `${inputs.entryTime} % 10`}\nmessage = ""\nfor code in codes:\n    message += chr(code - shift)\nprint(message)`,
    ],
    check: makeCheck(inputs.salt, plain, {
      nearMisses: [
        { value: wrongDirection, feedback: 'You shifted the wrong way. The numbers had the shift added, so take it off.' },
        { value: rawCodes, feedback: 'Those are the raw codes converted straight to characters - the shift is still in them.' },
        { value: [...plain].reverse().join(''), feedback: 'Right letters, wrong order - this cipher is not reversed.' },
      ],
      wants: [{ keyword: 'for', because: 'the point of this stage is doing it with a loop rather than by hand' }],
    }),
  };

  return {
    index: 3,
    title: 'Numbers Where Words Should Be',
    concept: 'loops-ascii',
    conceptLabel: CONCEPT_LABELS['loops-ascii'],
    story: [
      `A message was sent from inside ${inputs.place} four minutes after the entry. It is a list of numbers and nothing else.`,
      shiftSentence.replace(/\*\*/g, ''),
    ],
    challenge,
    branch: {
      key: `stage3.drop:${plain}`,
      outcome: `The message names a place inside the building: ${inputs.dropLocation}. That is where the handover was meant to happen.`,
      implicates: [],
      exonerates: [],
      revealsClues: ['clue-drop', 'clue-access'],
    },
  };
}

// ── stage 4: functions ───────────────────────────────────────────────────
function stageFour(inputs: PuzzleInputs): Stage {
  const [wOpportunity, wMotive, wAccess] = inputs.weights;
  const score = (s: Suspect): number =>
    Number((s.stats.opportunity * wOpportunity + s.stats.motive * wMotive + s.stats.access * wAccess).toFixed(4));

  const ranked = [...inputs.suspects].sort((a, b) => score(b) - score(a));
  const top = ranked[0] as Suspect;
  const probeRng = inputs.rng;
  const probes = Array.from({ length: 4 }, () => {
    const args: [number, number, number] = [probeRng.int(0, 10), probeRng.int(0, 10), probeRng.int(0, 10)];
    return {
      args: args as number[],
      expected: Number((args[0] * wOpportunity + args[1] * wMotive + args[2] * wAccess).toFixed(4)),
    };
  });

  const table = inputs.suspects
    .map((s) => `${s.name.padEnd(18)} ${String(s.stats.opportunity).padStart(2)}  ${String(s.stats.motive).padStart(2)}  ${String(s.stats.access).padStart(2)}`)
    .join('\n');

  const challenge: Challenge = {
    concept: 'functions',
    lesson: [
      'A function packages a calculation under a name so you can run it many times without repeating yourself.',
      '`def suspicion_score(opportunity, motive, access):` starts the definition. The names in the brackets are the values the caller will hand in.',
      '`return` sends a value back. A function that only prints cannot be used in further arithmetic - `return` can.',
      'Call it once per suspect and compare what comes back.',
    ],
    prompt:
      `Write a function called \`suspicion_score(opportunity, motive, access)\` that returns ` +
      `opportunity × ${wOpportunity} + motive × ${wMotive} + access × ${wAccess}, then use it to score every suspect.`,
    givens: [
      `# opportunity, motive, access - each scored 0 to 10\n${table}`,
      `weights: opportunity ×${wOpportunity}, motive ×${wMotive}, access ×${wAccess}`,
    ],
    starterCode:
      `def suspicion_score(opportunity, motive, access):\n    # return the weighted total\n    pass\n\n` +
      inputs.suspects
        .map((s) => `print("${s.name}", suspicion_score(${s.stats.opportunity}, ${s.stats.motive}, ${s.stats.access}))`)
        .join('\n') + '\n',
    hints: [
      'The body is one line: multiply each argument by its weight and `return` the total.',
      `def suspicion_score(opportunity, motive, access):\n    return opportunity * ${wOpportunity} + motive * ${wMotive} + access * ${wAccess}`,
    ],
    check: makeCheck(inputs.salt, String(score(top)), {
      mode: 'function',
      numeric: true,
      functionName: 'suspicion_score',
      probes,
      wants: [{ keyword: 'def', because: 'this stage is about defining a function, not computing the numbers by hand' }],
      nearMisses: [
        {
          value: String(
            Number((top.stats.opportunity + top.stats.motive + top.stats.access).toFixed(4)),
          ),
          feedback: 'That is the plain total. Each axis carries a different weight.',
        },
      ],
    }),
  };

  return {
    index: 4,
    title: 'The Weighting Model',
    concept: 'functions',
    conceptLabel: CONCEPT_LABELS.functions,
    story: [
      'The insurer will not act on a hunch. They score every person against the same three axes and act on the number.',
      'The formula is theirs. Implement it once, apply it to everyone, and let the ranking fall where it falls.',
    ],
    challenge,
    branch: {
      key: `stage4.top:${top.id}`,
      outcome: `The model puts ${top.name} at the top with ${score(top)}. A number is not a confession, but it decides where you look next.`,
      implicates: [top.id],
      exonerates: [],
      revealsClues: ['clue-score'],
    },
  };
}

// ── stage 5: conditionals ────────────────────────────────────────────────
function lockAnswer(puzzle: PuzzleInputs['lockPuzzle']): number {
  const matches: number[] = [];
  for (let n = 1; n <= puzzle.limit; n++) {
    if (n % puzzle.divisorA === 0 && n % puzzle.divisorB === 0 && n > puzzle.floor) matches.push(n);
  }
  if (puzzle.want === 'count') return matches.length;
  return (puzzle.want === 'largest' ? matches[matches.length - 1] : matches[0]) as number;
}

function stageFive(inputs: PuzzleInputs): Stage {
  const puzzle = inputs.lockPuzzle;
  const answer = lockAnswer(puzzle);
  const matches: number[] = [];
  for (let n = 1; n <= puzzle.limit; n++) {
    if (n % puzzle.divisorA === 0 && n % puzzle.divisorB === 0 && n > puzzle.floor) matches.push(n);
  }
  const ignoringFloor: number[] = [];
  for (let n = 1; n <= puzzle.limit; n++) {
    if (n % puzzle.divisorA === 0 && n % puzzle.divisorB === 0) ignoringFloor.push(n);
  }

  const wantWord = puzzle.want === 'count' ? 'how many numbers match' : `the ${puzzle.want} matching number`;

  const nearMisses = [
    { value: String(matches.length), feedback: 'That is how many numbers match, not which one they asked for.' },
    ...(puzzle.want === 'largest' && matches[0] !== undefined
      ? [{ value: String(matches[0]), feedback: 'That is the smallest match. Read the last rule again.' }]
      : []),
    ...(puzzle.want === 'smallest' && matches.length > 0
      ? [{ value: String(matches[matches.length - 1]), feedback: 'That is the largest match. Read the last rule again.' }]
      : []),
    ...(ignoringFloor[0] !== undefined && ignoringFloor[0] !== answer
      ? [{ value: String(ignoringFloor[0]), feedback: `That satisfies both divisions but ignores the "greater than ${puzzle.floor}" rule.` }]
      : []),
  ];

  const challenge: Challenge = {
    concept: 'conditionals',
    lesson: [
      '`if` runs a block only when a condition holds. `and` requires every part to be true at once.',
      '`n % 7 == 0` reads as "n divides by 7 with nothing left over" - the remainder operator is how you test divisibility.',
      'Collect what survives the test rather than printing as you go: `matches = []` before the loop, `matches.append(n)` inside it.',
      '`max(matches)`, `min(matches)` and `len(matches)` each answer a different question about the same list.',
    ],
    prompt:
      `The lock takes one number. It is at most ${puzzle.limit}, divides exactly by both ${puzzle.divisorA} and ${puzzle.divisorB}, ` +
      `and is greater than ${puzzle.floor}. Print ${wantWord}.`,
    givens: [
      `# the three rules, in order\n# 1. between 1 and ${puzzle.limit}\n# 2. divisible by ${puzzle.divisorA} and by ${puzzle.divisorB}\n# 3. greater than ${puzzle.floor}`,
    ],
    starterCode: `matches = []\nfor n in range(1, ${puzzle.limit + 1}):\n    # keep the numbers that pass all three rules\n    pass\nprint(matches)\n`,
    hints: [
      'Loop over the range first and print every number that passes, then narrow down to the one they asked for.',
      `matches = []\nfor n in range(1, ${puzzle.limit + 1}):\n    if n % ${puzzle.divisorA} == 0 and n % ${puzzle.divisorB} == 0 and n > ${puzzle.floor}:\n        matches.append(n)\nprint(${puzzle.want === 'count' ? 'len(matches)' : puzzle.want === 'largest' ? 'max(matches)' : 'min(matches)'})`,
    ],
    check: makeCheck(inputs.salt, String(answer), {
      numeric: true,
      nearMisses,
      wants: [{ keyword: 'if', because: 'the stage is about filtering with a condition' }],
    }),
  };

  return {
    index: 5,
    title: 'The Last Locked Thing',
    concept: 'conditionals',
    conceptLabel: CONCEPT_LABELS.conditionals,
    story: [
      `Whatever was taken from ${inputs.place} was meant to leave through ${inputs.dropLocation}, and it is still there, behind a numeric lock.`,
      'The number was never written down. It was described - three rules, and exactly one answer that satisfies all of them.',
    ],
    challenge,
    branch: {
      key: `stage5.lock:${answer}`,
      outcome: 'The lock opens. What is inside settles the last of it - and clears one of the two people still standing.',
      implicates: [],
      exonerates: [inputs.redHerring.id],
      revealsClues: ['clue-exoneration', 'clue-method'],
    },
  };
}

export function buildStages(inputs: PuzzleInputs): Stage[] {
  return [stageOne(inputs), stageTwo(inputs), stageThree(inputs), stageFour(inputs), stageFive(inputs)];
}

export { lockAnswer };

/**
 * Python that solves each stage of a case, generated from the same inputs as
 * the stages themselves.
 *
 * This exists so the test suite can prove a generated case is solvable by
 * actually solving it: the reference code is run through the real interpreter
 * and fed to the real grader. It is not shipped to the player, and it is
 * derived rather than stored, so no answer literal is written down anywhere.
 */
export function buildReferenceSolutions(inputs: PuzzleInputs): { stage: number; code: string }[] {
  const scrambled = scrambleName(inputs.firstLead.name, inputs);
  const padLength = inputs.padding.length;
  const stageOneBody: Record<NameTransform, string> = {
    reverse: 'print(entry[::-1])',
    rotate: `print(entry[${inputs.rotateBy}:] + entry[:${inputs.rotateBy}])`,
    'padded-reverse': `print(entry[${padLength}:-${padLength}][::-1])`,
  };

  const [wOpportunity, wMotive, wAccess] = inputs.weights;
  const puzzle = inputs.lockPuzzle;
  const pick =
    puzzle.want === 'count' ? 'len(matches)' : puzzle.want === 'largest' ? 'max(matches)' : 'min(matches)';

  return [
    { stage: 1, code: `entry = "${scrambled}"\n${stageOneBody[inputs.nameTransform]}` },
    {
      stage: 2,
      code:
        `sensor_log = [${inputs.timestamps.join(', ')}]\n` +
        `position = sensor_log.index(${inputs.markerTime})\n` +
        `print(sensor_log[position - ${inputs.markerOffset}])`,
    },
    {
      stage: 3,
      code:
        `codes = [${encodeCipher(inputs.dropLocation.toUpperCase().replace(/[^A-Z]/g, ''), inputs.cipherShift).join(', ')}]\n` +
        `shift = ${inputs.entryTime} % 10\n` +
        'message = ""\n' +
        'for code in codes:\n' +
        '    message += chr(code - shift)\n' +
        'print(message)',
    },
    {
      stage: 4,
      code:
        'def suspicion_score(opportunity, motive, access):\n' +
        `    return opportunity * ${wOpportunity} + motive * ${wMotive} + access * ${wAccess}\n\n` +
        inputs.suspects
          .map((s) => `print("${s.name}", suspicion_score(${s.stats.opportunity}, ${s.stats.motive}, ${s.stats.access}))`)
          .join('\n'),
    },
    {
      stage: 5,
      code:
        'matches = []\n' +
        `for n in range(1, ${puzzle.limit + 1}):\n` +
        `    if n % ${puzzle.divisorA} == 0 and n % ${puzzle.divisorB} == 0 and n > ${puzzle.floor}:\n` +
        '        matches.append(n)\n' +
        `print(${pick})`,
    },
  ];
}
