/** String, list and dict methods available to player code. */

import { PyAttributeError, PyIndexError, PyTypeError, PyValueError } from './errors.js';
import { PyDict, pyEquals, pyRepr, pyStr, type PyValue } from './values.js';

export interface MethodContext {
  guardSize(size: number): void;
}

export function callMethod(
  object: PyValue,
  method: string,
  args: PyValue[],
  line: number,
  ctx: MethodContext,
): PyValue {
  if (typeof object === 'string') return stringMethod(object, method, args, line, ctx);
  if (Array.isArray(object)) return listMethod(object, method, args, line, ctx);
  if (object instanceof PyDict) return dictMethod(object, method, args, line);
  throw new PyAttributeError(`${pyRepr(object)} has no method '${method}'`, line);
}

function expectString(value: PyValue | undefined, method: string, line: number): string {
  if (typeof value !== 'string') {
    throw new PyTypeError(`${method}() expected text, got ${pyRepr(value ?? null)}`, line);
  }
  return value;
}

function stringMethod(
  target: string,
  method: string,
  args: PyValue[],
  line: number,
  ctx: MethodContext,
): PyValue {
  switch (method) {
    case 'upper': return target.toUpperCase();
    case 'lower': return target.toLowerCase();
    case 'title': return target.replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
    case 'capitalize': return target.charAt(0).toUpperCase() + target.slice(1).toLowerCase();
    case 'strip': return args.length ? trimChars(target, expectString(args[0], method, line), 'both') : target.trim();
    case 'lstrip': return args.length ? trimChars(target, expectString(args[0], method, line), 'start') : target.replace(/^\s+/, '');
    case 'rstrip': return args.length ? trimChars(target, expectString(args[0], method, line), 'end') : target.replace(/\s+$/, '');
    case 'split': {
      const parts = args.length
        ? target.split(expectString(args[0], method, line))
        : target.trim().split(/\s+/).filter((p) => p.length > 0);
      ctx.guardSize(parts.length);
      return parts;
    }
    case 'join': {
      const items = args[0];
      if (!Array.isArray(items)) throw new PyTypeError('join() expected a list', line);
      return items.map((item) => {
        if (typeof item !== 'string') throw new PyTypeError(`join() needs a list of strings, found ${pyRepr(item)}`, line);
        return item;
      }).join(target);
    }
    case 'replace': {
      const from = expectString(args[0], method, line);
      const to = expectString(args[1], method, line);
      const result = target.split(from).join(to);
      ctx.guardSize(result.length);
      return result;
    }
    case 'startswith': return target.startsWith(expectString(args[0], method, line));
    case 'endswith': return target.endsWith(expectString(args[0], method, line));
    case 'count': return args.length ? target.split(expectString(args[0], method, line)).length - 1 : 0;
    case 'find': return target.indexOf(expectString(args[0], method, line));
    case 'index': {
      const at = target.indexOf(expectString(args[0], method, line));
      if (at === -1) throw new PyValueError('substring not found', line);
      return at;
    }
    case 'isdigit': return target.length > 0 && /^[0-9]+$/.test(target);
    case 'isalpha': return target.length > 0 && /^[A-Za-z]+$/.test(target);
    case 'isupper': return /[A-Z]/.test(target) && target === target.toUpperCase();
    case 'islower': return /[a-z]/.test(target) && target === target.toLowerCase();
    case 'format': {
      let index = 0;
      return target.replace(/\{\}/g, () => pyStr(args[index++] ?? null));
    }
    case 'zfill': {
      const width = args[0];
      if (typeof width !== 'number') throw new PyTypeError('zfill() expected a number', line);
      return target.padStart(width, '0');
    }
    default:
      throw new PyAttributeError(`strings have no method '${method}' in this terminal`, line);
  }
}

function trimChars(target: string, chars: string, side: 'both' | 'start' | 'end'): string {
  let start = 0;
  let end = target.length;
  if (side !== 'end') while (start < end && chars.includes(target[start] as string)) start++;
  if (side !== 'start') while (end > start && chars.includes(target[end - 1] as string)) end--;
  return target.slice(start, end);
}

function listMethod(
  target: PyValue[],
  method: string,
  args: PyValue[],
  line: number,
  ctx: MethodContext,
): PyValue {
  switch (method) {
    case 'append': {
      ctx.guardSize(target.length + 1);
      target.push(args[0] ?? null);
      return null;
    }
    case 'extend': {
      const items = args[0];
      if (!Array.isArray(items)) throw new PyTypeError('extend() expected a list', line);
      ctx.guardSize(target.length + items.length);
      target.push(...items);
      return null;
    }
    case 'insert': {
      const at = args[0];
      if (typeof at !== 'number') throw new PyTypeError('insert() expected a position', line);
      ctx.guardSize(target.length + 1);
      target.splice(at < 0 ? Math.max(0, target.length + at) : at, 0, args[1] ?? null);
      return null;
    }
    case 'pop': {
      if (target.length === 0) throw new PyIndexError('pop from empty list', line);
      if (args.length === 0) return target.pop() as PyValue;
      const at = args[0];
      if (typeof at !== 'number') throw new PyTypeError('pop() expected a position', line);
      const resolved = at < 0 ? target.length + at : at;
      if (resolved < 0 || resolved >= target.length) throw new PyIndexError('pop index out of range', line);
      return target.splice(resolved, 1)[0] as PyValue;
    }
    case 'remove': {
      const at = target.findIndex((item) => pyEquals(item, args[0] ?? null));
      if (at === -1) throw new PyValueError('list.remove(x): x not in list', line);
      target.splice(at, 1);
      return null;
    }
    case 'index': {
      const at = target.findIndex((item) => pyEquals(item, args[0] ?? null));
      if (at === -1) throw new PyValueError(`${pyRepr(args[0] ?? null)} is not in the list`, line);
      return at;
    }
    case 'count': return target.filter((item) => pyEquals(item, args[0] ?? null)).length;
    case 'sort': {
      target.sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
        throw new PyTypeError(`cannot sort ${pyRepr(a)} with ${pyRepr(b)}`, line);
      });
      return null;
    }
    case 'reverse': { target.reverse(); return null; }
    case 'clear': { target.length = 0; return null; }
    case 'copy': return [...target];
    default:
      throw new PyAttributeError(`lists have no method '${method}' in this terminal`, line);
  }
}

function dictMethod(target: PyDict, method: string, args: PyValue[], line: number): PyValue {
  switch (method) {
    case 'keys': return [...target.entries.values()].map((entry) => entry.key);
    case 'values': return [...target.entries.values()].map((entry) => entry.value);
    case 'items': return [...target.entries.values()].map((entry) => [entry.key, entry.value]);
    case 'get': {
      const key = args[0] ?? null;
      return target.has(key) ? (target.get(key) as PyValue) : (args[1] ?? null);
    }
    default:
      throw new PyAttributeError(`dictionaries have no method '${method}' in this terminal`, line);
  }
}
