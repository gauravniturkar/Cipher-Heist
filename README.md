# Cipher Heist

### *A procedural Python mystery. Every case is generated.*

---

> *Something is missing. Four people were in the building.*
> *One of them cannot account for the minutes that matter.*
>
> **Python is how you find out which one.**

---

## What this is

Cipher Heist generates a complete criminal case from a seed — the setting, the suspects,
their motives and relationships, a timeline, clues, red herrings, and one hidden solution —
then locks each stage of the investigation behind a Python problem built out of that case's
own facts.

Solve the problem, the stage opens and the evidence file grows. Get it wrong and you get
feedback that tells you *why*, not just *no*.

Every case is different. The same seed always produces the same case, so a seed can be shared.

```
CH-2BNM-7HFP  →  a night train, a missing ledger, four suspects, and a cipher
                 that decodes to ENGINECAB
CH-QW5T-ZJ3D  →  an Arctic research station, a wiped data archive, five suspects,
                 and a handover point in the GENERATORBAY
```

---

## Five stages, five concepts

| Stage | Concept | What the case asks of you |
|-------|---------|---------------------------|
| 1 | Variables & strings | Untangle a scrambled entry in the visitor log |
| 2 | Lists & indexing | Find the entry time hidden in a sensor log |
| 3 | Loops & ASCII (`chr`/`ord`) | Decode an intercepted message |
| 4 | Functions | Implement the insurer's weighting model and rank everyone |
| 5 | Conditionals | Open a numeric lock described only by its rules |

The stages are fixed; everything inside them is generated. Stage 2's answer feeds stage 3's
cipher shift on the harder difficulties, so the investigation actually chains together.

Then you name someone. The evidence supports exactly one answer.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run build        # → dist/index.html, one self-contained file, no runtime deps
open dist/index.html
```

```bash
npm run verify       # lint + typecheck + tests + build
```

Deploy `dist/index.html` anywhere that serves a file. GitHub Pages works with no configuration.

---

## How it is put together

```
src/
├── types.ts               Case, Suspect, Clue, Stage, Challenge, Branch, Progress, Result
├── engine/                generation and rules — no DOM anywhere in here
│   ├── rng.ts             seeded PRNG (mulberry32); no Math.random in generation
│   ├── seed.ts            CH-XXXX-XXXX seed codec, tolerant of how people type
│   ├── generator.ts       builds a case, truth first, clues second
│   ├── challenges.ts      derives the five stages from that truth
│   ├── solver.ts          deduces the culprit from public clues only
│   ├── validate.ts        structural invariants + solvability
│   ├── progress.ts        stage unlocking, branches, accusation
│   ├── storage.ts         localStorage, defensively
│   └── data/pools.ts      structured content templates
├── python/                the Python subset: lexer → parser → AST → interpreter
├── grader/                submission grading and answer normalisation
└── ui/                    screens; owns no game rules
```

**Generation is forward-derived.** The generator decides who did it, when they entered and
where the handover was to happen — *then* encodes the cipher from the real drop point and
builds the sensor log around the real entry time. A generated clue cannot contradict the
solution, because every clue is computed from it.

**Two independent lines of deduction** are built into every case and must agree:
who cannot be placed elsewhere for the whole incident window, and who holds a credential for
the room the decoded message names. `validateCase()` runs both and rejects any case where
they disagree or leave more than one person standing.

---

## The Python interpreter

Written from scratch in TypeScript: a tokeniser that emits INDENT/DEDENT, a recursive-descent
parser, and a tree-walking interpreter. Parsing is a separate phase, which is what lets the
grader distinguish *"this does not parse"* from *"this ran and gave the wrong answer"*.

Supported: variables, strings and slicing, f-strings, lists, dicts, tuples, indexing,
arithmetic (`//`, `%`, `**`), comparisons and chaining, `and`/`or`/`not`, `if`/`elif`/`else`,
`for`/`while` with `break`/`continue`, `def` with defaults and recursion, list comprehensions,
conditional expressions, and 26 builtins including `chr`, `ord`, `range`, `enumerate` and `zip`.

Not supported: imports, classes, generators, exceptions, `global`/`nonlocal`, sets as a
distinct type. Numbers have no int/float tag, so `10 / 2` prints `5` where CPython prints `5.0`
— grading normalises numbers, so this never affects whether an answer is accepted.

### Safety

- **No `eval`, no `new Function`, no host globals.** Player code can reach its own variables
  and the listed builtins, and nothing else. `window`, `document`, `fetch`, `localStorage` and
  `constructor` all raise `NameError`. Lint forbids the escape hatches; tests assert the rest.
- **Hard execution budget.** 400k steps, 2 seconds, 400 output lines, 60 call frames, 20k
  collection elements. `while True:`, `range(10**8)` and runaway recursion all stop with an
  `ExecutionLimit` error instead of freezing the tab.

### What the grader does

- Compares **hashes**, never answers: expected answers exist only as salted SHA-256 digests,
  so no answer string is in the shipped source, the DOM or saved state.
- Accepts equivalent solutions. `print(name)`, `print("Name:", name)` and an f-string all pass;
  `40` and `40.0` are the same answer.
- Grades stage 4 by calling your function with **hidden probe arguments**, so a hard-coded
  `print` cannot pass and any correct implementation can.
- Recognises predictable wrong turns — shifting a cipher the wrong way, landing one index
  early — and says so, without revealing the answer.
- Stage progression is derived from **unlock tokens** minted by correct submissions. Editing
  saved state, or flipping a flag from the console, unlocks nothing: a stage without a token
  whose hash matches re-locks the moment state is recomputed.

**Honest limitation.** This is a client-only game. Everything needed to regenerate a case
from its seed ships in the bundle, so a determined player can always dig the answer out.
Hashing prevents casual answer-lookup and state tampering; it is not server-side enforcement.
`GradingClient` in `src/grader/grader.ts` is the seam where a real backend would take over —
implement that one interface against an API and the UI does not change.

---

## Tests

```bash
npm test
```

93 tests across six suites:

- **hash** — SHA-256 checked against Node's `crypto`
- **interpreter** — language behaviour, error taxonomy, execution budget, sandbox escapes
- **generator** — determinism, variety across 120 seeds, structural invariants over 240
  generated cases, no culprit leaks in early clues
- **grader** — every stage of 75 generated cases solved by generated reference code,
  equivalent solutions accepted, wrong answers rejected with useful feedback, and an
  assertion that no feedback string ever contains the answer
- **progress** — locking, forged and stolen unlock tokens, branch recording, actions
- **ui** — the real app driven through the DOM: playthroughs, locked stages, feedback
  categories, hints, persistence, corrupted saves, replay, keyboard use, Home, theming

---

## Getting around

A **Home** button sits in the top bar of every investigation and returns you to the case file
without discarding anything — the save is kept, and the opening screen offers it back as
*Resume*. Starting a different seed is what overwrites it. "Restart this case" in the stage
rail replays the same seed from stage one.

**Light and dark.** The game is designed dark, but the ☾/☀ control on every screen switches to
a light archival palette and the choice is remembered. With nothing chosen it follows your
system preference, falling back to dark.

---

## Accessibility and responsiveness

Real buttons and tabs with `aria-selected` / `aria-current` / `aria-disabled`, a visible focus
ring on everything focusable, `aria-live` feedback, and an editor you can leave with `Escape`.
Three columns on desktop; on narrow screens the layout stacks and a bottom tab bar switches
between the case file and the Python panel. Verified with no horizontal overflow at 320, 375,
430, 768, 1024 and 1440 pixels.

---

## License

MIT — see [LICENSE](LICENSE).
