// Chain Reaction — rotation dial. A draggable carmine pin orbiting the ghost.
// Snaps to spec.rotationSnapDeg or, when cardinalOnly, to {0, 90, 180, 270}.

import Phaser from 'phaser';
import { COLOR, FONT } from '../design/tokens';

export class RotationDial {
  private scene: Phaser.Scene;
  private container!: Phaser.GameObjects.Container;
  private g!: Phaser.GameObjects.Graphics;
  private handle!: Phaser.GameObjects.Arc;
  private label!: Phaser.GameObjects.Text;

  private snapRad = 0; // 0 means free
  private cardinal = false;
  private radius = 70;
  private cx = 0;
  private cy = 0;
  private locked = false;
  /** Pointer-down position on the handle, used to distinguish tap from drag. */
  private downX = 0;
  private downY = 0;
  /** True while a pointer is pressed on the handle (down → up). The scene
   *  uses this to suppress its own pointermove/down-driven ghost movement. */
  private pressing = false;

  /** current rotation in radians, normalized to [0, 2π). */
  rotation = 0;
  onChange: (r: number) => void = () => {};
  /** Fired on a clean tap of the handle (no drag). Used to toggle position lock. */
  onTap: () => void = () => {};

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  build() {
    this.container = this.scene.add.container(0, 0).setVisible(false).setDepth(60);

    this.g = this.scene.add.graphics();
    this.container.add(this.g);

    this.handle = this.scene.add.circle(0, 0, 9, COLOR.carmine, 1)
      .setStrokeStyle(1.5, COLOR.graphite, 0.9)
      .setInteractive({ draggable: true, useHandCursor: true });
    this.container.add(this.handle);

    this.label = this.scene.add.text(0, 0, '0°', {
      fontFamily: FONT.mono,
      fontSize: '11px',
      color: '#C8312B',
    }).setOrigin(0.5, 0.5);
    this.container.add(this.label);

    this.scene.input.setDraggable(this.handle, true);
    // Distinguish tap from drag by actual pointer travel, NOT by Phaser's
    // dragstart event — that fires immediately on pointerdown with the
    // default zero drag-distance threshold and would mask every tap.
    this.handle.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.downX = p.x;
      this.downY = p.y;
      this.pressing = true;
    });
    this.handle.on('pointerup', (p: Phaser.Input.Pointer) => {
      const dx = p.x - this.downX;
      const dy = p.y - this.downY;
      const wasTap = Math.hypot(dx, dy) < 6;
      this.pressing = false;
      if (wasTap) this.onTap();
    });
    // upoutside fires when the pointer is released off the handle (drag ended).
    this.handle.on('pointerupoutside', () => { this.pressing = false; });
    this.scene.input.on('drag', (_: unknown, target: Phaser.GameObjects.GameObject, x: number, y: number) => {
      if (target !== this.handle) return;
      // Drag only rotates when locked. Without lock, position-drag wins and
      // the handle is a tap target only.
      if (!this.locked) return;
      let theta = Math.atan2(y - this.cy, x - this.cx);
      theta = this.applySnap(theta);
      this.rotation = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      this.refresh();
      this.onChange(this.rotation);
    });
  }

  setLocked(b: boolean) {
    this.locked = b;
    this.refresh();
  }

  isLocked() {
    return this.locked;
  }

  /** True while a finger/mouse is pressed on the handle. */
  isPressing() {
    return this.pressing;
  }

  show(cx: number, cy: number, snapDeg: number, cardinalOnly: boolean, initial: number) {
    this.cx = cx;
    this.cy = cy;
    this.cardinal = cardinalOnly;
    this.snapRad = (snapDeg * Math.PI) / 180;
    this.rotation = ((initial % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    this.locked = false;
    this.pressing = false;
    this.container.setVisible(true);
    this.refresh();
  }

  hide() {
    this.container.setVisible(false);
    this.pressing = false;
  }

  move(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
    this.refresh();
  }

  destroy() {
    this.container.destroy();
  }

  private applySnap(theta: number): number {
    if (this.cardinal) {
      const cards = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      let best = cards[0]!;
      let bestD = Infinity;
      for (const c of cards) {
        const d = Math.abs(angleDelta(theta, c));
        if (d < bestD) { bestD = d; best = c; }
      }
      return best;
    }
    if (this.snapRad === 0) return theta;
    return Math.round(theta / this.snapRad) * this.snapRad;
  }

  private refresh() {
    if (!this.container.visible) return;
    this.g.clear();

    // Dashed lead-line from center to handle
    const hx = this.cx + Math.cos(this.rotation) * this.radius;
    const hy = this.cy + Math.sin(this.rotation) * this.radius;

    this.g.lineStyle(1, COLOR.carmine, 0.7);
    drawDashedLine(this.g, this.cx, this.cy, hx, hy, 4, 3);

    // Tick ring at radius. Darker + thicker when locked so the lock state
    // reads at a glance.
    this.g.lineStyle(this.locked ? 1.5 : 1, COLOR.graphite, this.locked ? 0.55 : 0.25);
    this.g.strokeCircle(this.cx, this.cy, this.radius);

    // When locked, draw a small filled square at the body center as a
    // "position pinned" marker.
    if (this.locked) {
      this.g.fillStyle(COLOR.carmine, 1);
      this.g.fillRect(this.cx - 3, this.cy - 3, 6, 6);
      // And a ring around the handle to show it's the active grab.
      this.g.lineStyle(1.5, COLOR.carmine, 0.9);
      this.g.strokeCircle(hx, hy, 13);
    }

    this.handle.setPosition(hx, hy);

    const deg = Math.round((this.rotation * 180) / Math.PI) % 360;
    this.label.setText(`${pad(deg, 3)}°`);
    this.label.setPosition(hx, hy - 18);
  }
}

function pad(n: number, w: number) {
  return n.toString().padStart(w, '0');
}

function angleDelta(a: number, b: number) {
  return ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI;
}

function drawDashedLine(
  g: Phaser.GameObjects.Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dash: number,
  gap: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const nx = dx / len;
  const ny = dy / len;
  let drawn = 0;
  while (drawn < len) {
    const start = drawn;
    const end = Math.min(drawn + dash, len);
    g.lineBetween(x1 + nx * start, y1 + ny * start, x1 + nx * end, y1 + ny * end);
    drawn = end + gap;
  }
}
