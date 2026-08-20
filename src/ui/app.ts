/**
 * Application state and wiring.
 *
 * The UI owns no game rules: it asks `engine/progress.ts` what is unlocked and
 * `grader/` whether an answer is right, then draws the answer. Case data is
 * regenerated from the seed on every load, so nothing about the case is ever
 * trusted from storage.
 */

import type { Case, CaseResult, Difficulty, GradeResult, PlayerProgress } from '../types.js';
import { generateCase } from '../engine/generator.js';
import { validateCase } from '../engine/validate.js';
import {
  accuse, applyGrade, availableHints, createProgress, isStageSolved, reconcile, useHint,
} from '../engine/progress.js';
import { randomSeed } from '../engine/seed.js';
import {
  clearDrafts, clearGame, isStorageAvailable, loadDraft, loadGame, saveDraft, saveGame,
} from '../engine/storage.js';
import { LocalGrader, type GradingClient } from '../grader/grader.js';
import { announce, clear, h, toast } from './dom.js';
import { renderOpening } from './opening.js';
import { initTheme } from './theme.js';
import { renderFinale } from './finale.js';
import {
  renderInvestigation, type EvidencePane, type EvidenceTab, type InvestigationView,
} from './investigation.js';

type Screen = 'opening' | 'loading' | 'investigation' | 'finale' | 'error';

interface AppState {
  screen: Screen;
  generated: Case | null;
  progress: PlayerProgress | null;
  result: CaseResult | null;
  view: InvestigationView;
  error: string | null;
}

const freshView = (): InvestigationView => ({
  tab: 'clues',
  pane: 'evidence',
  hintsShown: 0,
  lastResult: null,
  accused: null,
});

export class App {
  private state: AppState = {
    screen: 'opening',
    generated: null,
    progress: null,
    result: null,
    view: freshView(),
    error: null,
  };

  /** Kept across renders so typing is never interrupted by a redraw. */
  private editor: HTMLTextAreaElement | null = null;
  private editorStage = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly grader: GradingClient = new LocalGrader(),
  ) {}

  start(): void {
    initTheme();
    const fromUrl = new URLSearchParams(window.location.search);
    const seed = fromUrl.get('seed');
    const difficulty = fromUrl.get('difficulty') as Difficulty | null;
    if (seed) {
      this.openCase(seed, difficulty ?? 'detective');
      return;
    }
    this.render();
  }

  // ── case lifecycle ─────────────────────────────────────────────────────
  private openCase(seed: string, difficulty: Difficulty, existing?: PlayerProgress): void {
    this.state.screen = 'loading';
    this.render();

    // A frame of breathing room so the loading state is actually painted.
    window.setTimeout(() => {
      try {
        let generated = generateCase(seed, difficulty);
        let validation = validateCase(generated);

        // A case that fails its own invariants is a bug, but the player should
        // still get a game: fall back to a fresh seed rather than a dead end.
        let attempts = 0;
        while (!validation.valid && attempts < 5) {
          attempts++;
          generated = generateCase(randomSeed(), difficulty);
          validation = validateCase(generated);
        }
        if (!validation.valid) {
          this.fail(`This case could not be assembled: ${validation.problems[0] ?? 'unknown problem'}.`);
          return;
        }

        const progress =
          existing && existing.seed === generated.seed
            ? reconcile(generated, existing)
            : createProgress(generated);

        this.state = {
          screen: 'investigation',
          generated,
          progress,
          result: null,
          view: freshView(),
          error: null,
        };
        this.editor = null;
        this.persist();
        this.render();
        announce(`Case ${generated.seed} opened. Stage ${progress.currentStage} is active.`);
      } catch (error) {
        this.fail(error instanceof Error ? error.message : 'Something went wrong opening the case.');
      }
    }, 220);
  }

  private fail(message: string): void {
    this.state = { ...this.state, screen: 'error', error: message };
    this.render();
  }

  private persist(): void {
    const { generated, progress } = this.state;
    if (!generated || !progress) return;
    saveGame({ seed: generated.seed, difficulty: generated.difficulty, progress });
  }

  // ── editor ─────────────────────────────────────────────────────────────
  private ensureEditor(stageIndex: number): HTMLTextAreaElement {
    const { generated } = this.state;
    if (this.editor && this.editorStage === stageIndex) return this.editor;

    const stage = generated?.stages.find((s) => s.index === stageIndex);
    const draft = generated ? loadDraft(generated.seed, stageIndex) : null;

    const textarea = h('textarea', {
      class: 'editor',
      spellcheck: false,
      autocapitalize: 'off',
      autocomplete: 'off',
      autocorrect: 'off',
      'aria-label': `Python editor for stage ${stageIndex}. Tab indents; press Escape to leave the editor.`,
      value: draft ?? stage?.challenge.starterCode ?? '',
    });

    textarea.addEventListener('keydown', (event) => this.onEditorKey(event, textarea));
    textarea.addEventListener('input', () => {
      if (generated) saveDraft(generated.seed, stageIndex, textarea.value);
    });

    this.editor = textarea;
    this.editorStage = stageIndex;
    return textarea;
  }

  private onEditorKey(event: KeyboardEvent, textarea: HTMLTextAreaElement): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.run();
      return;
    }
    if (event.key === 'Escape') {
      // Tab indents inside the editor, so Escape is the documented way back
      // out: without it the editor would be a keyboard trap.
      textarea.blur();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      insertAtCursor(textarea, '    ');
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const before = textarea.value.slice(0, textarea.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = (line.match(/^[ ]*/)?.[0] ?? '') + (line.trimEnd().endsWith(':') ? '    ' : '');
      if (indent.length > 0) {
        event.preventDefault();
        insertAtCursor(textarea, `\n${indent}`);
      }
    }
  }

  // ── actions ────────────────────────────────────────────────────────────
  private run(): void {
    const { generated, progress } = this.state;
    if (!generated || !progress || !this.editor) return;
    const stageIndex = progress.currentStage;
    const stage = generated.stages.find((s) => s.index === stageIndex);
    if (!stage) return;

    const wasSolved = isStageSolved(generated, progress, stageIndex);
    const result: GradeResult = this.grader.grade(stage.challenge, this.editor.value);
    const applied = applyGrade(generated, progress, stageIndex, result);

    this.state.progress = applied.progress;
    this.state.view.lastResult = result;

    if (result.status === 'correct' && !wasSolved) {
      announce(`Stage ${stageIndex} solved. ${stage.branch.outcome}`);
    } else if (result.status !== 'correct') {
      announce(result.message);
      if (applied.spentAction) {
        const hints = availableHints(applied.progress, stageIndex, stage.challenge.hints.length);
        if (hints > this.state.view.hintsShown) toast('That cost you an action — another hint is available.');
      }
    }

    this.persist();
    this.render();
  }

  /**
   * Returns to the case file. The save is deliberately left alone - the
   * opening screen offers it back as "Resume", and starting a different seed
   * overwrites it at that point rather than the moment someone looks away.
   */
  private goHome(): void {
    this.state = {
      screen: 'opening',
      generated: null,
      progress: null,
      result: null,
      view: freshView(),
      error: null,
    };
    this.editor = null;
    this.render();
    window.scrollTo({ top: 0 });
  }

  private goToStage(index: number): void {
    const { generated, progress } = this.state;
    if (!generated || !progress) return;
    this.state.progress = reconcile(generated, { ...progress, currentStage: index });
    this.state.view = { ...freshView(), tab: this.state.view.tab, pane: this.state.view.pane };
    this.editor = null;
    this.persist();
    this.render();
  }

  private render(): void {
    clear(this.root);
    const { screen, generated, progress, result, view } = this.state;

    if (screen === 'loading') {
      this.root.append(
        stateScreen('Assembling the case file', 'Suspects, timeline, ciphers and one hidden solution.', true),
      );
      return;
    }

    if (screen === 'error') {
      this.root.append(
        stateScreen(
          'This case would not open',
          this.state.error ?? 'Unknown problem.',
          false,
          h('button', {
            class: 'btn btn--primary',
            type: 'button',
            text: 'Start a fresh case',
            onclick: () => {
              clearGame();
              this.state = { ...this.state, screen: 'opening', generated: null, progress: null, error: null };
              this.render();
            },
          }),
        ),
      );
      return;
    }

    if (screen === 'opening' || !generated || !progress) {
      const saved = loadGame();
      let resume = null as null | { seed: string; difficulty: Difficulty; solved: number; total: number };
      if (saved) {
        const solved = saved.progress.stages.filter((stage) => stage.unlockToken !== null).length;
        resume = { seed: saved.seed, difficulty: saved.difficulty, solved, total: saved.progress.stages.length };
      }
      this.root.append(
        renderOpening(
          {
            onThemeChange: () => this.render(),
            onOpen: (seed, difficulty) => this.openCase(seed, difficulty),
            onResume: () => {
              const game = loadGame();
              if (!game) {
                toast('That saved case could not be read.');
                return;
              }
              this.openCase(game.seed, game.difficulty, game.progress);
            },
          },
          resume,
        ),
      );
      if (!isStorageAvailable()) {
        this.root.append(
          h('p', {
            class: 'case-file__note',
            style: 'text-align:center;padding:0 20px 32px',
            text: 'Storage is unavailable in this browser, so progress will not be saved between visits. Keep your seed to come back to this case.',
          }),
        );
      }
      return;
    }

    if (screen === 'finale' && result) {
      this.root.append(
        renderFinale(generated, result, {
          onHome: () => this.goHome(),
          onThemeChange: () => this.render(),
          onNewCase: () => this.openCase(randomSeed(), generated.difficulty),
          onReplaySameSeed: () => {
            clearDrafts(generated.seed);
            this.openCase(generated.seed, generated.difficulty);
          },
          onCopySeed: () => this.copySeed(),
          onReview: () => {
            this.state.screen = 'investigation';
            this.render();
          },
        }),
      );
      return;
    }

    this.root.append(
      renderInvestigation({
        generated,
        progress,
        view,
        editor: this.ensureEditor(progress.currentStage),
        handlers: {
          onSelectStage: (index) => this.goToStage(index),
          onRun: () => this.run(),
          onReset: () => {
            const stage = generated.stages.find((s) => s.index === progress.currentStage);
            if (!this.editor || !stage) return;
            this.editor.value = stage.challenge.starterCode;
            saveDraft(generated.seed, stage.index, this.editor.value);
            this.state.view.lastResult = null;
            this.render();
          },
          onHint: () => {
            const stage = generated.stages.find((s) => s.index === progress.currentStage);
            if (!stage) return;
            const allowed = availableHints(progress, stage.index, stage.challenge.hints.length);
            if (view.hintsShown >= allowed) return;
            this.state.view.hintsShown += 1;
            this.state.progress = useHint(progress, stage.index);
            this.persist();
            this.render();
          },
          onNext: () => this.goToStage(Math.min(generated.stages.length, progress.currentStage + 1)),
          onTab: (tab: EvidenceTab) => {
            this.state.view.tab = tab;
            this.render();
          },
          onPane: (pane: EvidencePane) => {
            this.state.view.pane = pane;
            this.render();
          },
          onCopySeed: () => this.copySeed(),
          onHome: () => this.goHome(),
          onThemeChange: () => this.render(),
          onAbandon: () => {
            clearDrafts(generated.seed);
            this.openCase(generated.seed, generated.difficulty);
          },
          onAccuse: (suspectId) => {
            this.state.view.accused = suspectId;
            this.render();
          },
          onConfirmAccusation: () => {
            if (!view.accused) return;
            const outcome = accuse(generated, progress, view.accused);
            this.state.progress = outcome.progress;
            this.state.result = outcome.result;
            this.state.screen = 'finale';
            this.persist();
            this.render();
            window.scrollTo({ top: 0 });
          },
        },
      }),
    );
  }

  private copySeed(): void {
    const seed = this.state.generated?.seed;
    if (!seed) return;
    const url = `${window.location.origin}${window.location.pathname}?seed=${seed}&difficulty=${this.state.generated?.difficulty ?? 'detective'}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => toast(`Copied a link to case ${seed}`))
      .catch(() => toast(`Case seed: ${seed}`));
  }
}

function stateScreen(title: string, body: string, spinner: boolean, action?: HTMLElement): HTMLElement {
  return h(
    'main',
    { class: 'state-screen' },
    h(
      'div',
      { class: 'state-screen__inner' },
      spinner ? h('div', { class: 'spinner', role: 'img', 'aria-label': 'Working' }) : null,
      h('h2', { class: 'section__title', text: title }),
      h('p', { style: 'color:var(--text-2)', text: body }),
      action ?? null,
    ),
  );
}

function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
  textarea.selectionStart = start + text.length;
  textarea.selectionEnd = start + text.length;
  textarea.dispatchEvent(new Event('input'));
}
