/**
 * The complete set of names a player program can reach. Nothing here touches a
 * host global, the DOM, network or storage.
 */

import { PyTypeError, PyValueError, PyIndexError } from './errors.js';
import { isFunction, PyDict, pyEquals, pyRepr, pyStr, pyTruthy, typeName, type PyFunction, type PyValue } from './values.js';

export interface BuiltinContext {
  guardSize(size: number): void;
  callFunction(fn: PyFunction, args: PyValue[]): PyValue;
}

const BUILTIN_NAMES = new Set([
  'abs', 'all', 'any', 'bool', 'chr', 'enumerate', 'filter', 'float', 'int', 'len',
  'list', 'map', 'max', 'min', 'ord', 'print', 'range', 'repr', 'reversed', 'round',
  'set', 'sorted', 'str', 'sum', 'type', 'zip',
]);

export function isBuiltin(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}

export function callBuiltin(
  name: string,
  args: PyValue[],
  line: number,
  ctx: BuiltinContext,
): PyValue {
  const arg = (index: number): PyValue => {
    const value = args[index];
    if (value === undefined) throw new PyTypeError(`${name}() is missing an argument`, line);
    return value;
  };

  const asNumber = (value: PyValue): number => {
    if (typeof value !== 'number') throw new PyTypeError(`${name}() expected a number, got ${pyRepr(value)}`, line);
    return value;
  };

  const asSequence = (value: PyValue): PyValue[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [...value];
    if (value instanceof PyDict) return [...value.entries.values()].map((entry) => entry.key);
    throw new PyTypeError(`${name}() expected a list or string, got ${pyRepr(value)}`, line);
  };

  switch (name) {
    case 'len': {
      const value = arg(0);
      if (typeof value === 'string' || Array.isArray(value)) return value.length;
      if (value instanceof PyDict) return value.size;
      throw new PyTypeError(`len() does not work on ${typeName(value)}`, line);
    }
    case 'range': {
      const start = args.length > 1 ? asNumber(arg(0)) : 0;
      const stop = args.length > 1 ? asNumber(arg(1)) : asNumber(arg(0));
      const step = args.length > 2 ? asNumber(arg(2)) : 1;
      if (step === 0) throw new PyValueError('range() step cannot be zero', line);
      const count = Math.max(0, Math.ceil((stop - start) / step));
      ctx.guardSize(count);
      const out: PyValue[] = [];
      for (let i = 0; i < count; i++) out.push(start + i * step);
      return out;
    }
    case 'str': return args.length ? pyStr(arg(0)) : '';
    case 'repr': return pyRepr(arg(0));
    case 'int': {
      const value = arg(0);
      if (typeof value === 'number') return Math.trunc(value);
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (value.trim() === '' || Number.isNaN(parsed)) {
          throw new PyValueError(`invalid literal for int(): '${value}'`, line);
        }
        return Math.trunc(parsed);
      }
      throw new PyTypeError(`int() does not work on ${typeName(value)}`, line);
    }
    case 'float': {
      const value = arg(0);
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isNaN(parsed)) throw new PyValueError(`invalid literal for float(): '${value}'`, line);
        return parsed;
      }
      throw new PyTypeError(`float() does not work on ${typeName(value)}`, line);
    }
    case 'bool': return args.length ? pyTruthy(arg(0)) : false;
    case 'abs': return Math.abs(asNumber(arg(0)));
    case 'round': {
      const value = asNumber(arg(0));
      const digits = args.length > 1 ? asNumber(arg(1)) : 0;
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    }
    case 'chr': {
      const code = asNumber(arg(0));
      if (code < 0 || code > 0x10ffff) throw new PyValueError('chr() arg is not in range', line);
      return String.fromCodePoint(code);
    }
    case 'ord': {
      const value = arg(0);
      if (typeof value !== 'string' || [...value].length !== 1) {
        throw new PyTypeError(`ord() expected a single character, got ${pyRepr(value)}`, line);
      }
      return value.codePointAt(0) as number;
    }
    case 'list': return args.length ? [...asSequence(arg(0))] : [];
    case 'sorted': {
      const items = [...asSequence(arg(0))];
      return items.sort(comparePyValues(line));
    }
    case 'reversed': return [...asSequence(arg(0))].reverse();
    case 'sum': {
      const items = asSequence(arg(0));
      let total = args.length > 1 ? asNumber(arg(1)) : 0;
      for (const item of items) {
        if (typeof item !== 'number') throw new PyTypeError(`sum() needs numbers, found ${pyRepr(item)}`, line);
        total += item;
      }
      return total;
    }
    case 'max':
    case 'min': {
      const items = args.length === 1 ? asSequence(arg(0)) : args;
      if (items.length === 0) throw new PyValueError(`${name}() arg is an empty sequence`, line);
      const sorted = [...items].sort(comparePyValues(line));
      return (name === 'max' ? sorted[sorted.length - 1] : sorted[0]) as PyValue;
    }
    case 'any': return asSequence(arg(0)).some(pyTruthy);
    case 'all': return asSequence(arg(0)).every(pyTruthy);
    case 'enumerate': {
      const start = args.length > 1 ? asNumber(arg(1)) : 0;
      return asSequence(arg(0)).map((item, index) => [start + index, item]);
    }
    case 'zip': {
      const sequences = args.map(asSequence);
      const length = sequences.length ? Math.min(...sequences.map((s) => s.length)) : 0;
      return Array.from({ length }, (_, i) => sequences.map((s) => s[i] as PyValue));
    }
    case 'set': {
      const seen: PyValue[] = [];
      for (const item of args.length ? asSequence(arg(0)) : []) {
        if (!seen.some((existing) => pyEquals(existing, item))) seen.push(item);
      }
      return seen;
    }
    case 'map': {
      const fn = arg(0);
      if (!isFunction(fn)) throw new PyTypeError('map() needs a function as its first argument', line);
      return asSequence(arg(1)).map((item) => ctx.callFunction(fn, [item]));
    }
    case 'filter': {
      const fn = arg(0);
      if (!isFunction(fn)) throw new PyTypeError('filter() needs a function as its first argument', line);
      return asSequence(arg(1)).filter((item) => pyTruthy(ctx.callFunction(fn, [item])));
    }
    case 'type': return `<class '${typeName(arg(0))}'>`;
    default:
      throw new PyIndexError(`builtin '${name}' is not available in this terminal`, line);
  }
}

function comparePyValues(line: number): (a: PyValue, b: PyValue) => number {
  return (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    throw new PyTypeError(`cannot order ${pyRepr(a)} against ${pyRepr(b)}`, line);
  };
}
