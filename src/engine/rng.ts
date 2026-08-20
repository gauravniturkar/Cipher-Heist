/**
 * Deterministic, seedable pseudo-randomness.
 *
 * The whole point of the case generator is reproducibility: the same seed must
 * yield byte-identical cases forever, so nothing here may use Math.random or
 * anything time-dependent.
 */

/** xmur3 string hash -> 32-bit seed. */
export function hashSeed(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
    // Avoid the degenerate all-zero state.
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** mulberry32: small, fast, good enough distribution for content selection. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new RangeError(`Rng.int: max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty list');
    return items[this.int(0, items.length - 1)] as T;
  }

  /** Fisher-Yates, returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const a = copy[i] as T;
      copy[i] = copy[j] as T;
      copy[j] = a;
    }
    return copy;
  }

  /** `count` distinct items, in shuffled order. */
  sample<T>(items: readonly T[], count: number): T[] {
    if (count > items.length) {
      throw new RangeError(`Rng.sample: need ${count} of ${items.length}`);
    }
    return this.shuffle(items).slice(0, count);
  }

  /**
   * A child generator keyed by a label. Lets one subsystem (say, ciphers)
   * consume randomness without shifting what every other subsystem produces.
   */
  fork(label: string): Rng {
    return new Rng(hashSeed(`${label}:${this.int(0, 0xffffff)}`));
  }
}
