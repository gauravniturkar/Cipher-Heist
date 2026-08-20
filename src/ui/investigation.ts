/** The investigation screen: stage rail, evidence, and the Python panel. */

import type { Case, Clue, GradeResult, PlayerProgress, Stage, Suspect } from '../types.js';
import { secondsToClock } from '../engine/challenges.js';
import { availableHints, isStageSolved, solvedCount, stageState } from '../engine/progress.js';
import { narrowingAfterStage } from '../engine/solver.js';
import { h, paragraph, richText } from './dom.js';
import { themeToggle } from './theme.js';

export type EvidencePane = 'evidence' | 'code';
export type EvidenceTab = 'clues' | 'suspects' | 'timeline';

export interface InvestigationView {
  tab: EvidenceTab;
  pane: EvidencePane;
  hintsShown: number;
  lastResult: GradeResult | null;
  accused: string | null;
}

export interface InvestigationHandlers {
  onSelectStage(index: number): void;
  onRun(): void;
  onReset(): void;
  onHint(): void;
  onNext(): void;
  onTab(tab: EvidenceTab): void;
  onPane(pane: EvidencePane): void;
  onCopySeed(): void;
  onHome(): void;
  onAbandon(): void;
  onThemeChange(): void;
  onAccuse(suspectId: string): void;
  onConfirmAccusation(): void;
}

export interface InvestigationContext {
  generated: Case;
  progress: PlayerProgress;
  view: InvestigationView;
  editor: HTMLTextAreaElement;
  handlers: InvestigationHandlers;
}

export function renderInvestigation(ctx: InvestigationContext): HTMLElement {
  const { generated, progress, view } = ctx;
  const stage = generated.stages.find((s) => s.index === progress.currentStage) ?? (generated.stages[0] as Stage);
  const solved = solvedCount(generated, progress);
  const allSolved = solved === generated.stages.length;

  return h(
    'div',
    { class: 'app' },
    topbar(ctx, solved),
    h(
      'div',
      { class: 'layout' },
      rail(ctx, solved),
      h(
        'div',
        { class: 'column', 'data-pane': 'evidence', 'data-active': String(view.pane !== 'code') },
        storySection(ctx, stage),
        evidenceSection(ctx),
      ),
      h(
        'div',
        { class: 'column', 'data-pane': 'code', 'data-active': String(view.pane === 'code') },
        allSolved ? accusationPanel(ctx) : null,
        challengePanel(ctx, stage),
      ),
    ),
    mobileTabs(ctx),
  );
}

// ── topbar ───────────────────────────────────────────────────────────────
function topbar(ctx: InvestigationContext, solved: number): HTMLElement {
  const { generated, progress, handlers } = ctx;
  return h(
    'header',
    { class: 'topbar' },
    h(
      'button',
      {
        class: 'btn btn--ghost btn--small topbar__home',
        type: 'button',
        title: 'Back to the case file — this investigation is saved',
        'aria-label': 'Home: back to the case file',
        onclick: () => handlers.onHome(),
      },
      h('span', { 'aria-hidden': 'true', text: '←' }),
      h('span', { class: 'topbar__home-label', text: 'Home' }),
    ),
    h('h1', { class: 'topbar__title', text: generated.title }),
    h(
      'div',
      { class: 'topbar__meta' },
      h(
        'div',
        { class: 'progress-dots', role: 'img', 'aria-label': `${solved} of ${generated.stages.length} stages solved` },
        ...generated.stages.map((stage) =>
          h('span', { 'data-state': stageState(generated, progress, stage.index) }),
        ),
      ),
      h('span', {
        class: 'chip chip--teal',
        'data-optional': 'true',
        text: `${solved}/${generated.stages.length} solved`,
      }),
      h('span', {
        class: 'chip',
        title: 'Wrong answers that ran cleanly cost one action. Each one buys you another hint.',
        text: `${progress.investigationActions} actions`,
      }),
      h('button', {
        class: 'chip seed-chip',
        type: 'button',
        title: 'Copy this case seed',
        text: generated.seed,
        onclick: () => handlers.onCopySeed(),
      }),
      themeToggle(() => handlers.onThemeChange(), true),
    ),
  );
}

// ── stage rail ───────────────────────────────────────────────────────────
function rail(ctx: InvestigationContext, solved: number): HTMLElement {
  const { generated, progress, handlers } = ctx;

  const items = generated.stages.map((stage) => {
    const state = stageState(generated, progress, stage.index);
    const locked = state === 'locked';
    return h(
      'li',
      {},
      h(
        'button',
        {
          class: 'stage-btn',
          type: 'button',
          'data-state': state,
          'aria-disabled': String(locked),
          'aria-current': String(stage.index === progress.currentStage),
          onclick: () => { if (!locked) handlers.onSelectStage(stage.index); },
        },
        h('span', { class: 'stage-btn__num', text: String(stage.index).padStart(2, '0') }),
        h(
          'span',
          {},
          h('span', { class: 'stage-btn__name', text: locked ? 'Locked' : stage.title }),
          h('span', { class: 'stage-btn__concept', text: stage.conceptLabel }),
        ),
        h('span', {
          class: 'stage-btn__mark',
          'aria-hidden': 'true',
          text: state === 'solved' ? '✓' : locked ? '🔒' : '●',
        }),
      ),
    );
  });

  return h(
    'nav',
    { class: 'rail panel', 'aria-label': 'Investigation stages' },
    h('ul', { class: 'rail__list' }, ...items),
    h(
      'div',
      { class: 'rail__footer' },
      h('span', { class: 'eyebrow', text: `${solved} of ${generated.stages.length} stages cleared` }),
      h('button', { class: 'btn btn--small btn--ghost', type: 'button', onclick: () => handlers.onAbandon() }, 'Restart this case'),
    ),
  );
}

// ── story ────────────────────────────────────────────────────────────────
function storySection(ctx: InvestigationContext, stage: Stage): HTMLElement {
  const { generated, progress } = ctx;
  const solvedHere = isStageSolved(generated, progress, stage.index);

  const section = h(
    'section',
    { class: 'panel section', 'aria-labelledby': 'story-title' },
    h(
      'div',
      { class: 'section__head' },
      h(
        'div',
        {},
        h('span', { class: 'eyebrow', text: `Stage ${stage.index} · ${stage.conceptLabel}` }),
        h('h2', { class: 'section__title', id: 'story-title', text: stage.title }),
      ),
      h('span', {
        class: solvedHere ? 'chip chip--teal' : 'chip chip--amber',
        text: solvedHere ? 'Solved' : 'Open',
      }),
    ),
    h(
      'div',
      { class: 'story' },
      paragraph(generated.setting.incident, 'drop'),
      ...stage.story.map((line) => paragraph(line)),
    ),
  );

  if (solvedHere) {
    section.append(
      h(
        'div',
        { class: 'outcome' },
        h('div', { class: 'outcome__label', text: 'What that told you' }),
        paragraph(stage.branch.outcome),
      ),
    );
  }
  return section;
}

// ── evidence ─────────────────────────────────────────────────────────────
function evidenceSection(ctx: InvestigationContext): HTMLElement {
  const { generated, progress, view, handlers } = ctx;
  const solved = solvedCount(generated, progress);
  const clues = generated.clues.filter((clue) => progress.unlockedClues.includes(clue.id));
  const timeline = generated.timeline.filter((event) => event.revealedByStage <= Math.max(1, solved));

  const tabs: { id: EvidenceTab; label: string; count: number }[] = [
    { id: 'clues', label: 'Clues', count: clues.length },
    { id: 'suspects', label: 'Suspects', count: generated.suspects.length },
    { id: 'timeline', label: 'Timeline', count: timeline.length },
  ];

  const body = h('div', { class: 'tab-body', id: 'evidence-panel', role: 'tabpanel' });
  if (view.tab === 'clues') body.append(...cluesView(ctx, clues));
  else if (view.tab === 'suspects') body.append(...suspectsView(ctx));
  else body.append(timelineView(ctx, timeline));

  return h(
    'section',
    { class: 'panel', 'aria-label': 'Evidence' },
    h(
      'div',
      { class: 'tabs', role: 'tablist', 'aria-label': 'Evidence views' },
      ...tabs.map((tab) =>
        h(
          'button',
          {
            class: 'tab',
            type: 'button',
            role: 'tab',
            'aria-selected': String(view.tab === tab.id),
            'aria-controls': 'evidence-panel',
            onclick: () => handlers.onTab(tab.id),
          },
          tab.label,
          h('span', { class: 'count', text: String(tab.count) }),
        ),
      ),
    ),
    body,
  );
}

function cluesView(ctx: InvestigationContext, clues: Clue[]): HTMLElement[] {
  const { generated, progress } = ctx;
  const solved = solvedCount(generated, progress);
  const defused = new Set(
    generated.clues.filter((clue) => progress.unlockedClues.includes(clue.id)).map((clue) => clue.id),
  );

  if (clues.length === 0) {
    return [h('div', { class: 'locked-note', text: 'No evidence yet. Solve the first stage to open the file.' })];
  }

  const cards = clues.map((clue) => {
    const isDefused = clue.isRedHerring && clue.defusedBy !== undefined && defused.has(clue.defusedBy);
    return h(
      'article',
      { class: `card ${isDefused ? 'card--cleared' : clue.isRedHerring ? 'card--herring' : 'card--evidence'}` },
      h(
        'div',
        { class: 'card__head' },
        h('h3', { class: 'card__title', text: clue.title }),
        h('span', { class: 'chip', text: clue.kind }),
      ),
      paragraph(clue.body, 'card__body'),
      isDefused ? h('p', { class: 'card__body', text: 'Later evidence took the weight out of this one.' }) : null,
    );
  });

  if (solved < generated.stages.length) {
    cards.push(
      h('div', {
        class: 'locked-note',
        text: `${generated.clues.length - clues.length} more piece(s) of evidence are still sealed. Solve the current stage to open the next.`,
      }),
    );
  }
  return cards;
}

function suspectsView(ctx: InvestigationContext): HTMLElement[] {
  const { generated, progress } = ctx;
  const solved = solvedCount(generated, progress);
  const inFrame = new Set(narrowingAfterStage(generated, solved));
  const window = generated.setting.incidentWindow;

  const exonerated = new Set(
    generated.stages
      .filter((stage) => isStageSolved(generated, progress, stage.index))
      .flatMap((stage) => stage.branch.exonerates),
  );

  return generated.suspects.map((suspect: Suspect) => {
    const cleared = !inFrame.has(suspect.id);
    const relations = generated.relationships.filter((r) => r.from === suspect.id || r.to === suspect.id);

    return h(
      'article',
      { class: `card ${cleared ? 'card--cleared' : 'card--evidence'}` },
      h(
        'div',
        { class: 'suspect' },
        h(
          'div',
          { class: 'suspect__top' },
          h(
            'div',
            {},
            h('div', { class: 'suspect__name', text: suspect.name }),
            h('div', { class: 'suspect__role', text: suspect.role }),
          ),
          h('span', {
            class: cleared ? 'chip chip--teal' : 'chip chip--amber',
            text: cleared ? 'Cleared' : 'In frame',
          }),
        ),
        h('p', { class: 'suspect__line', text: `Motive — ${suspect.motive}.` }),
        h(
          'p',
          { class: 'suspect__line' },
          `Says they were in ${suspect.claimedLocation}, ` +
            `${secondsToClock(suspect.alibiWindow.start)}–${secondsToClock(suspect.alibiWindow.end)}. `,
          h('b', {
            text: suspect.alibiCorroborated
              ? 'Corroborated by someone else.'
              : 'Nobody else can confirm it.',
          }),
        ),
        exonerated.has(suspect.id)
          ? h('p', { class: 'suspect__line' }, h('b', { text: 'Cleared by evidence that arrived later — see the clue file.' }))
          : null,
        h('p', { class: 'suspect__line', text: `Badge access — ${suspect.accessAreas.join(', ') || 'nothing unusual'}.` }),
        solved >= 4
          ? h(
              'div',
              { class: 'suspect__grid' },
              statTile('Opportunity', suspect.stats.opportunity),
              statTile('Motive', suspect.stats.motive),
              statTile('Access', suspect.stats.access),
            )
          : null,
        ...relations.map((relation) => h('p', { class: 'suspect__line', text: relation.note })),
      ),
    );
  }).concat(
    h('div', {
      class: 'locked-note',
      text: `Incident window: ${secondsToClock(window.start)}–${secondsToClock(window.end)}. Anyone corroborated across all of it is out.`,
    }),
  );
}

function statTile(label: string, value: number): HTMLElement {
  return h('div', { class: 'stat' }, h('b', { text: String(value) }), h('span', { text: label }));
}

function timelineView(ctx: InvestigationContext, events: Case['timeline']): HTMLElement {
  const { generated } = ctx;
  const window = generated.setting.incidentWindow;
  if (events.length === 0) {
    return h('div', { class: 'locked-note', text: 'The timeline fills in as you work.' });
  }
  return h(
    'ol',
    { class: 'timeline' },
    ...events.map((event) =>
      h(
        'li',
        { 'data-key': String(event.at >= window.start && event.at <= window.end) },
        h('div', { class: 'timeline__time', text: secondsToClock(event.at) }),
        h('div', { class: 'timeline__label', text: event.label }),
        h('div', { class: 'timeline__where', text: event.location }),
      ),
    ),
  );
}

// ── challenge panel ──────────────────────────────────────────────────────
function challengePanel(ctx: InvestigationContext, stage: Stage): HTMLElement {
  const { generated, progress, view, editor, handlers } = ctx;
  const state = stageState(generated, progress, stage.index);
  const solvedHere = state === 'solved';
  const totalHints = stage.challenge.hints.length;
  const allowed = availableHints(progress, stage.index, totalHints);

  const panel = h(
    'section',
    { class: 'panel editor-panel', 'aria-label': `Stage ${stage.index} challenge` },
    h(
      'div',
      { class: 'section', style: 'padding-bottom:0' },
      h('span', { class: 'eyebrow', text: stage.conceptLabel }),
      h('div', { class: 'lesson' }, ...stage.challenge.lesson.map((line) => paragraph(line))),
      richText(h('div', { class: 'prompt', style: 'margin-top:14px' }), stage.challenge.prompt),
      ...stage.challenge.givens.map((given) => h('pre', { class: 'givens', style: 'margin-top:12px', text: given })),
    ),
    h(
      'div',
      { class: 'editor-head', style: 'margin-top:16px' },
      h('span', { class: 'eyebrow', text: 'Python' }),
      h('span', { class: 'eyebrow', text: 'Ctrl/⌘ + Enter to run' }),
    ),
    editor,
  );

  if (view.hintsShown > 0) {
    const shown = Math.min(view.hintsShown, allowed);
    for (let index = 0; index < shown; index++) {
      const hint = stage.challenge.hints[index];
      if (!hint) continue;
      const box = h('div', { class: 'hint-box' }, h('div', { class: 'eyebrow', text: `Hint ${index + 1}` }));
      // Multi-line hints are worked examples and keep their formatting.
      box.append(hint.includes('\n') ? h('pre', { text: hint }) : richText(h('div', {}), hint));
      panel.append(box);
    }
  }

  panel.append(
    h(
      'div',
      { class: 'editor-actions' },
      h(
        'button',
        { class: solvedHere ? 'btn' : 'btn btn--primary', type: 'button', onclick: () => handlers.onRun() },
        solvedHere ? 'Run again' : 'Run code',
      ),
      h('button', { class: 'btn btn--ghost btn--small editor-actions__hint', type: 'button', onclick: () => handlers.onReset() }, 'Reset'),
      h(
        'button',
        {
          class: 'btn btn--ghost btn--small editor-actions__hint',
          type: 'button',
          disabled: view.hintsShown >= allowed,
          onclick: () => handlers.onHint(),
          title: view.hintsShown >= allowed ? 'Another hint unlocks after a wrong answer' : 'Show a hint',
        },
        `Hint ${Math.min(view.hintsShown, allowed)}/${totalHints}`,
      ),
    ),
  );

  panel.append(consoleView(view.lastResult));

  if (view.lastResult) panel.append(feedbackView(view.lastResult));

  if (solvedHere) {
    panel.append(
      h(
        'div',
        { class: 'editor-actions' },
        stage.index < generated.stages.length
          ? h('button', { class: 'btn btn--solved', type: 'button', onclick: () => handlers.onNext() }, 'Next stage →')
          : h('button', { class: 'btn btn--solved', type: 'button', onclick: () => handlers.onPane('code') }, 'Make the accusation ↑'),
      ),
    );
  }

  return panel;
}

function consoleView(result: GradeResult | null): HTMLElement {
  const box = h('div', { class: 'console', role: 'log', 'aria-label': 'Program output' });
  if (!result) {
    box.append(h('div', { class: 'console__line console__line--muted', text: '# output appears here when you run your code' }));
    return box;
  }
  if (result.stdout.length === 0) {
    box.append(h('div', { class: 'console__line console__line--muted', text: '# nothing was printed' }));
  }
  for (const line of result.stdout) {
    box.append(h('div', { class: 'console__line', text: line }));
  }
  if (result.status === 'syntax-error' || result.status === 'runtime-error') {
    box.append(
      h('div', {
        class: 'console__line console__line--error',
        text: `${result.line ? `line ${result.line}: ` : ''}${result.message}`,
      }),
    );
  }
  return box;
}

function feedbackView(result: GradeResult): HTMLElement {
  const tone =
    result.status === 'correct' ? 'correct'
    : result.status === 'incorrect' || result.status === 'empty' ? 'incorrect'
    : 'error';

  const heading =
    result.status === 'correct' ? 'Correct'
    : result.status === 'syntax-error' ? 'Python could not read that'
    : result.status === 'runtime-error' ? 'It broke while running'
    : result.status === 'empty' ? 'Nothing to run'
    : 'Not it';

  return h(
    'div',
    { class: 'feedback', 'data-tone': tone, role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'feedback__title', text: heading }),
    paragraph(result.message, 'feedback__detail'),
    result.detail ? paragraph(result.detail, 'feedback__detail') : null,
  );
}

// ── accusation ───────────────────────────────────────────────────────────
function accusationPanel(ctx: InvestigationContext): HTMLElement {
  const { generated, view, handlers } = ctx;
  return h(
    'section',
    { class: 'panel section', 'aria-label': 'Final accusation' },
    h('span', { class: 'eyebrow', text: 'All five stages cleared' }),
    h('h2', { class: 'section__title', text: 'Name the person who did it' }),
    paragraph(
      'Everything you needed is in the evidence panel. Two lines of reasoning point the same way: ' +
        'who cannot be placed elsewhere for the whole window, and who could get through the door the message named.',
    ),
    h(
      'div',
      { class: 'accuse-grid', role: 'group', 'aria-label': 'Suspects' },
      ...generated.suspects.map((suspect) =>
        h(
          'button',
          {
            class: 'accuse-option',
            type: 'button',
            'aria-pressed': String(view.accused === suspect.id),
            onclick: () => handlers.onAccuse(suspect.id),
          },
          h(
            'span',
            {},
            h('span', { class: 'accuse-option__name', text: suspect.name }),
            h('span', { class: 'accuse-option__role', text: ` — ${suspect.role}` }),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'editor-actions', style: 'padding-left:0;padding-right:0;border:0' },
      h(
        'button',
        {
          class: 'btn btn--primary',
          type: 'button',
          disabled: view.accused === null,
          onclick: () => handlers.onConfirmAccusation(),
        },
        'Close the case',
      ),
    ),
  );
}

// ── mobile pane switcher ─────────────────────────────────────────────────
function mobileTabs(ctx: InvestigationContext): HTMLElement {
  const { view, handlers } = ctx;
  const panes: { id: EvidencePane; label: string }[] = [
    { id: 'evidence', label: 'Case & evidence' },
    { id: 'code', label: 'Python' },
  ];
  return h(
    'nav',
    { class: 'mobile-tabs', 'aria-label': 'Switch panel' },
    ...panes.map((pane) =>
      h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(view.pane === pane.id),
        text: pane.label,
        onclick: () => handlers.onPane(pane.id),
      }),
    ),
  );
}
