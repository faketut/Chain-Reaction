// Chain Reaction — palette strip. The bottom-of-canvas "tear-off" with the
// 8 object silhouettes drawn by the same hand that drew the playfield.

import Phaser from 'phaser';
import { WORLD_W, WORLD_H } from '../../shared/constants';
import { COLOR, FONT } from '../design/tokens';
import { sketchRect, sketchCircle, sketchTriangle } from '../design/sketch';
import type { ObjectType } from '../../shared/types';

// Object types players can place on the daily puzzle. `ball` is intentionally
// NOT in this list: each daily template already includes whatever ball(s) the
// goal needs, and letting users drop new balls would trivialize most templates
// (just place a ball directly above the goal → instant solve). `ball` stays
// in CATALOG because the sim and start placements still need it, and the
// PracticeScene re-includes it via `build(..., PRACTICE_PALETTE)` so players
// can experiment safely there.
export const DAILY_PALETTE: ObjectType[] = [
  'block',
  'domino',
  'ramp_l',
  'ramp_r',
  'balloon',
  'fan',
  'magnet',
  'bumper',
];

/** Practice sandbox: everything goes, including ball. */
export const PRACTICE_PALETTE: ObjectType[] = [
  'block',
  'domino',
  'ball',
  'ramp_l',
  'ramp_r',
  'balloon',
  'fan',
  'magnet',
  'bumper',
];

export class PaletteStrip {
  private container!: Phaser.GameObjects.Container;
  private slots: { type: ObjectType; bg: Phaser.GameObjects.Graphics; hit: Phaser.GameObjects.Zone; label: Phaser.GameObjects.Text }[] = [];
  private onPick: (type: ObjectType) => void = () => {};

  readonly height = 132;

  constructor(private scene: Phaser.Scene) {}

  build(onPick: (type: ObjectType) => void, palette: ObjectType[] = DAILY_PALETTE) {
    this.onPick = onPick;
    const top = WORLD_H - this.height;
    this.container = this.scene.add.container(0, 0).setDepth(40);

    // Tear-off strip background — paper-2, with a dashed perforation rule
    // along its top edge.
    const bg = this.scene.add.graphics();
    bg.fillStyle(COLOR.paper2, 1);
    bg.fillRect(0, top, WORLD_W, this.height);

    // Perforation: short dashes
    bg.lineStyle(1.5, COLOR.graphite, 0.55);
    const dash = 8;
    const gap = 6;
    let x = 12;
    while (x < WORLD_W - 12) {
      bg.lineBetween(x, top, Math.min(x + dash, WORLD_W - 12), top);
      x += dash + gap;
    }
    this.container.add(bg);

    // Slots. Each is a hand-drawn silhouette with a mono label below.
    const slotW = (WORLD_W - 24) / palette.length;
    palette.forEach((type, i) => {
      const cx = 12 + slotW * (i + 0.5);
      const cy = top + 56;

      const slotBg = this.scene.add.graphics();
      this.container.add(slotBg);
      drawPaletteIcon(slotBg, type, cx, cy);

      const label = this.scene.add.text(cx, top + 110, type.replace('_', ' '), {
        fontFamily: FONT.mono,
        fontSize: '12px',
        color: '#1F2024',
      }).setOrigin(0.5);
      this.container.add(label);

      const hit = this.scene.add.zone(cx, cy + 10, slotW - 6, this.height - 16)
        .setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.onPick(type));
      hit.on('pointerover', () => {
        slotBg.clear();
        drawPaletteIcon(slotBg, type, cx, cy, /* hover */ true);
      });
      hit.on('pointerout', () => {
        slotBg.clear();
        drawPaletteIcon(slotBg, type, cx, cy, false);
      });
      this.container.add(hit);

      this.slots.push({ type, bg: slotBg, hit, label });
    });
  }

  hide() {
    if (this.container) this.container.setVisible(false);
  }
  show() {
    if (this.container) this.container.setVisible(true);
  }
  destroy() {
    if (this.container) this.container.destroy();
  }
}

function drawPaletteIcon(
  g: Phaser.GameObjects.Graphics,
  type: ObjectType,
  cx: number,
  cy: number,
  hover = false,
) {
  const stroke = hover ? COLOR.carmine : COLOR.graphite;
  const id = `palette::${type}`;
  switch (type) {
    case 'block':
      sketchRect(g, cx, cy, 36, 18, 0, id, { stroke, lineWidth: 2, crisp: true });
      // Diagonal hatch lines to read as "solid/structural", differentiating
      // from the empty silhouette of domino.
      g.lineStyle(1, stroke, 0.55);
      g.lineBetween(cx - 14, cy - 6, cx - 6, cy + 6);
      g.lineBetween(cx -  4, cy - 6, cx + 4, cy + 6);
      g.lineBetween(cx +  6, cy - 6, cx + 14, cy + 6);
      break;
    case 'domino':
      sketchRect(g, cx, cy, 10, 38, 0, id, { stroke, lineWidth: 2, crisp: true });
      break;
    case 'ball':
      sketchCircle(g, cx, cy, 14, id, { stroke, lineWidth: 2 });
      break;
    case 'ramp_l':
      sketchTriangle(g, cx, cy, 40, 22, true, 0, id, { stroke, lineWidth: 2 });
      break;
    case 'ramp_r':
      sketchTriangle(g, cx, cy, 40, 22, false, 0, id, { stroke, lineWidth: 2 });
      break;
    case 'balloon':
      sketchCircle(g, cx, cy, 14, id, { stroke, lineWidth: 2 });
      // Knot triangle + tether so the silhouette reads as "balloon", not "ball".
      g.lineStyle(1.5, stroke, 0.9);
      g.beginPath();
      g.moveTo(cx - 3, cy + 14);
      g.lineTo(cx + 3, cy + 14);
      g.lineTo(cx,     cy + 19);
      g.closePath();
      g.strokePath();
      g.lineStyle(1, stroke, 0.7);
      g.lineBetween(cx, cy + 19, cx + 2, cy + 26);
      // Tiny upward chevron above to hint at buoyancy.
      g.lineStyle(1.2, COLOR.carmine, 0.7);
      g.lineBetween(cx - 4, cy - 18, cx, cy - 22);
      g.lineBetween(cx + 4, cy - 18, cx, cy - 22);
      break;
    case 'fan':
      sketchRect(g, cx, cy, 32, 16, 0, id, { stroke, lineWidth: 2 });
      // arrows hinting direction
      g.lineStyle(1.5, stroke, 0.8);
      g.lineBetween(cx + 18, cy - 4, cx + 26, cy);
      g.lineBetween(cx + 26, cy, cx + 18, cy + 4);
      break;
    case 'magnet':
      sketchCircle(g, cx, cy, 16, id, { stroke, lineWidth: 2 });
      g.lineStyle(1, stroke, 0.8);
      g.lineBetween(cx - 8, cy, cx + 8, cy);
      break;
    case 'bumper':
      sketchCircle(g, cx, cy, 16, id, { stroke, lineWidth: 2 });
      // tiny inner ring
      g.lineStyle(1, stroke, 0.6);
      g.strokeCircle(cx, cy, 9);
      break;
  }
}
