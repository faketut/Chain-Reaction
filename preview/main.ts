// Chain Reaction — preview entry. Installs mock fetch before importing the
// client so PlayScene/ReplayScene work with no server.

import '../src/client/styles.css';
import { installMockFetch, highlightActiveMode } from './mockApi';

installMockFetch();
highlightActiveMode();

// Set hash → mode default if absent so the modeswitch always reflects truth.
if (!location.hash) location.hash = 'empty';

// Dynamic import after fetch is patched.
const { default: Phaser } = await import('phaser');
const { PlayScene } = await import('../src/client/scenes/PlayScene');
const { ReplayScene } = await import('../src/client/scenes/ReplayScene');
const { PracticeScene } = await import('../src/client/scenes/PracticeScene');
const { WORLD_W, WORLD_H } = await import('../src/shared/constants');
const { COLOR_CSS } = await import('../src/client/design/tokens');

if ('fonts' in document) {
  try {
    await Promise.all([
      (document as Document & { fonts: FontFaceSet }).fonts.load('1em "DM Serif Display"'),
      (document as Document & { fonts: FontFaceSet }).fonts.load('1em "Inter"'),
      (document as Document & { fonts: FontFaceSet }).fonts.load('1em "JetBrains Mono"'),
    ]);
  } catch {
    /* best effort */
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: WORLD_W,
  height: WORLD_H,
  parent: 'game',
  backgroundColor: COLOR_CSS.paper,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [PlayScene, ReplayScene, PracticeScene],
  roundPixels: false,
});

// Expose for preview debugging.
(window as unknown as { __GAME__?: Phaser.Game }).__GAME__ = game;

const hash = location.hash.slice(1) || 'empty';
if (hash === 'practice') {
  game.scene.start('Practice');
} else {
  game.scene.start('Play', { postId: `preview_${hash}` });
}

// ---------- preview keyboard shortcuts ----------
// Save a few hundred clicks per dev session. Keys map straight to the
// modeswitch links above. Ignored when an input/textarea has focus.
const KEY_TO_HASH: Record<string, string> = {
  '1': '#g1',
  '2': '#g2',
  '3': '#g3',
  '4': '#g4',
  '5': '#g5',
  '6': '#g6',
  e: '#empty',
  m: '#midgame',
  p: '#practice',
  b: '#bridge',
  l: '#locked',
};

window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const target = ev.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
  // 'r' reloads the current mode (fresh sim state) without changing the hash.
  if (ev.key === 'r') {
    ev.preventDefault();
    location.reload();
    return;
  }
  const next = KEY_TO_HASH[ev.key.toLowerCase()];
  if (next && location.hash !== next) {
    ev.preventDefault();
    location.hash = next;
  }
});
