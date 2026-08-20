/**
 * Seeds are the shareable identity of a case. They are short, unambiguous and
 * safe to paste into a chat window: 8 characters from a confusable-free
 * alphabet, formatted as `CH-XXXX-XXXX`.
 */

import { Rng } from './rng.js';

/** No I, O, 0, 1 - they are misread when a seed is copied by hand. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SEED_LENGTH = 8;

export function randomSeed(entropy: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < SEED_LENGTH; i++) {
    out += ALPHABET[Math.floor(entropy() * ALPHABET.length)] ?? '2';
  }
  return formatSeed(out);
}

/** Deterministic seed generation, used by tests and by "next case" chains. */
export function seedFromRng(rng: Rng): string {
  let out = '';
  for (let i = 0; i < SEED_LENGTH; i++) out += ALPHABET[rng.int(0, ALPHABET.length - 1)];
  return formatSeed(out);
}

export function formatSeed(raw: string): string {
  const body = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return `CH-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

/**
 * Accepts anything a player might type - with or without the prefix, lower
 * case, spaces - and returns the canonical form, or null when it cannot be
 * rescued.
 */
export function normaliseSeed(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/^CH[-\s]?/, '')
    .replace(/[^0-9A-Z]/g, '')
    // Fold the characters players confuse with alphabet members.
    .replace(/O/g, '0')
    .replace(/I/g, '1')
    .replace(/0/g, 'Q')
    .replace(/1/g, 'L');

  if (cleaned.length === 0) return null;
  const padded = cleaned.slice(0, SEED_LENGTH).padEnd(SEED_LENGTH, '7');
  for (const ch of padded) if (!ALPHABET.includes(ch)) return null;
  return formatSeed(padded);
}

export function isValidSeed(input: string): boolean {
  return /^CH-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(input);
}
