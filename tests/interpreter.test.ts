import { describe, expect, it } from 'vitest';
import { runPython } from '../src/python/interpreter.js';

const out = (source: string): string[] => {
  const result = runPython(source);
  if (result.error) throw new Error(`${result.error.format()} (line ${result.error.line})`);
  return result.stdout;
};

describe('values and strings', () => {
  it('assigns, slices and reverses', () => {
    expect(out('name = "NITRAM"\nprint(name[::-1])')).toEqual(['MARTIN']);
    expect(out('s = "detective"\nprint(s[0], s[-1], s[1:4])')).toEqual(['d e ete']);
    expect(out('print("ab" * 3)')).toEqual(['ababab']);
  });

  it('supports string methods and f-strings', () => {
    expect(out('print("  hi ".strip().upper())')).toEqual(['HI']);
    expect(out('print("-".join(["a", "b"]))')).toEqual(['a-b']);
    expect(out('n = 4\nprint(f"clue {n} of {n + 1}")')).toEqual(['clue 4 of 5']);
  });
});

describe('lists, loops and comprehensions', () => {
  it('indexes and mutates', () => {
    expect(out('t = [10, 20, 30]\nprint(t[t.index(20) - 1])')).toEqual(['10']);
    expect(out('x = [3, 1, 2]\nx.sort()\nprint(x)')).toEqual(['[1, 2, 3]']);
  });

  it('runs for loops with accumulation', () => {
    expect(out('total = 0\nfor n in range(1, 5):\n    total += n\nprint(total)')).toEqual(['10']);
  });

  it('supports break, continue and while', () => {
    expect(out('for n in range(10):\n    if n == 3:\n        break\nprint(n)')).toEqual(['3']);
    expect(out('i = 0\nwhile i < 3:\n    i += 1\nprint(i)')).toEqual(['3']);
    expect(out('kept = []\nfor n in range(5):\n    if n % 2 == 0:\n        continue\n    kept.append(n)\nprint(kept)')).toEqual(['[1, 3]']);
  });

  it('evaluates comprehensions', () => {
    expect(out('print([n * 2 for n in range(4) if n % 2 == 0])')).toEqual(['[0, 4]']);
  });

  it('unpacks tuples in for targets', () => {
    expect(out('for i, c in enumerate(["a", "b"]):\n    print(i, c)')).toEqual(['0 a', '1 b']);
  });
});

describe('ciphers', () => {
  it('does chr/ord round trips', () => {
    expect(out('print(ord("A"), chr(66))')).toEqual(['65 B']);
    expect(
      out('codes = [87, 72, 84]\nmsg = ""\nfor c in codes:\n    msg += chr(c - 3)\nprint(msg)'),
    ).toEqual(['TEQ']);
  });
});

describe('functions', () => {
  it('defines, calls and returns', () => {
    expect(out('def score(a, b):\n    return a * 2 + b\nprint(score(3, 4))')).toEqual(['10']);
  });

  it('keeps locals out of globals but reads globals', () => {
    const result = runPython('base = 5\ndef f(x):\n    y = x + base\n    return y\nprint(f(1))');
    expect(result.stdout).toEqual(['6']);
    expect(result.globals).not.toHaveProperty('y');
  });

  it('supports default arguments and recursion', () => {
    expect(out('def add(a, b=10):\n    return a + b\nprint(add(1))')).toEqual(['11']);
    expect(out('def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\nprint(fact(5))')).toEqual(['120']);
  });
});

describe('conditionals and operators', () => {
  it('handles elif chains, and/or/not', () => {
    expect(out('n = 84\nif n % 7 == 0 and n % 4 == 0:\n    print("both")\nelif n % 7 == 0:\n    print("seven")\nelse:\n    print("neither")')).toEqual(['both']);
    expect(out('print(not False, True or False, 1 < 2 < 3)')).toEqual(['True True True']);
  });

  it('does integer and float arithmetic', () => {
    expect(out('print(7 // 2, 7 % 2, 2 ** 8, 7 / 2)')).toEqual(['3 1 256 3.5']);
    expect(out('print(-7 % 3)')).toEqual(['2']);
  });
});

describe('print options', () => {
  it('honours sep and end', () => {
    expect(out('print("a", "b", sep="-")')).toEqual(['a-b']);
    expect(out('for c in "abc":\n    print(c, end="")')).toEqual(['abc']);
  });
});

describe('error reporting', () => {
  it('reports syntax errors before running anything', () => {
    const result = runPython('print("first")\nif True\n    print("x")');
    expect(result.error?.kind).toBe('SyntaxError');
    expect(result.stdout).toEqual([]); // nothing ran
    expect(result.error?.line).toBe(2);
  });

  it('distinguishes runtime errors', () => {
    expect(runPython('print(mystery)').error?.kind).toBe('NameError');
    expect(runPython('print([1, 2][9])').error?.kind).toBe('IndexError');
    expect(runPython('print(1 / 0)').error?.kind).toBe('ZeroDivisionError');
    expect(runPython('print("a" + 1)').error?.kind).toBe('TypeError');
  });

  it('keeps output produced before a runtime error', () => {
    const result = runPython('print("ok")\nprint(missing)');
    expect(result.stdout).toEqual(['ok']);
    expect(result.error?.kind).toBe('NameError');
  });

  it('names a missing colon helpfully', () => {
    const result = runPython('for n in range(3)\n    print(n)');
    expect(result.error?.message).toContain("':'");
  });
});

describe('execution budget', () => {
  it('stops an infinite while loop', () => {
    const result = runPython('while True:\n    x = 1');
    expect(result.error?.kind).toBe('ExecutionLimit');
  });

  it('stops an enormous range', () => {
    const result = runPython('for i in range(100000000):\n    pass');
    expect(result.error?.kind).toBe('ExecutionLimit');
  });

  it('stops runaway recursion', () => {
    const result = runPython('def f(n):\n    return f(n + 1)\nprint(f(0))');
    expect(result.error?.kind).toBe('ExecutionLimit');
  });

  it('stops unbounded output', () => {
    const result = runPython('for i in range(5000):\n    print(i)');
    expect(result.error?.kind).toBe('ExecutionLimit');
  });

  it('stops memory blowups', () => {
    const result = runPython('x = [1] * 5000000');
    expect(result.error?.kind).toBe('ExecutionLimit');
  });
});

describe('sandbox', () => {
  it('cannot reach host globals', () => {
    for (const source of [
      'print(window)',
      'print(globalThis)',
      'print(document)',
      'print(fetch)',
      'print(process)',
      'print(constructor)',
      'print(localStorage)',
      'print(__proto__)',
      'print(eval)',
    ]) {
      const result = runPython(source);
      expect(result.error?.kind, source).toBe('NameError');
    }
  });

  it('cannot escape through attribute access on values', () => {
    const result = runPython('s = "x"\nprint(s.constructor)');
    expect(result.error).not.toBeNull();
    expect(result.stdout).toEqual([]);
  });

  it('does not import', () => {
    expect(runPython('import os').error?.kind).toBe('SyntaxError');
  });
});
