/** The case-file cover: pick a seed and a difficulty, or resume. */

import { DIFFICULTIES, type Difficulty } from '../types.js';
import { isValidSeed, normaliseSeed, randomSeed } from '../engine/seed.js';
import { h, paragraph, toast } from './dom.js';
import { themeToggle } from './theme.js';

export interface OpeningHandlers {
  onOpen(seed: string, difficulty: Difficulty): void;
  onResume(): void;
  onThemeChange(): void;
}

export interface ResumeInfo {
  seed: string;
  difficulty: Difficulty;
  solved: number;
  total: number;
}

const DIFFICULTY_COPY: Record<Difficulty, { label: string; note: string }> = {
  rookie: { label: 'Rookie', note: '3 suspects · gentler ciphers' },
  detective: { label: 'Detective', note: '4 suspects · standard' },
  inspector: { label: 'Inspector', note: '5 suspects · nothing spelled out' },
};

const CONCEPTS = ['Variables & strings', 'Lists & indexing', 'Loops & ASCII', 'Functions', 'Conditionals'];

export function renderOpening(handlers: OpeningHandlers, resume: ResumeInfo | null): HTMLElement {
  let difficulty: Difficulty = resume?.difficulty ?? 'detective';

  const seedInput = h('input', {
    class: 'input',
    id: 'seed-input',
    type: 'text',
    value: randomSeed(),
    spellcheck: false,
    autocomplete: 'off',
    autocapitalize: 'characters',
    'aria-describedby': 'seed-help',
  });

  const shuffleButton = h(
    'button',
    { class: 'btn btn--ghost', type: 'button', onclick: () => { seedInput.value = randomSeed(); } },
    'Shuffle',
  );

  const choices = DIFFICULTIES.map((level) =>
    h(
      'button',
      {
        class: 'choice',
        type: 'button',
        'aria-pressed': String(level === difficulty),
        onclick: () => {
          difficulty = level;
          for (const button of choices) {
            button.setAttribute('aria-pressed', String(button.dataset.level === level));
          }
        },
        'data-level': level,
      },
      DIFFICULTY_COPY[level].label,
      h('small', { text: DIFFICULTY_COPY[level].note }),
    ),
  );

  const open = (): void => {
    const seed = normaliseSeed(seedInput.value);
    if (!seed || !isValidSeed(seed)) {
      toast('That seed cannot be read. Try Shuffle for a fresh one.');
      seedInput.focus();
      return;
    }
    seedInput.value = seed;
    handlers.onOpen(seed, difficulty);
  };

  const form = h(
    'form',
    {
      class: 'case-file__body',
      onsubmit: (event: SubmitEvent) => { event.preventDefault(); open(); },
    },
    h('h1', { class: 'case-file__title' }, 'THE', h('span', { text: 'CIPHER' }), 'HEIST'),
    paragraph(
      'A new investigation every time. The case, the suspects, the ciphers and the ' +
        'culprit are generated from the seed below — and the only way through is to write Python.',
      'case-file__lede',
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field__label', for: 'seed-input', text: 'Case seed' }),
      h('div', { class: 'seed-row' }, seedInput, shuffleButton),
      h('p', {
        class: 'case-file__note',
        id: 'seed-help',
        text: 'Same seed and difficulty always produce the same case. Share it to hand someone the exact case you played.',
      }),
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field__label', id: 'difficulty-label', text: 'Difficulty' }),
      h('div', { class: 'choice-row', role: 'group', 'aria-labelledby': 'difficulty-label' }, ...choices),
    ),
    h(
      'div',
      { class: 'case-file__actions' },
      h('button', { class: 'btn btn--primary', type: 'submit' }, 'Open the case file'),
      resume
        ? h(
            'button',
            { class: 'btn', type: 'button', onclick: () => handlers.onResume() },
            `Resume ${resume.seed} — ${resume.solved}/${resume.total} stages solved`,
          )
        : null,
    ),
    h('div', { class: 'concept-strip' }, ...CONCEPTS.map((concept) => h('span', { class: 'chip', text: concept }))),
  );

  return h(
    'main',
    { class: 'opening' },
    h(
      'div',
      { class: 'case-file' },
      h(
        'div',
        { class: 'case-file__band' },
        h('span', { class: 'eyebrow', text: 'Confidential · case generator v2' }),
        h(
          'div',
          { class: 'case-file__band-right' },
          h('span', { class: 'chip chip--amber', text: 'Python' }),
          themeToggle(() => handlers.onThemeChange(), true),
        ),
      ),
      form,
    ),
  );
}
