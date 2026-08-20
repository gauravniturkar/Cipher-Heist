import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { saltedHash, sha256 } from '../src/engine/hash.js';

describe('sha256', () => {
  const samples = ['', 'a', 'abc', 'The Meridian Diamond', 'x'.repeat(55), 'y'.repeat(64), 'z'.repeat(200)];

  it('matches node crypto for a range of lengths', () => {
    for (const sample of samples) {
      expect(sha256(sample)).toBe(createHash('sha256').update(sample).digest('hex'));
    }
  });

  it('salts so identical answers differ between cases', () => {
    expect(saltedHash('case-a', 'MARTIN')).not.toBe(saltedHash('case-b', 'MARTIN'));
    expect(saltedHash('case-a', 'MARTIN')).toBe(saltedHash('case-a', 'MARTIN'));
  });
});
