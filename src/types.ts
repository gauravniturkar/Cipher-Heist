/**
 * Core data model for Cipher Heist.
 *
 * Everything below is produced by the seeded generator in `engine/generator.ts`
 * and consumed by the UI. Generation logic never imports from `ui/`.
 */

export type Difficulty = 'rookie' | 'detective' | 'inspector';

export const DIFFICULTIES: readonly Difficulty[] = ['rookie', 'detective', 'inspector'];

/** Python concept taught by a stage. Stage order is fixed; content is not. */
export type ConceptId =
  | 'variables-strings'
  | 'lists-indexing'
  | 'loops-ascii'
  | 'functions'
  | 'conditionals';

export type RelationKind =
  | 'rivals'
  | 'owes-money'
  | 'former-partners'
  | 'siblings'
  | 'mentor'
  | 'protecting';

export interface Relationship {
  /** Suspect id. */
  from: string;
  /** Suspect id. */
  to: string;
  kind: RelationKind;
  /** Player-facing sentence, pre-rendered as plain text (never HTML). */
  note: string;
}

export interface Suspect {
  id: string;
  name: string;
  role: string;
  /** Where this person claims to have been during the incident window. */
  claimedLocation: string;
  motive: string;
  /** 0-10 evidence axes used by the stage 4 scoring challenge. */
  stats: { opportunity: number; motive: number; access: number };
  /** Seconds-since-midnight window this person can account for. */
  alibiWindow: { start: number; end: number };
  /** True when the alibi is corroborated by an independent witness. */
  alibiCorroborated: boolean;
  /** Areas this person can badge into. Used to tie the decoded drop point to a person. */
  accessAreas: string[];
}

export interface TimelineEvent {
  /** Seconds since midnight. */
  at: number;
  label: string;
  location: string;
  /** Suspect id, or null for facility/system events. */
  actorId: string | null;
  /** Events the player has to earn are hidden until the unlocking stage is solved. */
  revealedByStage: number;
}

export type ClueKind = 'physical' | 'testimony' | 'digital' | 'document';

export interface Clue {
  id: string;
  kind: ClueKind;
  title: string;
  /** Plain text. Rendered with textContent, never innerHTML. */
  body: string;
  /** 1-based stage that reveals this clue. */
  revealedByStage: number;
  /** Red herrings point at an innocent suspect and are defused by `defusedBy`. */
  isRedHerring: boolean;
  /** Suspect the clue implicates, if any. */
  pointsAt: string | null;
  /** Clue id that exonerates the person a red herring implicates. */
  defusedBy?: string;
}

/**
 * How a submission is graded. The expected answer is never stored in the clear:
 * `answerHash` is a salted SHA-256 of the normalised answer.
 */
export interface ChallengeCheck {
  /** What the player must produce. */
  mode: 'stdout' | 'function';
  answerHash: string;
  /** Per-case salt, so two cases with the same answer do not share a hash. */
  salt: string;
  /**
   * For `function` mode: the function the player must define, plus hidden probe
   * arguments. Probes make hard-coded `print` answers fail and let any
   * equivalent implementation pass.
   */
  functionName?: string;
  probes?: { args: number[]; expectHash: string }[];
  /** Soft requirements: player is nudged, not blocked, when these are missing. */
  wants?: { keyword: string; because: string }[];
  /** True when the answer is a number, so `40` and `40.0` both count. */
  numeric?: boolean;
  /**
   * Hashes of predictable wrong answers, each with the nudge to show. This is
   * how the grader says "you are one index early" without ever holding - or
   * shipping - the right answer in the clear.
   */
  nearMisses: { hash: string; feedback: string }[];
  /**
   * sha256 of the unlock token a correct submission produces. The progress
   * state machine will not mark a stage solved without a token matching this,
   * so editing saved state or poking at the UI cannot advance the case.
   */
  unlockHash: string;
}

export interface Challenge {
  concept: ConceptId;
  /** Short teaching block, plain text paragraphs. */
  lesson: string[];
  /** The literal task. */
  prompt: string;
  /** Data the player is handed, already valid Python. */
  givens: string[];
  starterCode: string;
  hints: string[];
  check: ChallengeCheck;
}

/** A consequence of solving a stage: what the correct answer unlocks. */
export interface Branch {
  /** Stable key, e.g. `stage1.identified`. */
  key: string;
  /** Narrative shown after a correct answer. */
  outcome: string;
  /** Suspect ids this result puts in or out of the frame. */
  implicates: string[];
  exonerates: string[];
  /** Clue ids revealed by taking this branch. */
  revealsClues: string[];
}

export interface Stage {
  /** 1-based. */
  index: number;
  title: string;
  concept: ConceptId;
  conceptLabel: string;
  /** Story beat shown above the evidence. */
  story: string[];
  challenge: Challenge;
  branch: Branch;
}

export interface CaseSetting {
  place: string;
  city: string;
  /** e.g. "the Meridian Diamond". */
  object: string;
  incident: string;
  /** Seconds since midnight. */
  incidentWindow: { start: number; end: number };
}

export interface Case {
  seed: string;
  difficulty: Difficulty;
  title: string;
  subtitle: string;
  setting: CaseSetting;
  suspects: Suspect[];
  relationships: Relationship[];
  timeline: TimelineEvent[];
  clues: Clue[];
  stages: Stage[];
  /**
   * The hidden solution. `culpritId` is present in memory because generation is
   * deterministic anyway, but the UI must never render it before the finale and
   * must never place it in the DOM. See `docs` in README for the honest limits.
   */
  solution: {
    culpritId: string;
    method: string;
    motive: string;
    /** Clue ids that, taken together, single the culprit out. */
    provingClues: string[];
  };
}

export type StageState = 'locked' | 'active' | 'solved';

export interface StageProgress {
  index: number;
  state: StageState;
  attempts: number;
  wrongAttempts: number;
  hintsUsed: number;
  /** Token proving this stage was genuinely solved (see engine/progress.ts). */
  unlockToken: string | null;
  solvedAt: number | null;
}

export interface PlayerProgress {
  /** Schema version, so stored saves can be migrated or discarded. */
  version: number;
  seed: string;
  difficulty: Difficulty;
  currentStage: number;
  stages: StageProgress[];
  /** Branch keys taken, in order. */
  branches: string[];
  /** Clue ids the player has actually earned. */
  unlockedClues: string[];
  /** Wrong-but-runnable submissions burn an action; at 0 the case still ends. */
  investigationActions: number;
  accusedId: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface CaseResult {
  correct: boolean;
  accusedId: string;
  culpritId: string;
  method: string;
  motive: string;
  stagesSolved: number;
  totalStages: number;
  wrongAttempts: number;
  hintsUsed: number;
  elapsedMs: number;
  /** Concepts the player exercised, for the closing summary. */
  conceptsPractised: { concept: ConceptId; label: string; solved: boolean }[];
}

export type GradeStatus = 'correct' | 'incorrect' | 'syntax-error' | 'runtime-error' | 'empty';

export interface GradeResult {
  status: GradeStatus;
  /** One-line verdict for the player. */
  message: string;
  /** Optional longer nudge: what to look at next. */
  detail?: string;
  /** stdout produced by the submission. */
  stdout: string[];
  /** Present only on success; consumed by the progress state machine. */
  unlockToken?: string;
  /** Line number for syntax/runtime errors. */
  line?: number;
}
