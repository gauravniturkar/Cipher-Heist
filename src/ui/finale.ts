/** The closing screen: verdict, the truth, what was practised, and a replay. */

import type { Case, CaseResult } from '../types.js';
import { h, paragraph } from './dom.js';
import { themeToggle } from './theme.js';

export interface FinaleHandlers {
  onReplaySameSeed(): void;
  onNewCase(): void;
  onCopySeed(): void;
  onReview(): void;
  onHome(): void;
  onThemeChange(): void;
}

export function renderFinale(generated: Case, result: CaseResult, handlers: FinaleHandlers): HTMLElement {
  const culprit = generated.suspects.find((s) => s.id === result.culpritId);
  const accused = generated.suspects.find((s) => s.id === result.accusedId);
  const minutes = Math.max(1, Math.round(result.elapsedMs / 60000));

  return h(
    'main',
    { class: 'finale' },
    h(
      'div',
      { class: 'finale__inner' },
      h(
        'div',
        { class: 'verdict', 'data-correct': String(result.correct) },
        h(
          'div',
          { class: 'verdict__band' },
          h('div', { class: 'eyebrow', text: `Case ${generated.seed} · ${generated.difficulty}` }),
          themeToggle(() => handlers.onThemeChange(), true),
        ),
        h('h1', { class: 'verdict__stamp', text: result.correct ? 'Case closed' : 'Wrong call' }),
        paragraph(
          result.correct
            ? `You named ${accused?.name ?? 'them'}, and you were right.`
            : `You named ${accused?.name ?? 'them'}. It was ${culprit?.name ?? 'someone else'}.`,
        ),
      ),
      h(
        'section',
        { class: 'panel section' },
        h('span', { class: 'eyebrow', text: 'What actually happened' }),
        h('h2', { class: 'section__title', text: culprit?.name ?? 'The culprit' }),
        paragraph(`${capitalise(culprit?.role ?? 'They')} — ${result.motive}.`),
        paragraph(`They ${result.method}.`),
        paragraph(
          `The two threads that gave them away: nobody could place them elsewhere for the whole ` +
            `window, and they held a credential for the room the decoded message named.`,
        ),
      ),
      h(
        'section',
        { class: 'panel section' },
        h('span', { class: 'eyebrow', text: 'Your investigation' }),
        h(
          'div',
          { class: 'summary-grid', style: 'margin-top:12px' },
          tile(`${result.stagesSolved}/${result.totalStages}`, 'Stages solved'),
          tile(String(result.wrongAttempts), 'Wrong answers'),
          tile(String(result.hintsUsed), 'Hints used'),
          tile(`${minutes}m`, 'Time on case'),
        ),
      ),
      h(
        'section',
        { class: 'panel section' },
        h('span', { class: 'eyebrow', text: 'Python you used to get here' }),
        h(
          'ul',
          { class: 'concept-list', style: 'margin-top:12px' },
          ...result.conceptsPractised.map((concept) =>
            h(
              'li',
              { 'data-solved': String(concept.solved) },
              h('span', { class: 'mark', 'aria-hidden': 'true', text: concept.solved ? '✓' : '·' }),
              h('span', { text: concept.label }),
            ),
          ),
        ),
      ),
      h(
        'div',
        { class: 'editor-actions panel' },
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => handlers.onNewCase() }, 'New case, new seed'),
        h('button', { class: 'btn', type: 'button', onclick: () => handlers.onReplaySameSeed() }, 'Replay this case'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => handlers.onCopySeed() }, `Copy ${generated.seed}`),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => handlers.onReview() }, 'Back to the case'),
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => handlers.onHome() }, 'Home'),
      ),
    ),
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function tile(value: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, h('b', { text: value }), h('span', { text: label }));
}
