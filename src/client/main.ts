// Chain Reaction — Phaser bootstrap. Loads fonts before starting the scene
// so the title block and prompt render in the correct typefaces on first paint.

import Phaser from 'phaser';
import { PlayScene } from './scenes/PlayScene';
import { ReplayScene } from './scenes/ReplayScene';
import { PracticeScene } from './scenes/PracticeScene';
import { WORLD_W, WORLD_H } from '../shared/constants';
import { COLOR_CSS } from './design/tokens';

const config: Phaser.Types.Core.GameConfig = {
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
  // Pixel-art is OFF — we want crisp anti-aliased strokes for the hand-drawn look.
  roundPixels: false,
};

async function start() {
  // Wait for the three webfonts before booting Phaser. Otherwise the first
  // text render is in the system fallback and the design reads as generic.
  if ('fonts' in document) {
    try {
      await Promise.all([
        (document as Document & { fonts: FontFaceSet }).fonts.load('1em "DM Serif Display"'),
        (document as Document & { fonts: FontFaceSet }).fonts.load('1em "Inter"'),
        (document as Document & { fonts: FontFaceSet }).fonts.load('1em "JetBrains Mono"'),
      ]);
    } catch {
      // Font load is best-effort; fall back to system if it fails.
    }
  }

  const game = new Phaser.Game(config);
  const url = new URL(window.location.href);
  const postId =
    url.searchParams.get('postId') ??
    (window as unknown as { __DEVVIT_POST_ID__?: string }).__DEVVIT_POST_ID__ ??
    'dev_local_post';
  // URL/hash routing: ?practice=1 or #practice → land directly in the sandbox.
  const wantPractice =
    url.searchParams.get('practice') === '1' || window.location.hash === '#practice';
  game.scene.start(wantPractice ? 'Practice' : 'Play', { postId });
}

start();
