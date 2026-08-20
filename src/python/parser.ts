/**
 * Recursive-descent parser for the Python subset.
 *
 * Parsing is a separate phase from execution on purpose: every problem the
 * parser finds is reported as a SyntaxError with a line number *before* any
 * code runs, which is what lets the grader tell "this does not parse" apart
 * from "this ran but produced the wrong answer".
 */

import type {
  AssignTarget, BinaryOp, CompareOp, Expr, Program, Stmt,
} from './ast.js';
import { PySyntaxError } from './errors.js';
import { tokenize, type Token } from './lexer.js';

export function parse(source: string): Program {
  return new Parser(tokenize(source)).parseProgram();
}

/** Binding powers, loosest first. */
const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parseProgram(): Program {
    const body: Stmt[] = [];
    this.skipNewlines();
    while (!this.atEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return { body };
  }

  // ── token helpers ──────────────────────────────────────────────────────
  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] as Token;
  }

  private atEnd(): boolean {
    return this.peek().type === 'eof';
  }

  private get line(): number {
    return this.peek().line;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== 'eof') this.pos++;
    return token;
  }

  private check(type: Token['type'], value?: string): boolean {
    const token = this.peek();
    return token.type === type && (value === undefined || token.value === value);
  }

  private match(type: Token['type'], value?: string): boolean {
    if (!this.check(type, value)) return false;
    this.advance();
    return true;
  }

  private expect(type: Token['type'], value?: string, hint?: string): Token {
    if (!this.check(type, value)) {
      const found = this.describe(this.peek());
      const wanted = value ? `'${value}'` : type;
      throw new PySyntaxError(hint ?? `expected ${wanted} but found ${found}`, this.line);
    }
    return this.advance();
  }

  private describe(token: Token): string {
    switch (token.type) {
      case 'eof': return 'end of program';
      case 'newline': return 'end of line';
      case 'indent': return 'an indented line';
      case 'dedent': return 'a dedented line';
      default: return `'${token.value}'`;
    }
  }

  private skipNewlines(): void {
    while (this.check('newline')) this.advance();
  }

  // ── statements ─────────────────────────────────────────────────────────
  private parseStatement(): Stmt {
    const token = this.peek();
    if (token.type === 'keyword') {
      switch (token.value) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'for': return this.parseFor();
        case 'def': return this.parseFuncDef();
        case 'return': return this.parseReturn();
        case 'break': this.advance(); this.endStatement(); return { type: 'Break', line: token.line };
        case 'continue': this.advance(); this.endStatement(); return { type: 'Continue', line: token.line };
        case 'pass': this.advance(); this.endStatement(); return { type: 'Pass', line: token.line };
        case 'elif':
        case 'else':
          throw new PySyntaxError(`'${token.value}' without a matching 'if'`, token.line);
      }
    }
    return this.parseSimpleStatement();
  }

  private endStatement(): void {
    if (this.check('newline') || this.check('eof') || this.check('dedent')) {
      this.match('newline');
      return;
    }
    throw new PySyntaxError(`unexpected ${this.describe(this.peek())} after the end of a statement`, this.line);
  }

  private parseSimpleStatement(): Stmt {
    const line = this.line;
    const first = this.parseExpression();

    const augOps: Record<string, BinaryOp> = {
      '+=': '+', '-=': '-', '*=': '*', '/=': '/', '//=': '//', '**=': '**', '%=': '%',
    };
    const opToken = this.peek();
    if (opToken.type === 'op' && opToken.value in augOps) {
      this.advance();
      const value = this.parseExpression();
      this.endStatement();
      return {
        type: 'AugAssign',
        target: this.toTarget(first),
        op: augOps[opToken.value] as BinaryOp,
        value,
        line,
      };
    }

    if (this.check('op', '=')) {
      const targets: AssignTarget[] = [this.toTarget(first)];
      let value: Expr = first;
      while (this.match('op', '=')) {
        value = this.parseExpression();
        if (this.check('op', '=')) targets.push(this.toTarget(value));
      }
      this.endStatement();
      return { type: 'Assign', targets, value, line };
    }

    this.endStatement();
    return { type: 'ExprStmt', value: first, line };
  }

  private toTarget(expr: Expr): AssignTarget {
    if (expr.type === 'Name') return { type: 'NameTarget', id: expr.id, line: expr.line };
    if (expr.type === 'Index') {
      return { type: 'IndexTarget', object: expr.object, index: expr.index, line: expr.line };
    }
    throw new PySyntaxError('cannot assign to this expression', expr.line);
  }

  private parseBlock(keyword: string): Stmt[] {
    this.expect('op', ':', `expected ':' at the end of the '${keyword}' line`);
    this.skipNewlines();
    if (!this.check('indent')) {
      throw new PySyntaxError(
        `the body of '${keyword}' must be indented on the next line`,
        this.line,
      );
    }
    this.advance();
    const body: Stmt[] = [];
    this.skipNewlines();
    while (!this.check('dedent') && !this.atEnd()) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    this.match('dedent');
    if (body.length === 0) throw new PySyntaxError(`'${keyword}' block is empty`, this.line);
    return body;
  }

  private parseIf(): Stmt {
    const line = this.line;
    this.advance();
    const branches: { condition: Expr | null; body: Stmt[] }[] = [];
    branches.push({ condition: this.parseExpression(), body: this.parseBlock('if') });

    for (;;) {
      const save = this.pos;
      this.skipNewlines();
      if (this.check('keyword', 'elif')) {
        this.advance();
        branches.push({ condition: this.parseExpression(), body: this.parseBlock('elif') });
        continue;
      }
      if (this.check('keyword', 'else')) {
        this.advance();
        branches.push({ condition: null, body: this.parseBlock('else') });
        break;
      }
      this.pos = save;
      break;
    }
    return { type: 'If', branches, line };
  }

  private parseWhile(): Stmt {
    const line = this.line;
    this.advance();
    const condition = this.parseExpression();
    return { type: 'While', condition, body: this.parseBlock('while'), line };
  }

  private parseFor(): Stmt {
    const line = this.line;
    this.advance();
    const targets = [this.expect('name', undefined, "expected a loop variable after 'for'").value];
    while (this.match('op', ',')) targets.push(this.expect('name').value);
    this.expect('keyword', 'in', "expected 'in' after the loop variable");
    const iter = this.parseExpression();
    return { type: 'For', targets, iter, body: this.parseBlock('for'), line };
  }

  private parseFuncDef(): Stmt {
    const line = this.line;
    this.advance();
    const name = this.expect('name', undefined, "expected a function name after 'def'").value;
    this.expect('op', '(', `expected '(' after the function name '${name}'`);
    const params: { name: string; default: Expr | null }[] = [];
    while (!this.check('op', ')')) {
      const paramName = this.expect('name', undefined, 'expected a parameter name').value;
      let fallback: Expr | null = null;
      if (this.match('op', '=')) fallback = this.parseExpression();
      params.push({ name: paramName, default: fallback });
      if (!this.match('op', ',')) break;
    }
    this.expect('op', ')', "expected ')' to close the parameter list");
    return { type: 'FuncDef', name, params, body: this.parseBlock('def'), line };
  }

  private parseReturn(): Stmt {
    const line = this.line;
    this.advance();
    if (this.check('newline') || this.check('eof') || this.check('dedent')) {
      this.endStatement();
      return { type: 'Return', value: null, line };
    }
    const value = this.parseExpression();
    this.endStatement();
    return { type: 'Return', value, line };
  }

  // ── expressions ────────────────────────────────────────────────────────
  parseExpression(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const whenTrue = this.parseOr();
    if (this.check('keyword', 'if')) {
      const line = this.line;
      this.advance();
      const condition = this.parseOr();
      this.expect('keyword', 'else', "conditional expression needs an 'else'");
      const whenFalse = this.parseTernary();
      return { type: 'Ternary', whenTrue, condition, whenFalse, line };
    }
    return whenTrue;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.check('keyword', 'or')) {
      const line = this.line;
      this.advance();
      left = { type: 'BoolOp', op: 'or', left, right: this.parseAnd(), line };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    while (this.check('keyword', 'and')) {
      const line = this.line;
      this.advance();
      left = { type: 'BoolOp', op: 'and', left, right: this.parseNot(), line };
    }
    return left;
  }

  private parseNot(): Expr {
    if (this.check('keyword', 'not')) {
      const line = this.line;
      this.advance();
      return { type: 'Unary', op: 'not', operand: this.parseNot(), line };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    let left = this.parseArithmetic();
    for (;;) {
      const token = this.peek();
      let op: CompareOp | null = null;
      if (token.type === 'op' && COMPARE_OPS.has(token.value)) {
        op = token.value as CompareOp;
        this.advance();
      } else if (token.type === 'keyword' && token.value === 'in') {
        op = 'in';
        this.advance();
      } else if (token.type === 'keyword' && token.value === 'is') {
        this.advance();
        op = this.match('keyword', 'not') ? 'is not' : 'is';
      } else if (token.type === 'keyword' && token.value === 'not' && this.peek(1).value === 'in') {
        this.advance();
        this.advance();
        op = 'not in';
      }
      if (!op) return left;
      // Python chains comparisons (a < b < c); the subset evaluates them
      // left to right as `(a < b) < c` would be wrong, so chain with `and`.
      const right = this.parseArithmetic();
      const comparison: Expr = { type: 'Compare', op, left: stripChain(left), right, line: token.line };
      left = isComparison(left)
        ? { type: 'BoolOp', op: 'and', left, right: comparison, line: token.line }
        : comparison;
    }
  }

  private parseArithmetic(): Expr {
    let left = this.parseTerm();
    while (this.check('op', '+') || this.check('op', '-')) {
      const token = this.advance();
      left = { type: 'BinOp', op: token.value as BinaryOp, left, right: this.parseTerm(), line: token.line };
    }
    return left;
  }

  private parseTerm(): Expr {
    let left = this.parseUnary();
    while (this.check('op', '*') || this.check('op', '/') || this.check('op', '//') || this.check('op', '%')) {
      const token = this.advance();
      left = { type: 'BinOp', op: token.value as BinaryOp, left, right: this.parseUnary(), line: token.line };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.check('op', '-') || this.check('op', '+')) {
      const token = this.advance();
      return { type: 'Unary', op: token.value as '-' | '+', operand: this.parseUnary(), line: token.line };
    }
    return this.parsePower();
  }

  private parsePower(): Expr {
    const base = this.parsePostfix();
    if (this.check('op', '**')) {
      const token = this.advance();
      // Right associative: 2 ** 3 ** 2 == 2 ** 9.
      return { type: 'BinOp', op: '**', left: base, right: this.parseUnary(), line: token.line };
    }
    return base;
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.check('op', '(')) {
        expr = this.parseCall(expr);
        continue;
      }
      if (this.check('op', '[')) {
        expr = this.parseSubscript(expr);
        continue;
      }
      if (this.check('op', '.')) {
        const token = this.advance();
        const name = this.expect('name', undefined, "expected an attribute name after '.'").value;
        expr = { type: 'Attribute', object: expr, name, line: token.line };
        continue;
      }
      return expr;
    }
  }

  private parseCall(callee: Expr): Expr {
    const token = this.expect('op', '(');
    const args: Expr[] = [];
    const kwargs: { name: string; value: Expr }[] = [];
    while (!this.check('op', ')')) {
      if (this.check('name') && this.peek(1).type === 'op' && this.peek(1).value === '=') {
        const name = this.advance().value;
        this.advance();
        kwargs.push({ name, value: this.parseExpression() });
      } else {
        args.push(this.parseExpression());
      }
      if (!this.match('op', ',')) break;
    }
    this.expect('op', ')', "expected ')' to close this call");
    return { type: 'Call', callee, args, kwargs, line: token.line };
  }

  private parseSubscript(object: Expr): Expr {
    const token = this.expect('op', '[');
    const readSlot = (): Expr | null =>
      this.check('op', ':') || this.check('op', ']') ? null : this.parseExpression();

    const start = readSlot();
    if (this.check('op', ':')) {
      this.advance();
      const stop = readSlot();
      let step: Expr | null = null;
      if (this.match('op', ':')) step = readSlot();
      this.expect('op', ']', "expected ']' to close this slice");
      return { type: 'Slice', object, start, stop, step, line: token.line };
    }
    this.expect('op', ']', "expected ']' to close this index");
    if (start === null) throw new PySyntaxError('empty index - what should go between the brackets?', token.line);
    return { type: 'Index', object, index: start, line: token.line };
  }

  private parsePrimary(): Expr {
    const token = this.peek();
    const line = token.line;

    if (token.type === 'number') {
      this.advance();
      return { type: 'Num', value: Number(token.value), line };
    }
    if (token.type === 'string') {
      this.advance();
      return { type: 'Str', value: token.value, line };
    }
    if (token.type === 'fstring') {
      this.advance();
      return { type: 'FStr', raw: token.value, line };
    }
    if (token.type === 'name') {
      this.advance();
      return { type: 'Name', id: token.value, line };
    }
    if (token.type === 'keyword') {
      if (token.value === 'True' || token.value === 'False') {
        this.advance();
        return { type: 'Bool', value: token.value === 'True', line };
      }
      if (token.value === 'None') {
        this.advance();
        return { type: 'None', line };
      }
    }
    if (this.check('op', '(')) {
      this.advance();
      if (this.match('op', ')')) return { type: 'Tuple', items: [], line };
      const first = this.parseExpression();
      if (this.check('op', ',')) {
        const items = [first];
        while (this.match('op', ',')) {
          if (this.check('op', ')')) break;
          items.push(this.parseExpression());
        }
        this.expect('op', ')', "expected ')' to close this tuple");
        return { type: 'Tuple', items, line };
      }
      this.expect('op', ')', "expected ')' to close this group");
      return first;
    }
    if (this.check('op', '[')) {
      this.advance();
      if (this.match('op', ']')) return { type: 'List', items: [], line };
      const first = this.parseExpression();
      if (this.check('keyword', 'for')) {
        this.advance();
        const target = this.expect('name', undefined, 'expected a variable name in the comprehension').value;
        this.expect('keyword', 'in', "expected 'in' in the comprehension");
        const iter = this.parseOr();
        let condition: Expr | null = null;
        if (this.match('keyword', 'if')) condition = this.parseOr();
        this.expect('op', ']', "expected ']' to close this comprehension");
        return { type: 'Comp', element: first, target, iter, condition, line };
      }
      const items = [first];
      while (this.match('op', ',')) {
        if (this.check('op', ']')) break;
        items.push(this.parseExpression());
      }
      this.expect('op', ']', "expected ']' to close this list");
      return { type: 'List', items, line };
    }
    if (this.check('op', '{')) {
      this.advance();
      const entries: { key: Expr; value: Expr }[] = [];
      while (!this.check('op', '}')) {
        const key = this.parseExpression();
        this.expect('op', ':', "expected ':' between a dictionary key and its value");
        entries.push({ key, value: this.parseExpression() });
        if (!this.match('op', ',')) break;
      }
      this.expect('op', '}', "expected '}' to close this dictionary");
      return { type: 'Dict', entries, line };
    }

    if (token.type === 'newline' || token.type === 'eof') {
      throw new PySyntaxError('the statement ends before it is complete', line);
    }
    throw new PySyntaxError(`unexpected ${this.describe(token)}`, line);
  }
}

function isComparison(expr: Expr): boolean {
  return expr.type === 'Compare' || (expr.type === 'BoolOp' && expr.op === 'and' && isComparison(expr.right));
}

/** For chained comparisons, `a < b < c` compares `b` against `c`, not `a < b`. */
function stripChain(expr: Expr): Expr {
  if (expr.type === 'Compare') return expr.right;
  if (expr.type === 'BoolOp' && expr.op === 'and' && isComparison(expr.right)) return stripChain(expr.right);
  return expr;
}
