/** Runtime value representation and Python-accurate formatting. */

export type PyValue =
  | number
  | string
  | boolean
  | null
  | PyValue[]
  | PyDict
  | PyFunction;

export class PyDict {
  readonly entries = new Map<string, { key: PyValue; value: PyValue }>();

  static keyOf(key: PyValue): string {
    return `${typeof key}:${typeof key === 'object' ? JSON.stringify(key) : String(key)}`;
  }

  get(key: PyValue): PyValue | undefined {
    return this.entries.get(PyDict.keyOf(key))?.value;
  }

  set(key: PyValue, value: PyValue): void {
    this.entries.set(PyDict.keyOf(key), { key, value });
  }

  has(key: PyValue): boolean {
    return this.entries.has(PyDict.keyOf(key));
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface PyFunction {
  __pyFunction: true;
  name: string;
  call(args: PyValue[], line: number): PyValue;
}

export function isFunction(value: PyValue): value is PyFunction {
  return typeof value === 'object' && value !== null && '__pyFunction' in value;
}

/** `str(x)` */
export function pyStr(value: PyValue): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return formatNumber(value);
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (value instanceof PyDict) {
    return `{${[...value.entries.values()].map((e) => `${pyRepr(e.key)}: ${pyRepr(e.value)}`).join(', ')}}`;
  }
  return `<function ${value.name}>`;
}

/** `repr(x)` - strings gain quotes. */
export function pyRepr(value: PyValue): string {
  if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`;
  return pyStr(value);
}

/**
 * Number formatting.
 *
 * Known simplification: the subset stores every number as a JS double and has
 * no int/float tag, so `10 / 2` prints `5` where CPython prints `5.0`. The
 * grader normalises numeric answers (`40` and `40.0` both pass), so this never
 * changes whether a submission is accepted - it is a display difference only.
 */
export function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  if (Number.isInteger(value)) return String(value);
  // Trim the float noise a beginner should never have to think about.
  const rounded = Number(value.toFixed(10));
  return String(rounded);
}

/** Truthiness, Python style. */
export function pyTruthy(value: PyValue): boolean {
  if (value === null || value === false) return false;
  if (value === true) return true;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof PyDict) return value.size > 0;
  return true;
}

export function typeName(value: PyValue): string {
  if (value === null) return 'NoneType';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float';
  if (typeof value === 'string') return 'str';
  if (Array.isArray(value)) return 'list';
  if (value instanceof PyDict) return 'dict';
  return 'function';
}

export function pyEquals(a: PyValue, b: PyValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => pyEquals(item, b[i] as PyValue));
  }
  if (a instanceof PyDict && b instanceof PyDict) {
    if (a.size !== b.size) return false;
    for (const [key, entry] of a.entries) {
      const other = b.entries.get(key);
      if (!other || !pyEquals(entry.value, other.value)) return false;
    }
    return true;
  }
  return a === b;
}
