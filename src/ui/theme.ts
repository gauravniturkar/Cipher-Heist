/**
 * Theme selection.
 *
 * The game is designed dark - an archival reading room at night - but that is a
 * look, not a rule, so a light archival palette is available and the choice is
 * remembered. With nothing stored the system preference decides, falling back
 * to dark.
 */

import { readSetting, writeSetting } from '../engine/storage.js';
import { h } from './dom.js';

export type Theme = 'dark' | 'light';

const SETTING = 'theme/v1';

export function storedTheme(): Theme | null {
  const value = readSetting(SETTING);
  return value === 'dark' || value === 'light' ? value : null;
}

/** jsdom and older browsers have no matchMedia, so this must stay optional. */
export function systemTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function currentTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  // Tells the browser which scrollbars and form controls to draw.
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
}

export function setTheme(theme: Theme): Theme {
  writeSetting(SETTING, theme);
  applyTheme(theme);
  return theme;
}

export function toggleTheme(): Theme {
  return setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** Applies the stored or system theme once, at startup. */
export function initTheme(): Theme {
  const theme = currentTheme();
  applyTheme(theme);
  return theme;
}

/**
 * The control. It names the theme it will switch *to*, which is what the
 * player is choosing; `compact` drops the label where space is tight.
 */
export function themeToggle(onChange: () => void, compact = false): HTMLButtonElement {
  const theme = currentTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Switch to light' : 'Switch to dark';

  return h(
    'button',
    {
      class: compact ? 'chip theme-toggle' : 'btn btn--ghost btn--small theme-toggle',
      type: 'button',
      title: label,
      'aria-label': label,
      onclick: () => {
        toggleTheme();
        onChange();
      },
    },
    h('span', { 'aria-hidden': 'true', text: next === 'light' ? '☀' : '☾' }),
    compact ? null : h('span', { text: next === 'light' ? 'Light' : 'Dark' }),
  );
}
