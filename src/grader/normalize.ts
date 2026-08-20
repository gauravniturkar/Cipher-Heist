/**
 * Answer normalisation, shared by the generator (which hashes the expected
 * answer) and the grader (which hashes what the player produced).
 *
 * The rule of thumb: accept anything that shows the player got the right
 * value, reject anything that shows they did not. Formatting - case, spacing,
 * trailing punctuation, `40` vs `40.0` - is never the thing being tested.
 */

export function normaliseText(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'`([]+|["'`)\],.:;!?]+$/g, '')
    .toUpperCase();
}

export function normaliseNumber(raw: string): string | null {
  const cleaned = raw.trim().replace(/[,_\s]/g, '').replace(/^[([]+|[)\],.:;]+$/g, '');
  if (cleaned === '' || !/^[-+]?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  // 40, 40.0 and 40.000 all canonicalise to the same string.
  return String(Number(value.toFixed(6)));
}

export function normalise(raw: string, numeric: boolean): string {
  if (numeric) {
    const asNumber = normaliseNumber(raw);
    if (asNumber !== null) return asNumber;
  }
  return normaliseText(raw);
}

/**
 * Every value a printed line might plausibly be offering as "the answer":
 * the whole line, and each token within it. This is what makes
 * `print("Entry time:", t)` pass without demanding one exact output format.
 */
const MAX_WINDOW = 4;

export function answerCandidates(stdout: string[], numeric: boolean): string[] {
  const candidates = new Set<string>();
  for (const line of stdout) {
    if (line.trim() === '') continue;
    candidates.add(normalise(line, numeric));

    const tokens = line
      .split(/[\s,;|]+/)
      .map((token) => token.replace(/^[^\w.-]+|[^\w.-]+$/g, ''))
      .filter((token) => token !== '');

    // Single tokens, then contiguous runs, so `print("Name:", first, last)`
    // offers "MARTIN VOSS" as a candidate alongside "MARTIN" and "VOSS".
    for (let start = 0; start < tokens.length; start++) {
      for (let size = 1; size <= MAX_WINDOW && start + size <= tokens.length; size++) {
        candidates.add(normalise(tokens.slice(start, start + size).join(' '), numeric));
      }
    }
  }
  candidates.delete('');
  return [...candidates];
}
