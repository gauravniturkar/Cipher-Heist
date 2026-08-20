/**
 * Persistence.
 *
 * Only the seed, the difficulty and the player's progress are saved - never
 * the case itself, which is regenerated from the seed. That keeps saves tiny
 * and means a stored save can never contradict the generator.
 *
 * Every read is defensive: storage can be disabled, full, or hold something
 * written by an older version, and none of those may break the game.
 */

import type { Difficulty, PlayerProgress } from '../types.js';
import { PROGRESS_VERSION } from './progress.js';
import { isValidSeed } from './seed.js';

const KEY = 'cipher-heist/save/v2';
const DRAFT_KEY = 'cipher-heist/draft/v2';

export interface SavedGame {
  seed: string;
  difficulty: Difficulty;
  progress: PlayerProgress;
}

function storage(): Storage | null {
  try {
    const probe = globalThis.localStorage;
    if (!probe) return null;
    // Safari in private mode throws on write rather than on access.
    const token = '__ch_probe__';
    probe.setItem(token, '1');
    probe.removeItem(token);
    return probe;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return storage() !== null;
}

/**
 * Small key/value settings that are not part of a saved game - the theme, for
 * instance. Kept here so the storage probe and its failure handling live in
 * exactly one place.
 */
export function readSetting(key: string): string | null {
  try {
    return storage()?.getItem(`cipher-heist/${key}`) ?? null;
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    storage()?.setItem(`cipher-heist/${key}`, value);
  } catch {
    // A setting that will not persist is not worth interrupting anyone over.
  }
}

export function saveGame(game: SavedGame): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(game));
    return true;
  } catch {
    // Quota exceeded: the game stays playable, it just will not resume.
    return false;
  }
}

export function loadGame(): SavedGame | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SavedGame>;
    if (!parsed || typeof parsed !== 'object') return null;
    const { seed, difficulty, progress } = parsed;
    if (typeof seed !== 'string' || !isValidSeed(seed)) return null;
    if (difficulty !== 'rookie' && difficulty !== 'detective' && difficulty !== 'inspector') return null;
    if (!progress || typeof progress !== 'object') return null;
    if ((progress as PlayerProgress).version !== PROGRESS_VERSION) return null;
    if (!Array.isArray((progress as PlayerProgress).stages)) return null;
    return { seed, difficulty, progress: progress as PlayerProgress };
  } catch {
    // Corrupted save: drop it rather than trapping the player on a broken game.
    clearGame();
    return null;
  }
}

export function clearGame(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to do - the game runs fine without persistence.
  }
}

/** Per-stage editor contents, so a reload does not lose work in progress. */
export function saveDraft(seed: string, stage: number, source: string): void {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(DRAFT_KEY);
    const drafts = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    drafts[`${seed}#${stage}`] = source.slice(0, 20_000);
    store.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    // Drafts are a convenience; failing to store one is not worth surfacing.
  }
}

export function loadDraft(seed: string, stage: number): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return null;
    const drafts = JSON.parse(raw) as Record<string, string>;
    return drafts[`${seed}#${stage}`] ?? null;
  } catch {
    return null;
  }
}

export function clearDrafts(seed: string): void {
  const store = storage();
  if (!store) return;
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return;
    const drafts = JSON.parse(raw) as Record<string, string>;
    for (const key of Object.keys(drafts)) if (key.startsWith(`${seed}#`)) delete drafts[key];
    store.setItem(DRAFT_KEY, JSON.stringify(drafts));
  } catch {
    clearGame();
  }
}
