// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/ui/app.js';
import { generateCaseWithReference } from '../src/engine/generator.js';
import type { Difficulty } from '../src/types.js';

/** Drives the real App the way a player would, through the DOM. */
class Harness {
  readonly root = document.createElement('div');

  constructor() {
    document.body.replaceChildren(this.root);
  }

  start(): void {
    new App(this.root).start();
  }

  byText(text: string): HTMLElement | undefined {
    return [...this.root.querySelectorAll<HTMLElement>('button, a')].find(
      (node) => (node.textContent ?? '').includes(text),
    );
  }

  click(text: string): void {
    const node = this.byText(text);
    if (!node) throw new Error(`no clickable element containing "${text}"`);
    node.click();
  }

  get editor(): HTMLTextAreaElement {
    const node = this.root.querySelector<HTMLTextAreaElement>('textarea.editor');
    if (!node) throw new Error('editor is not on screen');
    return node;
  }

  type(source: string): void {
    this.editor.value = source;
    this.editor.dispatchEvent(new Event('input'));
  }

  get text(): string {
    return this.root.textContent ?? '';
  }

  /** The loader defers a frame so the loading state paints. */
  async settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  async openCase(seed: string, difficulty: Difficulty = 'detective'): Promise<void> {
    window.history.replaceState({}, '', `/?seed=${seed}&difficulty=${difficulty}`);
    this.start();
    await this.settle();
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
  delete document.documentElement.dataset.theme;
  // jsdom has no matchMedia; the theme module must cope, and tests that care
  // about the system preference install their own stub.
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('opening screen', () => {
  it('offers a seed, difficulties and a way in', () => {
    const app = new Harness();
    app.start();
    expect(app.text).toContain('CIPHER');
    expect(app.root.querySelector<HTMLInputElement>('#seed-input')?.value).toMatch(/^CH-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(app.root.querySelectorAll('.choice')).toHaveLength(3);
    expect(app.byText('Open the case file')).toBeTruthy();
  });

  it('rejects an unreadable seed instead of opening a broken case', async () => {
    const app = new Harness();
    app.start();
    const input = app.root.querySelector<HTMLInputElement>('#seed-input')!;
    input.value = '!!!';
    app.click('Open the case file');
    await app.settle();
    expect(app.root.querySelector('textarea.editor')).toBeNull();
    expect(document.getElementById('toast')?.textContent).toContain('cannot be read');
  });
});

describe('playing a case through the DOM', () => {
  it('locks later stages and unlocks exactly one per correct answer', async () => {
    const seed = 'CH-UI-TEST1';
    const { generated, reference } = generateCaseWithReference(seed, 'detective');
    const app = new Harness();
    await app.openCase(seed);

    const stageButtons = (): HTMLElement[] => [...app.root.querySelectorAll<HTMLElement>('.stage-btn')];
    expect(stageButtons()).toHaveLength(5);
    expect(stageButtons().filter((b) => b.getAttribute('aria-disabled') === 'true')).toHaveLength(4);

    // Clicking a locked stage does nothing.
    stageButtons()[3]!.click();
    expect(app.root.textContent).toContain(generated.stages[0]!.title);

    for (let stage = 1; stage <= 5; stage++) {
      app.type(reference.find((r) => r.stage === stage)!.code);
      app.click('Run code');
      expect(app.text, `stage ${stage} feedback`).toContain('Correct');
      expect(stageButtons().filter((b) => b.dataset.state === 'solved')).toHaveLength(stage);
      // Exactly one more stage is reachable than before: the rest stay locked.
      expect(stageButtons().filter((b) => b.getAttribute('aria-disabled') === 'true')).toHaveLength(
        Math.max(0, 4 - stage),
      );
      if (stage < 5) app.click('Next stage');
    }

    expect(app.text).toContain('Name the person who did it');
  });

  it('gives different feedback for wrong logic, bad syntax and a crash', async () => {
    const app = new Harness();
    await app.openCase('CH-UI-TEST2');

    app.type('print("nowhere near it")');
    app.click('Run code');
    expect(app.text).toContain('Not it');

    app.type('print("unclosed');
    app.click('Run code');
    expect(app.text).toContain('Python could not read that');

    app.type('print(missing_name)');
    app.click('Run code');
    expect(app.text).toContain('It broke while running');
    expect(app.text).toContain('NameError');
  });

  it('shows program output in the console', async () => {
    const app = new Harness();
    await app.openCase('CH-UI-TEST3');
    app.type('print("hello")\nprint(2 + 2)');
    app.click('Run code');
    const consoleText = app.root.querySelector('.console')?.textContent ?? '';
    expect(consoleText).toContain('hello');
    expect(consoleText).toContain('4');
  });

  it('reveals hints one at a time and earns another after a wrong answer', async () => {
    const app = new Harness();
    await app.openCase('CH-UI-TEST4');

    app.click('Hint 0/2');
    expect(app.root.querySelectorAll('.hint-box')).toHaveLength(1);
    // The second hint is the worked example, held back until an attempt is made.
    expect(app.byText('Hint 1/2')?.hasAttribute('disabled')).toBe(true);

    app.type('print("wrong")');
    app.click('Run code');
    app.click('Hint 1/2');
    expect(app.root.querySelectorAll('.hint-box')).toHaveLength(2);
  });

  it('spends an investigation action only on a wrong answer that ran', async () => {
    const app = new Harness();
    await app.openCase('CH-UI-TEST5');
    const actions = (): string =>
      [...app.root.querySelectorAll('.chip')].map((n) => n.textContent ?? '').find((t) => t.includes('actions')) ?? '';
    expect(actions()).toContain('3 actions');

    app.type('print(');
    app.click('Run code');
    expect(actions()).toContain('3 actions');

    app.type('print("still wrong")');
    app.click('Run code');
    expect(actions()).toContain('2 actions');
  });
});

describe('evidence panels', () => {
  it('switches between clues, suspects and timeline', async () => {
    const app = new Harness();
    const seed = 'CH-UI-TEST6';
    const { generated } = generateCaseWithReference(seed, 'detective');
    await app.openCase(seed);

    app.click('Suspects');
    for (const suspect of generated.suspects) expect(app.text).toContain(suspect.name);

    app.click('Timeline');
    expect(app.root.querySelectorAll('.timeline li').length).toBeGreaterThan(0);

    app.click('Clues');
    expect(app.root.querySelectorAll('.card').length).toBeGreaterThan(0);
  });

  it('keeps late evidence sealed until it is earned', async () => {
    const seed = 'CH-UI-TEST7';
    const { generated } = generateCaseWithReference(seed, 'detective');
    const app = new Harness();
    await app.openCase(seed);
    const lateClue = generated.clues.find((clue) => clue.revealedByStage === 5)!;
    expect(app.text).not.toContain(lateClue.body);
  });
});

describe('persistence', () => {
  it('resumes a case from storage with progress intact', async () => {
    const seed = 'CH-UI-TEST8';
    const { reference } = generateCaseWithReference(seed, 'detective');
    const first = new Harness();
    await first.openCase(seed);
    first.type(reference[0]!.code);
    first.click('Run code');
    expect(first.text).toContain('Correct');

    // A fresh App instance, as if the page had been reloaded.
    window.history.replaceState({}, '', '/');
    const second = new Harness();
    second.start();
    expect(second.text).toContain('1/5 stages solved');
    second.click('Resume');
    await second.settle();
    expect(second.root.querySelectorAll('.stage-btn[data-state="solved"]')).toHaveLength(1);
  });

  it('survives corrupted saved state', async () => {
    window.localStorage.setItem('cipher-heist/save/v2', '{not json at all');
    const app = new Harness();
    app.start();
    expect(app.text).toContain('CIPHER');
    expect(app.byText('Resume')).toBeUndefined();
  });
});

describe('finale and replay', () => {
  async function playToEnd(seed: string): Promise<Harness> {
    const { reference } = generateCaseWithReference(seed, 'detective');
    const app = new Harness();
    await app.openCase(seed);
    for (let stage = 1; stage <= 5; stage++) {
      app.type(reference.find((r) => r.stage === stage)!.code);
      app.click('Run code');
      if (stage < 5) app.click('Next stage');
    }
    return app;
  }

  it('closes the case correctly when the right person is named', async () => {
    const seed = 'CH-UI-TEST9';
    const { generated } = generateCaseWithReference(seed, 'detective');
    const app = await playToEnd(seed);
    const culprit = generated.suspects.find((s) => s.id === generated.solution.culpritId)!;

    app.click(culprit.name);
    app.click('Close the case');
    expect(app.text).toContain('Case closed');
    // The role opens a sentence on the finale, so it is capitalised there.
    expect(app.text.toLowerCase()).toContain(culprit.role.toLowerCase());
  });

  it('reports a wrong accusation and still explains the truth', async () => {
    const seed = 'CH-UI-TEST10';
    const { generated } = generateCaseWithReference(seed, 'detective');
    const app = await playToEnd(seed);
    const innocent = generated.suspects.find((s) => s.id !== generated.solution.culpritId)!;
    const culprit = generated.suspects.find((s) => s.id === generated.solution.culpritId)!;

    app.click(innocent.name);
    app.click('Close the case');
    expect(app.text).toContain('Wrong call');
    expect(app.text).toContain(culprit.name);
  });

  it('replays into a genuinely different case', async () => {
    const app = await playToEnd('CH-UI-TEST11');
    const { generated: first } = generateCaseWithReference('CH-UI-TEST11', 'detective');
    app.click(first.suspects[0]!.name);
    app.click('Close the case');
    expect(app.text).toContain('Your investigation');

    app.click('New case, new seed');
    await app.settle();
    const title = app.root.querySelector('.topbar__title')?.textContent ?? '';
    const suspectsNow = [...app.root.querySelectorAll('.accuse-option__name')].map((n) => n.textContent);
    expect(title).toBeTruthy();
    expect(suspectsNow).not.toEqual(first.suspects.map((s) => s.name));
    expect(app.root.querySelectorAll('.stage-btn[data-state="solved"]')).toHaveLength(0);
  });
});

describe('evidence timing', () => {
  it('does not unseal a stage\'s evidence before that stage is solved', async () => {
    const seed = 'CH-UI-TEST12';
    const { generated, reference } = generateCaseWithReference(seed, 'detective');
    const app = new Harness();
    await app.openCase(seed);

    const stageTwoClue = generated.clues.find((clue) => clue.revealedByStage === 2)!;
    expect(app.text).not.toContain(stageTwoClue.body);

    app.type(reference[0]!.code);
    app.click('Run code');
    app.click('Next stage');
    // Reaching stage 2 is not the same as solving it.
    expect(app.text).not.toContain(stageTwoClue.body);

    app.type(reference[1]!.code);
    app.click('Run code');
    expect(app.text).toContain(stageTwoClue.body);
  });
});

describe('keyboard use', () => {
  it('indents with Tab and lets Escape out, so the editor is not a trap', async () => {
    const app = new Harness();
    await app.openCase('CH-UI-TEST13');
    const editor = app.editor;
    editor.focus();
    editor.value = '';
    editor.selectionStart = 0;
    editor.selectionEnd = 0;

    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(editor.value).toBe('    ');

    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.activeElement).not.toBe(editor);
  });

  it('runs the submission on Ctrl+Enter', async () => {
    const seed = 'CH-UI-TEST14';
    const { reference } = generateCaseWithReference(seed, 'detective');
    const app = new Harness();
    await app.openCase(seed);
    app.type(reference[0]!.code);
    app.editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(app.text).toContain('Correct');
  });

  it('keeps every interactive control reachable as a real button', async () => {
    const app = new Harness();
    await app.openCase('CH-UI-TEST15');
    const clickable = [...app.root.querySelectorAll<HTMLElement>('[onclick], .stage-btn, .tab, .choice')];
    for (const node of clickable) {
      expect(['BUTTON', 'A', 'INPUT'], node.className).toContain(node.tagName);
    }
  });
});

describe('going home', () => {
  it('returns to the case file without discarding the investigation', async () => {
    const seed = 'CH-UI-HOME1';
    const { reference } = generateCaseWithReference(seed, 'detective');
    const app = new Harness();
    await app.openCase(seed);

    app.type(reference[0]!.code);
    app.click('Run code');
    expect(app.text).toContain('Correct');

    app.click('Home');
    expect(app.text).toContain('Open the case file');
    // The save survives, and the opening screen offers it back.
    expect(app.byText('Resume')?.textContent).toContain('1/5 stages solved');
    expect(window.localStorage.getItem('cipher-heist/save/v2')).toBeTruthy();

    app.click('Resume');
    await app.settle();
    expect(app.root.querySelectorAll('.stage-btn[data-state="solved"]')).toHaveLength(1);
  });

  it('is reachable from the finale too', async () => {
    const seed = 'CH-UI-HOME2';
    const { generated, reference } = generateCaseWithReference(seed, 'detective');
    const app = new Harness();
    await app.openCase(seed);
    for (let stage = 1; stage <= 5; stage++) {
      app.type(reference.find((r) => r.stage === stage)!.code);
      app.click('Run code');
      if (stage < 5) app.click('Next stage');
    }
    app.click(generated.suspects[0]!.name);
    app.click('Close the case');
    expect(app.text).toContain('Your investigation');

    app.click('Home');
    expect(app.text).toContain('Open the case file');
  });
});

describe('theme', () => {
  const themeOf = (): string | undefined => document.documentElement.dataset.theme;
  const toggle = (app: Harness): void => {
    const button = app.root.querySelector<HTMLElement>('.theme-toggle');
    if (!button) throw new Error('no theme toggle on screen');
    button.click();
  };

  it('defaults to dark and switches on demand', () => {
    const app = new Harness();
    app.start();
    expect(themeOf()).toBe('dark');

    toggle(app);
    expect(themeOf()).toBe('light');

    toggle(app);
    expect(themeOf()).toBe('dark');
  });

  it('remembers the choice across a reload', () => {
    const first = new Harness();
    first.start();
    toggle(first);
    expect(themeOf()).toBe('light');

    delete document.documentElement.dataset.theme;
    const second = new Harness();
    second.start();
    expect(themeOf()).toBe('light');
  });

  it('follows the system preference when nothing has been chosen', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('light'), media: query }),
    });
    const app = new Harness();
    app.start();
    expect(themeOf()).toBe('light');
    expect(app.text).toContain('CIPHER');
  });

  it('is available on every screen, and survives a redraw', async () => {
    const seed = 'CH-UI-THEME1';
    const app = new Harness();
    app.start();
    expect(app.root.querySelector('.theme-toggle')).toBeTruthy(); // opening

    await app.openCase(seed);
    expect(app.root.querySelector('.theme-toggle')).toBeTruthy(); // investigation
    toggle(app);
    expect(themeOf()).toBe('light');

    app.click('Suspects');
    expect(themeOf()).toBe('light');
    expect(app.root.querySelector('.theme-toggle')).toBeTruthy();
  });
});
