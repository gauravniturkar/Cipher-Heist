/**
 * Tree-walking interpreter for the Python subset.
 *
 * Security posture: there is no `eval`, no `new Function`, no access to any
 * host global. The only things a program can reach are the builtins listed in
 * `builtins.ts` and its own variables. Every loop, call and statement is
 * metered against a budget, so a runaway program stops with an
 * `ExecutionLimit` error instead of freezing the tab.
 */

import type { AssignTarget, Expr, Stmt } from './ast.js';
import {
  PyAttributeError, PyBudgetError, PyError, PyIndexError, PyNameError,
  PyTypeError, PyValueError, PyZeroDivisionError,
} from './errors.js';
import { parse } from './parser.js';
import { callBuiltin, isBuiltin } from './builtins.js';
import { callMethod } from './methods.js';
import {
  isFunction, PyDict, pyEquals, pyRepr, pyStr, pyTruthy, type PyFunction, type PyValue,
} from './values.js';

export interface Budget {
  /** Max statements + expression nodes evaluated. */
  steps: number;
  /** Max wall-clock milliseconds. */
  millis: number;
  /** Max printed lines. */
  outputLines: number;
  /** Max nested user function calls. */
  callDepth: number;
  /** Max elements any single list may hold. */
  collectionSize: number;
}

export const DEFAULT_BUDGET: Budget = {
  steps: 400_000,
  millis: 2_000,
  outputLines: 400,
  callDepth: 60,
  collectionSize: 20_000,
};

export interface RunResult {
  stdout: string[];
  /** Top-level variables after the run, for feedback ("you set `name` to ..."). */
  globals: Record<string, PyValue>;
  error: PyError | null;
}

/** Non-local control flow, kept private to this module. */
class BreakSignal { }
class ContinueSignal { }
class ReturnSignal {
  constructor(readonly value: PyValue) {}
}

type Scope = Map<string, PyValue>;

export class Interpreter {
  private readonly globals: Scope = new Map();
  private readonly stdout: string[] = [];
  private pendingLine = '';
  private steps = 0;
  private depth = 0;
  private deadline = 0;

  constructor(private readonly budget: Budget = DEFAULT_BUDGET) {}

  run(source: string): RunResult {
    this.deadline = Date.now() + this.budget.millis;
    let error: PyError | null = null;
    try {
      // Parsing happens first and separately: syntax problems are reported
      // before a single statement executes.
      const program = parse(source);
      this.execBlock(program.body);
    } catch (caught) {
      if (caught instanceof PyError) error = caught;
      else if (caught instanceof ReturnSignal) {
        error = new PyError("'return' outside function", 'SyntaxError', 1);
      } else throw caught;
    }
    this.flushPending();
    return {
      stdout: [...this.stdout],
      globals: Object.fromEntries(this.globals),
      error,
    };
  }

  // ── budget ─────────────────────────────────────────────────────────────
  private tick(line: number): void {
    if (++this.steps > this.budget.steps) {
      throw new PyBudgetError(
        `this program did too much work (over ${this.budget.steps.toLocaleString()} steps) - is a loop running away?`,
        line,
      );
    }
    // Checking the clock on every step is wasteful; every 2048 is plenty.
    if ((this.steps & 2047) === 0 && Date.now() > this.deadline) {
      throw new PyBudgetError(`this program ran longer than ${this.budget.millis}ms and was stopped`, line);
    }
  }

  private guardSize(size: number, line: number): void {
    if (size > this.budget.collectionSize) {
      throw new PyBudgetError(`that would build a collection of ${size} items, which is too large`, line);
    }
  }

  // ── output ─────────────────────────────────────────────────────────────
  private write(text: string): void {
    const parts = (this.pendingLine + text).split('\n');
    this.pendingLine = parts.pop() ?? '';
    for (const part of parts) {
      if (this.stdout.length >= this.budget.outputLines) {
        throw new PyBudgetError(`printed more than ${this.budget.outputLines} lines`, 0);
      }
      this.stdout.push(part);
    }
  }

  private flushPending(): void {
    if (this.pendingLine.length > 0) {
      this.stdout.push(this.pendingLine);
      this.pendingLine = '';
    }
  }

  // ── statements ─────────────────────────────────────────────────────────
  private execBlock(body: Stmt[], scope: Scope = this.globals): void {
    for (const statement of body) this.exec(statement, scope);
  }

  private exec(stmt: Stmt, scope: Scope): void {
    this.tick(stmt.line);
    switch (stmt.type) {
      case 'ExprStmt':
        this.eval(stmt.value, scope);
        return;

      case 'Assign': {
        const value = this.eval(stmt.value, scope);
        for (const target of stmt.targets) this.assign(target, value, scope);
        return;
      }

      case 'AugAssign': {
        const current = this.readTarget(stmt.target, scope);
        const value = this.binary(stmt.op, current, this.eval(stmt.value, scope), stmt.line);
        this.assign(stmt.target, value, scope);
        return;
      }

      case 'If':
        for (const branch of stmt.branches) {
          if (branch.condition === null || pyTruthy(this.eval(branch.condition, scope))) {
            this.execBlock(branch.body, scope);
            return;
          }
        }
        return;

      case 'While': {
        let iterations = 0;
        while (pyTruthy(this.eval(stmt.condition, scope))) {
          this.tick(stmt.line);
          if (++iterations > this.budget.steps) {
            throw new PyBudgetError('this while loop never stopped', stmt.line);
          }
          try {
            this.execBlock(stmt.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
        }
        return;
      }

      case 'For': {
        const iterable = this.toIterable(this.eval(stmt.iter, scope), stmt.line);
        for (const item of iterable) {
          this.tick(stmt.line);
          this.bindLoopTargets(stmt.targets, item, scope, stmt.line);
          try {
            this.execBlock(stmt.body, scope);
          } catch (signal) {
            if (signal instanceof BreakSignal) break;
            if (!(signal instanceof ContinueSignal)) throw signal;
          }
        }
        return;
      }

      case 'FuncDef': {
        scope.set(stmt.name, this.makeFunction(stmt, scope));
        return;
      }

      case 'Return':
        throw new ReturnSignal(stmt.value ? this.eval(stmt.value, scope) : null);

      case 'Break':
        throw new BreakSignal();

      case 'Continue':
        throw new ContinueSignal();

      case 'Pass':
        return;
    }
  }

  private bindLoopTargets(targets: string[], item: PyValue, scope: Scope, line: number): void {
    if (targets.length === 1) {
      scope.set(targets[0] as string, item);
      return;
    }
    if (!Array.isArray(item) || item.length !== targets.length) {
      throw new PyValueError(
        `cannot unpack this item into ${targets.length} variables`,
        line,
      );
    }
    targets.forEach((name, index) => scope.set(name, item[index] as PyValue));
  }

  private makeFunction(stmt: Stmt & { type: 'FuncDef' }, closure: Scope): PyFunction {
    return {
      __pyFunction: true,
      name: stmt.name,
      // An arrow keeps `this` bound to the interpreter without aliasing it.
      call: (args: PyValue[], line: number): PyValue => {
        if (args.length > stmt.params.length) {
          throw new PyTypeError(
            `${stmt.name}() takes ${stmt.params.length} argument(s) but ${args.length} were given`,
            line,
          );
        }
        if (++this.depth > this.budget.callDepth) {
          this.depth--;
          throw new PyBudgetError(`too many nested calls in ${stmt.name}() - is it calling itself forever?`, line);
        }
        // Functions read globals but write locals, like Python without `global`.
        const local: Scope = new Map(closure === this.globals ? [] : closure);
        try {
          stmt.params.forEach((param, index) => {
            const provided = args[index];
            if (provided !== undefined) local.set(param.name, provided);
            else if (param.default) local.set(param.name, this.eval(param.default, local));
            else throw new PyTypeError(`${stmt.name}() is missing argument '${param.name}'`, line);
          });
          this.execBlock(stmt.body, local);
          return null;
        } catch (signal) {
          if (signal instanceof ReturnSignal) return signal.value;
          throw signal;
        } finally {
          this.depth--;
        }
      },
    };
  }

  private assign(target: AssignTarget, value: PyValue, scope: Scope): void {
    if (target.type === 'NameTarget') {
      scope.set(target.id, value);
      return;
    }
    const object = this.eval(target.object, scope);
    const index = this.eval(target.index, scope);
    if (Array.isArray(object)) {
      const position = this.resolveIndex(object.length, index, target.line);
      object[position] = value;
      return;
    }
    if (object instanceof PyDict) {
      object.set(index, value);
      return;
    }
    throw new PyTypeError('this value does not support item assignment', target.line);
  }

  private readTarget(target: AssignTarget, scope: Scope): PyValue {
    if (target.type === 'NameTarget') return this.lookup(target.id, scope, target.line);
    return this.eval({ type: 'Index', object: target.object, index: target.index, line: target.line }, scope);
  }

  private lookup(name: string, scope: Scope, line: number): PyValue {
    if (scope.has(name)) return scope.get(name) as PyValue;
    if (scope !== this.globals && this.globals.has(name)) return this.globals.get(name) as PyValue;
    throw new PyNameError(name, line);
  }

  // ── expressions ────────────────────────────────────────────────────────
  private eval(expr: Expr, scope: Scope): PyValue {
    this.tick(expr.line);
    switch (expr.type) {
      case 'Num': return expr.value;
      case 'Str': return expr.value;
      case 'Bool': return expr.value;
      case 'None': return null;
      case 'FStr': return this.evalFString(expr.raw, scope, expr.line);
      case 'Name': {
        if (!scope.has(expr.id) && !this.globals.has(expr.id) && isBuiltin(expr.id)) {
          throw new PyTypeError(`'${expr.id}' is a function - did you mean ${expr.id}(...)?`, expr.line);
        }
        return this.lookup(expr.id, scope, expr.line);
      }
      case 'List':
      case 'Tuple': {
        const items = expr.items.map((item) => this.eval(item, scope));
        this.guardSize(items.length, expr.line);
        return items;
      }
      case 'Dict': {
        const dict = new PyDict();
        for (const entry of expr.entries) {
          dict.set(this.eval(entry.key, scope), this.eval(entry.value, scope));
        }
        return dict;
      }
      case 'Unary': {
        const operand = this.eval(expr.operand, scope);
        if (expr.op === 'not') return !pyTruthy(operand);
        if (typeof operand !== 'number') {
          throw new PyTypeError(`bad operand type for unary ${expr.op}`, expr.line);
        }
        return expr.op === '-' ? -operand : operand;
      }
      case 'BinOp':
        return this.binary(expr.op, this.eval(expr.left, scope), this.eval(expr.right, scope), expr.line);
      case 'Compare':
        return this.compare(expr.op, this.eval(expr.left, scope), this.eval(expr.right, scope), expr.line);
      case 'BoolOp': {
        const left = this.eval(expr.left, scope);
        if (expr.op === 'and') return pyTruthy(left) ? this.eval(expr.right, scope) : left;
        return pyTruthy(left) ? left : this.eval(expr.right, scope);
      }
      case 'Ternary':
        return pyTruthy(this.eval(expr.condition, scope))
          ? this.eval(expr.whenTrue, scope)
          : this.eval(expr.whenFalse, scope);
      case 'Index': {
        const object = this.eval(expr.object, scope);
        const index = this.eval(expr.index, scope);
        if (object instanceof PyDict) {
          if (!object.has(index)) throw new PyIndexError(`key ${pyRepr(index)} is not in this dictionary`, expr.line);
          return object.get(index) as PyValue;
        }
        if (typeof object === 'string' || Array.isArray(object)) {
          const position = this.resolveIndex(object.length, index, expr.line);
          return typeof object === 'string' ? (object[position] as string) : (object[position] as PyValue);
        }
        throw new PyTypeError(`'${pyStr(object)}' cannot be indexed`, expr.line);
      }
      case 'Slice':
        return this.slice(expr, scope);
      case 'Attribute':
        throw new PyAttributeError(
          `'${expr.name}' must be called as a method, e.g. value.${expr.name}()`,
          expr.line,
        );
      case 'Comp':
        return this.comprehension(expr, scope);
      case 'Call':
        return this.call(expr, scope);
    }
  }

  private evalFString(raw: string, scope: Scope, line: number): string {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i] as string;
      if (ch === '{') {
        if (raw[i + 1] === '{') { out += '{'; i++; continue; }
        const end = raw.indexOf('}', i);
        if (end === -1) throw new PyValueError("f-string is missing a closing '}'", line);
        const source = raw.slice(i + 1, end).split(':')[0] as string;
        out += pyStr(this.evalSnippet(source, scope, line));
        i = end;
        continue;
      }
      if (ch === '}' && raw[i + 1] === '}') { out += '}'; i++; continue; }
      out += ch;
    }
    return out;
  }

  /** f-string holes are parsed with the same parser, never with eval. */
  private evalSnippet(source: string, scope: Scope, line: number): PyValue {
    const program = parse(source);
    const first = program.body[0];
    if (!first || first.type !== 'ExprStmt') {
      throw new PyValueError(`f-string placeholder '{${source}}' is not an expression`, line);
    }
    return this.eval(first.value, scope);
  }

  private comprehension(expr: Expr & { type: 'Comp' }, scope: Scope): PyValue {
    const iterable = this.toIterable(this.eval(expr.iter, scope), expr.line);
    const local: Scope = new Map(scope);
    const out: PyValue[] = [];
    for (const item of iterable) {
      this.tick(expr.line);
      local.set(expr.target, item);
      if (expr.condition && !pyTruthy(this.eval(expr.condition, local))) continue;
      out.push(this.eval(expr.element, local));
      this.guardSize(out.length, expr.line);
    }
    return out;
  }

  private slice(expr: Expr & { type: 'Slice' }, scope: Scope): PyValue {
    const object = this.eval(expr.object, scope);
    if (typeof object !== 'string' && !Array.isArray(object)) {
      throw new PyTypeError('only strings and lists can be sliced', expr.line);
    }
    const length = object.length;
    const step = expr.step ? this.asInt(this.eval(expr.step, scope), expr.line) : 1;
    if (step === 0) throw new PyValueError('slice step cannot be zero', expr.line);

    const clamp = (value: number, lo: number, hi: number): number => Math.min(Math.max(value, lo), hi);
    const normalise = (raw: number): number => (raw < 0 ? raw + length : raw);

    let start: number;
    let stop: number;
    if (step > 0) {
      start = expr.start ? clamp(normalise(this.asInt(this.eval(expr.start, scope), expr.line)), 0, length) : 0;
      stop = expr.stop ? clamp(normalise(this.asInt(this.eval(expr.stop, scope), expr.line)), 0, length) : length;
    } else {
      start = expr.start
        ? clamp(normalise(this.asInt(this.eval(expr.start, scope), expr.line)), -1, length - 1)
        : length - 1;
      stop = expr.stop
        ? clamp(normalise(this.asInt(this.eval(expr.stop, scope), expr.line)), -1, length - 1)
        : -1;
    }

    const picked: PyValue[] = [];
    if (step > 0) for (let i = start; i < stop; i += step) picked.push(object[i] as PyValue);
    else for (let i = start; i > stop; i += step) picked.push(object[i] as PyValue);

    return typeof object === 'string' ? picked.join('') : picked;
  }

  private call(expr: Expr & { type: 'Call' }, scope: Scope): PyValue {
    const args = expr.args.map((arg) => this.eval(arg, scope));
    const kwargs = new Map(expr.kwargs.map((kw) => [kw.name, this.eval(kw.value, scope)]));

    // Method call: obj.method(...)
    if (expr.callee.type === 'Attribute') {
      const object = this.eval(expr.callee.object, scope);
      return callMethod(object, expr.callee.name, args, expr.line, {
        guardSize: (size) => this.guardSize(size, expr.line),
      });
    }

    if (expr.callee.type === 'Name') {
      const name = expr.callee.id;
      // A user-defined function of the same name shadows the builtin, as in Python.
      const local = scope.get(name) ?? this.globals.get(name);
      if (local !== undefined && isFunction(local)) return local.call(args, expr.line);

      if (name === 'print') {
        this.write(this.renderPrint(args, kwargs));
        return null;
      }
      if (isBuiltin(name)) {
        return callBuiltin(name, args, expr.line, {
          guardSize: (size) => this.guardSize(size, expr.line),
          callFunction: (fn, callArgs) => fn.call(callArgs, expr.line),
        });
      }
      if (local !== undefined) {
        throw new PyTypeError(`'${name}' is not a function - it holds ${pyRepr(local)}`, expr.line);
      }
      throw new PyNameError(name, expr.line);
    }

    const callee = this.eval(expr.callee, scope);
    if (isFunction(callee)) return callee.call(args, expr.line);
    throw new PyTypeError('this value is not callable', expr.line);
  }

  private renderPrint(args: PyValue[], kwargs: Map<string, PyValue>): string {
    const separator = kwargs.has('sep') ? pyStr(kwargs.get('sep') as PyValue) : ' ';
    const terminator = kwargs.has('end') ? pyStr(kwargs.get('end') as PyValue) : '\n';
    return args.map(pyStr).join(separator) + terminator;
  }

  private toIterable(value: PyValue, line: number): PyValue[] {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return [...value];
    if (value instanceof PyDict) return [...value.entries.values()].map((entry) => entry.key);
    throw new PyTypeError(`'${pyStr(value)}' is not iterable - use a list, string or range()`, line);
  }

  private asInt(value: PyValue, line: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new PyTypeError(`expected a whole number, got ${pyRepr(value)}`, line);
    }
    return value;
  }

  private resolveIndex(length: number, index: PyValue, line: number): number {
    const position = this.asInt(index, line);
    const resolved = position < 0 ? length + position : position;
    if (resolved < 0 || resolved >= length) {
      throw new PyIndexError(`index ${position} is out of range (length ${length})`, line);
    }
    return resolved;
  }

  private binary(op: string, left: PyValue, right: PyValue, line: number): PyValue {
    if (op === '+') {
      if (typeof left === 'string' && typeof right === 'string') return left + right;
      if (Array.isArray(left) && Array.isArray(right)) {
        this.guardSize(left.length + right.length, line);
        return [...left, ...right];
      }
      if (typeof left === 'string' || typeof right === 'string') {
        throw new PyTypeError(
          `cannot add ${pyRepr(left)} and ${pyRepr(right)} - use str() to make both text`,
          line,
        );
      }
    }
    if (op === '*') {
      const repeat = (sequence: string | PyValue[], count: PyValue): PyValue => {
        const times = this.asInt(count, line);
        this.guardSize(sequence.length * Math.max(times, 0), line);
        return typeof sequence === 'string'
          ? sequence.repeat(Math.max(times, 0))
          : Array.from({ length: Math.max(times, 0) }, () => sequence).flat();
      };
      if (typeof left === 'string' || Array.isArray(left)) return repeat(left, right);
      if (typeof right === 'string' || Array.isArray(right)) return repeat(right, left);
    }

    if (typeof left !== 'number' || typeof right !== 'number') {
      throw new PyTypeError(
        `unsupported operand types for ${op}: ${pyRepr(left)} and ${pyRepr(right)}`,
        line,
      );
    }
    switch (op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/':
        if (right === 0) throw new PyZeroDivisionError(line);
        return left / right;
      case '//':
        if (right === 0) throw new PyZeroDivisionError(line);
        return Math.floor(left / right);
      case '%':
        if (right === 0) throw new PyZeroDivisionError(line);
        return ((left % right) + right) % right;
      case '**': {
        const result = left ** right;
        if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) {
          throw new PyBudgetError('that number is too large to work with', line);
        }
        return result;
      }
      default:
        throw new PyTypeError(`unknown operator ${op}`, line);
    }
  }

  private compare(op: string, left: PyValue, right: PyValue, line: number): boolean {
    switch (op) {
      case '==': return pyEquals(left, right);
      case '!=': return !pyEquals(left, right);
      case 'is': return left === right || pyEquals(left, right);
      case 'is not': return !(left === right || pyEquals(left, right));
      case 'in':
      case 'not in': {
        let found: boolean;
        if (Array.isArray(right)) found = right.some((item) => pyEquals(item, left));
        else if (typeof right === 'string') found = right.includes(pyStr(left));
        else if (right instanceof PyDict) found = right.has(left);
        else throw new PyTypeError(`'in' needs a list, string or dictionary on the right`, line);
        return op === 'in' ? found : !found;
      }
      default: {
        if (typeof left === 'number' && typeof right === 'number') {
          return op === '<' ? left < right : op === '<=' ? left <= right : op === '>' ? left > right : left >= right;
        }
        if (typeof left === 'string' && typeof right === 'string') {
          return op === '<' ? left < right : op === '<=' ? left <= right : op === '>' ? left > right : left >= right;
        }
        throw new PyTypeError(`cannot compare ${pyRepr(left)} with ${pyRepr(right)} using ${op}`, line);
      }
    }
  }
}

/** One-shot convenience wrapper. */
export function runPython(source: string, budget: Budget = DEFAULT_BUDGET): RunResult {
  return new Interpreter(budget).run(source);
}
