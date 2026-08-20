/** Entry point. */

import './ui/styles.css';
import { App } from './ui/app.js';

const root = document.getElementById('app');

if (root) {
  new App(root).start();
} else {
  document.body.textContent = 'Cipher Heist could not start: the app container is missing.';
}
