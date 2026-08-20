/**
 * Error taxonomy for the Python subset.
 *
 * The grader leans on this split: a `PySyntaxError` means "your code did not
 * parse", anything else means "your code ran and did something else than
 * asked". Those two need very different feedback.
 */

export class PyError extends Error {
  constructor(
    message: string,
    readonly kind: string,
    readonly line: number,
  ) {
    super(message);
    this.name = kind;
  }

  /** Rendered the way CPython would show it, minus the traceback. */
  format(): string {
    return `${this.kind}: ${this.message}`;
  }
}

export class PySyntaxError extends PyError {
  constructor(message: string, line: number) {
    super(message, 'SyntaxError', line);
  }
}

export class PyNameError extends PyError {
  constructor(name: string, line: number) {
    super(`name '${name}' is not defined`, 'NameError', line);
  }
}

export class PyTypeError extends PyError {
  constructor(message: string, line: number) {
    super(message, 'TypeError', line);
  }
}

export class PyIndexError extends PyError {
  constructor(message: string, line: number) {
    super(message, 'IndexError', line);
  }
}

export class PyValueError extends PyError {
  constructor(message: string, line: number) {
    super(message, 'ValueError', line);
  }
}

export class PyZeroDivisionError extends PyError {
  constructor(line: number) {
    super('division by zero', 'ZeroDivisionError', line);
  }
}

export class PyAttributeError extends PyError {
  constructor(message: string, line: number) {
    super(message, 'AttributeError', line);
  }
}

/**
 * Raised when a program exceeds its execution budget. This is the guard that
 * stops `while True:` or `for i in range(10**9)` from freezing the tab - the
 * old interpreter had only a partial version of it.
 */
export class PyBudgetError extends PyError {
  constructor(message: string, line: number) {
    super(message, 'ExecutionLimit', line);
  }
}
