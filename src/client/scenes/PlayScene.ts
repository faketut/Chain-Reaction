// Chain Reaction — PlayScene.
//
// State machine:
//   loading → viewing (placed/locked)  ← terminal
//   loading → picking → placing → submitting → viewing (just-placed)
//
// Visual responsibilities:
//   - Chrome (graph paper, header, prompt, toast)
//   - All existing placements rendered in their post-sim resting positions
//   - The signature target reticle for the goal sensor(s)
//   - Palette tear-off when picking
//   - Ghost preview + drag + rotation dial when placing
//   - The drawing-reveal animation for a freshly accepted placement

import Phaser from 'phaser';
import { WORLD_W, WORLD_H, PLAYAREA_PAD } from '../../shared/constants';
import { CATALOG } from '../../shared/catalog';
import type { Placement, ObjectType } from '../../shared/types';
import { getPostState, placeObject, type PostStateResponse } from '../api';
import { COLOR, FONT, SNAP_PX } from '../design/tokens';
import { drawBody } from '../design/bodyRenderer';
import { SceneChrome } from './SceneChrome';
import { PaletteStrip } from './PaletteStrip';
import { RotationDial } from './RotationDial';

type Mode = 'loading' | 'viewing' | 'picking' | 'placing' | 'submitting';

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class PlayScene extends Phaser.Scene {
  private postId!: string;
  private state: PostStateResponse | null = null;
  private mode: Mode = 'loading';

  private chrome!: SceneChrome;
  private palette!: PaletteStrip;
  private dial!: RotationDial;

  // Layers (drawn back-to-front)
  private bodyLayer!: Phaser.GameObjects.Graphics;
  private highlightLayer!: Phaser.GameObjects.Graphics;
  private ghostLayer!: Phaser.GameObjects.Graphics;
  private uiLayer!: Phaser.GameObjects.Container;

  // Placement state
  private picked: ObjectType | null = null;
  private ghostX = WORLD_W / 2;
  private ghostY = WORLD_H / 2;
  private ghostRotation = 0;
  private ghostValid = true;

  // Reveal animation
  private revealId: string | null = null;
  private revealStart = 0;
  private revealDurationMs = 900;
  private revealClickX = 0;
  private revealClickY = 0;

  // Place / cancel buttons
  private placeBtn!: Phaser.GameObjects.Container;
  private cancelBtn!: Phaser.GameObjects.Container;

  constructor() {
    super('Play');
  }

  init(data: { postId: string }) {
    this.postId = data.postId;
  }

  create() {
    this.chrome = new SceneChrome(this);
    this.palette = new PaletteStrip(this);
    this.dial = new RotationDial(this);

    this.bodyLayer = this.add.graphics().setDepth(10);
    this.highlightLayer = this.add.graphics().setDepth(11);
    this.ghostLayer = this.add.graphics().setDepth(20);
    this.uiLayer = this.add.container(0, 0).setDepth(50);

    this.dial.build();
    this.dial.onChange = (r) => {
      this.ghostRotation = r;
      this.redrawGhost();
    };
    this.dial.onTap = () => {
      // Toggle: tapping the pin locks the body's coordinates so subsequent
      // drags don't move the piece. Tapping again unlocks.
      const next = !this.dial.isLocked();
      this.dial.setLocked(next);
      this.chrome.setToast(
        next
          ? 'Position locked. Drag the red pin to rotate. Tap pin again to move.'
          : 'Drag to position. Tap the red pin to lock and rotate.',
      );
    };

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.keyboard?.on('keydown-ESC', () => this.cancelPlacing());

    // Tiny "practice →" link tucked under the PLAY label. Always available,
    // even while viewing/placing — new players can pop into the sandbox to
    // try an object before committing to today's puzzle.
    this.buildPracticeLink();

    this.refresh();
  }

  override update(_time: number, _delta: number) {
    if (this.revealId) this.tickReveal();
  }

  // ---------- data ----------

  private async refresh() {
    this.mode = 'loading';
    try {
      this.state = await getPostState(this.postId);
    } catch (e) {
      this.add.text(WORLD_W / 2, WORLD_H / 2, `load failed:\n${(e as Error).message}`, {
        fontFamily: FONT.mono,
        fontSize: '13px',
        color: '#C8312B',
        align: 'center',
      }).setOrigin(0.5);
      return;
    }

    const { meta, template } = this.state;
    this.chrome.build(
      {
        templateId: meta.templateId,
        day: meta.day,
        seedShort: meta.seed.toString(16).slice(-4),
        mode: 'play',
      },
      template.prompt,
    );

    if (this.state.locked) {
      // Hand off to ReplayScene so the user can watch tonight's reveal.
      this.scene.start('Replay', { postId: this.postId, state: this.state });
      return;
    }

    this.renderAllBodies();

    if (this.state.you.hasPlaced) {
      this.mode = 'viewing';
      this.chrome.setToast('You placed today. Reveal at midnight.', 'success');
      this.highlightYourPiece();
    } else {
      this.enterPicking();
    }
  }

  // ---------- rendering ----------

  private renderAllBodies(skipId: string | null = null) {
    if (!this.state) return;
    this.bodyLayer.clear();
    this.highlightLayer.clear();

    const snapById = new Map<string, { x: number; y: number; angle: number }>();
    if (this.state.snapshot) {
      for (const b of this.state.snapshot.snapshot) {
        const id = b.label.split(':').slice(1).join(':');
        if (id) snapById.set(id, { x: b.x, y: b.y, angle: b.a });
      }
    }

    const drawOne = (pl: Placement, isStart: boolean) => {
      if (pl.id === skipId) return;
      // Start placements are part of the puzzle definition — always rendered
      // at their authored positions. User placements show post-sim resting
      // positions so contributors see where their piece ended up.
      const pose = isStart
        ? { x: pl.x, y: pl.y, angle: pl.rotation }
        : (snapById.get(pl.id) ?? { x: pl.x, y: pl.y, angle: pl.rotation });
      const isYours =
        !isStart && pl.userId === this.state!.you.userId && this.state!.you.hasPlaced;
      drawBody(this.bodyLayer, pl, pose, {
        stroke: COLOR.graphite,
        strokeAlpha: isStart ? 0.6 : 1,
        highlight: isYours ? 'you' : 'none',
      });
    };

    for (const p of this.state.template.startPlacements) drawOne(p, true);
    for (const p of this.state.placements) drawOne(p, false);
  }

  private highlightYourPiece() {
    if (!this.state) return;
    const yours = [...this.state.placements]
      .reverse()
      .find((p) => p.userId === this.state!.you.userId);
    if (!yours) return;
    const snap = this.state.snapshot?.snapshot.find((b) => b.label.endsWith(`:${yours.id}`));
    const pose = snap
      ? { x: snap.x, y: snap.y, angle: snap.a }
      : { x: yours.x, y: yours.y, angle: yours.rotation };

    // Annotate the user's piece with a small mono callout.
    const tag = this.add.text(pose.x + 28, pose.y - 28, 'YOU', {
      fontFamily: FONT.mono,
      fontSize: '11px',
      color: '#C8312B',
    });
    this.uiLayer.add(tag);
  }

  private redrawGhost() {
    this.ghostLayer.clear();
    if (this.mode !== 'placing' || !this.picked) return;

    const pl: Placement = {
      id: 'ghost',
      userId: 'ghost',
      type: this.picked,
      x: this.ghostX,
      y: this.ghostY,
      rotation: this.ghostRotation,
      ts: 0,
    };

    this.ghostValid = this.checkGhostValid(pl);
    drawBody(this.ghostLayer, pl, { x: pl.x, y: pl.y, angle: pl.rotation }, {
      stroke: this.ghostValid ? COLOR.graphite : COLOR.carmine,
      strokeAlpha: 0.7,
    });

    // Crosshair on the ghost center to show the snap point.
    this.ghostLayer.lineStyle(1, COLOR.carmine, this.ghostValid ? 0.6 : 0.95);
    this.ghostLayer.lineBetween(this.ghostX - 6, this.ghostY, this.ghostX + 6, this.ghostY);
    this.ghostLayer.lineBetween(this.ghostX, this.ghostY - 6, this.ghostX, this.ghostY + 6);

    this.dial.move(this.ghostX, this.ghostY);
    this.updateButtonsForGhost();
  }

  private checkGhostValid(pl: Placement): boolean {
    if (!this.state) return false;
    if (pl.x < PLAYAREA_PAD || pl.x > WORLD_W - PLAYAREA_PAD) return false;
    if (pl.y < PLAYAREA_PAD || pl.y > WORLD_H - PLAYAREA_PAD - this.palette.height) return false;
    // Don't check overlap client-side; server is authoritative. Just bounds.
    return true;
  }

  // ---------- picking → placing transitions ----------

  private enterPicking() {
    this.mode = 'picking';
    this.chrome.setToast('Tap an object below to place it. One per day.');
    this.palette.build((type) => this.beginPlacing(type));
  }

  private beginPlacing(type: ObjectType) {
    if (this.mode !== 'picking') return;
    this.mode = 'placing';
    this.picked = type;
    this.palette.hide();
    // Toast text is set below based on whether this object rotates.

    this.ghostX = snap(WORLD_W / 2);
    this.ghostY = snap((WORLD_H - this.palette.height) / 2);
    this.ghostRotation = 0;

    const spec = CATALOG[type];
    if (spec.rotationSnapDeg > 0) {
      this.dial.show(this.ghostX, this.ghostY, spec.rotationSnapDeg, !!spec.cardinalOnly, 0);
      this.chrome.setToast('Drag to position. Tap the red pin to lock and rotate.');
    } else {
      this.dial.hide();
      this.chrome.setToast('Drag to position. Tap place to commit.');
    }

    this.buildActionButtons();
    this.redrawGhost();
  }

  private cancelPlacing() {
    if (this.mode !== 'placing') return;
    this.picked = null;
    this.dial.hide();
    this.ghostLayer.clear();
    this.tearDownActionButtons();
    this.enterPicking();
  }

  private async confirmPlacing() {
    if (this.mode !== 'placing' || !this.picked || !this.ghostValid) return;
    const type = this.picked;
    const x = this.ghostX;
    const y = this.ghostY;
    const rotation = this.ghostRotation;

    this.mode = 'submitting';
    this.chrome.setToast('placing…');
    this.dial.hide();
    this.tearDownActionButtons();

    try {
      const res = await placeObject(this.postId, { type, x, y, rotation });
      // Refresh state from server (snapshot + placements + hasPlaced).
      this.state = await getPostState(this.postId);
      this.ghostLayer.clear();
      this.renderAllBodies(/* skipId */ res.placement.id);
      // Remember where the user clicked so the reveal can draw a motion trail
      // from the click point to the resting position. Without this, a piece
      // that fell from the middle to the floor looks like it just vanished.
      this.revealClickX = x;
      this.revealClickY = y;
      this.startReveal(res.placement);
    } catch (e) {
      // Rejected — go back to picking with an error.
      this.mode = 'placing';
      this.chrome.setToast((e as Error).message, 'error');
      this.buildActionButtons();
      this.redrawGhost();
    }
  }

  // ---------- input ----------

  private onPointerMove(p: Phaser.Input.Pointer) {
    if (this.mode !== 'placing' || !p.isDown) return;
    if (!this.input.activePointer) return;
    // When the dial is locked, the user is rotating — position must not move.
    if (this.dial.isLocked()) return;
    // If the press started on the rotation pin (tap or drag), the dial owns
    // this gesture: it's either a tap-to-lock or a rotation drag. Either way
    // the ghost position must NOT jump under the cursor.
    if (this.dial.isPressing()) return;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    // Pointer over the palette strip (or below): not a placement gesture.
    // Without this, tapping a palette icon would slam the ghost down to just
    // above the palette — making circle pieces (balloon/magnet/bumper) look
    // "stuck" because they spawn behind the icon you just tapped.
    if (wp.y > WORLD_H - this.palette.height) return;
    this.ghostX = clamp(snap(wp.x), PLAYAREA_PAD, WORLD_W - PLAYAREA_PAD);
    this.ghostY = clamp(snap(wp.y), PLAYAREA_PAD, WORLD_H - PLAYAREA_PAD - this.palette.height);
    this.redrawGhost();
  }

  private onPointerDown(p: Phaser.Input.Pointer) {
    if (this.mode !== 'placing') return;
    if (this.dial.isLocked()) return;
    if (this.dial.isPressing()) return;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    if (wp.y > WORLD_H - this.palette.height) return;
    // Tap-to-position: jump ghost to tap location.
    this.ghostX = clamp(snap(wp.x), PLAYAREA_PAD, WORLD_W - PLAYAREA_PAD);
    this.ghostY = clamp(snap(wp.y), PLAYAREA_PAD, WORLD_H - PLAYAREA_PAD - this.palette.height);
    this.redrawGhost();
  }

  // ---------- action buttons ----------

  private buildActionButtons() {
    this.tearDownActionButtons();

    const btnY = WORLD_H - this.palette.height + 14;
    this.placeBtn = this.makeButton(WORLD_W - 88, btnY, 'place', COLOR.graphite, COLOR.paper, () =>
      this.confirmPlacing(),
    );
    // Cancel uses paper2 (a shade darker than the page) so it reads as a
    // tappable surface against the paper background, not a near-invisible outline.
    this.cancelBtn = this.makeButton(80, btnY, 'cancel', COLOR.paper2, COLOR.graphite, () =>
      this.cancelPlacing(),
    );
    this.uiLayer.add(this.placeBtn);
    this.uiLayer.add(this.cancelBtn);
  }

  private tearDownActionButtons() {
    if (this.placeBtn) { this.placeBtn.destroy(); }
    if (this.cancelBtn) { this.cancelBtn.destroy(); }
  }

  private updateButtonsForGhost() {
    if (!this.placeBtn) return;
    const valid = this.ghostValid;
    this.placeBtn.setAlpha(valid ? 1 : 0.4);
  }

  private makeButton(
    cx: number,
    cy: number,
    label: string,
    bg: number,
    fg: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(cx, cy);
    const w = 132;
    const h = 36;
    const g = this.add.graphics();

    const paint = (hovered: boolean) => {
      g.clear();
      // Drop shadow underneath when hovered, to make it feel lifted.
      if (hovered) {
        g.fillStyle(COLOR.graphite, 0.15);
        g.fillRect(-w / 2 + 2, -h / 2 + 3, w, h);
      }
      // Hand-drawn rectangle so the buttons match the rest of the page's hand.
      // Hover slightly inverts: the place button (graphite bg) brightens; the
      // cancel button (paper2 bg) darkens toward paper.
      const fillColor = hovered
        ? (bg === COLOR.graphite ? COLOR.carmine : COLOR.paper)
        : bg;
      g.fillStyle(fillColor, 1);
      g.fillRect(-w / 2, -h / 2, w, h);
      // Wobbly outline drawn as 4 jittered segments.
      g.lineStyle(hovered ? 2.2 : 1.8, COLOR.graphite, 0.9);
      const corners = [
        { x: -w / 2 + 1, y: -h / 2 + 1 },
        { x:  w / 2 - 1, y: -h / 2 + 0 },
        { x:  w / 2 + 0, y:  h / 2 - 1 },
        { x: -w / 2 - 1, y:  h / 2 + 1 },
      ];
      g.beginPath();
      g.moveTo(corners[0]!.x, corners[0]!.y);
      for (let i = 1; i < corners.length; i++) g.lineTo(corners[i]!.x, corners[i]!.y);
      g.closePath();
      g.strokePath();
    };
    paint(false);

    const text = this.add.text(0, 0, label, {
      fontFamily: FONT.mono,
      fontSize: '13px',
      fontStyle: 'bold',
      color: cssHex(fg),
    }).setOrigin(0.5);
    c.add([g, text]);

    const hit = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', onClick);
    hit.on('pointerover', () => paint(true));
    hit.on('pointerout', () => paint(false));
    c.add(hit);
    return c;
  }

  /** Tiny "practice →" link tucked under the PLAY label. */
  private buildPracticeLink() {
    const c = this.add.container(WORLD_W - 24, 38).setDepth(100);
    const text = this.add.text(0, 0, 'practice →', {
      fontFamily: FONT.mono,
      fontSize: '11px',
      color: '#1F2024',
    }).setOrigin(1, 0);
    c.add(text);
    const hit = this.add.zone(-40, 6, 80, 18).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => text.setColor('#C8312B'));
    hit.on('pointerout', () => text.setColor('#1F2024'));
    hit.on('pointerdown', () => this.scene.start('Practice'));
    c.add(hit);
  }

  // ---------- reveal animation ----------

  private startReveal(pl: Placement) {
    if (!this.state) return;
    this.revealId = pl.id;
    this.revealStart = this.time.now;
    if (REDUCED_MOTION) {
      this.finishReveal();
      return;
    }
  }

  private tickReveal() {
    if (!this.revealId || !this.state) return;
    const t = (this.time.now - this.revealStart) / this.revealDurationMs;
    if (t >= 1) { this.finishReveal(); return; }

    const pl =
      this.state.placements.find((p) => p.id === this.revealId) ?? null;
    if (!pl) { this.finishReveal(); return; }

    const snap = this.state.snapshot?.snapshot.find((b) => b.label.endsWith(`:${pl.id}`));
    const pose = snap
      ? { x: snap.x, y: snap.y, angle: snap.a }
      : { x: pl.x, y: pl.y, angle: pl.rotation };

    this.ghostLayer.clear();

    // Hand-drawn dashed motion trail from click point → rest. Only show when
    // the piece actually moved (physics dropped it). Draws in as t advances.
    const dx = pose.x - this.revealClickX;
    const dy = pose.y - this.revealClickY;
    const dist = Math.hypot(dx, dy);
    if (dist > 16) {
      const drawT = Math.min(1, t * 1.4);
      this.drawMotionTrail(this.revealClickX, this.revealClickY, pose.x, pose.y, drawT);
    }

    drawBody(this.ghostLayer, pl, pose, {
      stroke: COLOR.carmine,
      progress: easeOutQuad(t),
    });
  }

  /** Draw a dashed hand-jittered line from (x1,y1) → (x2,y2) revealing up to t∈[0,1]. */
  private drawMotionTrail(x1: number, y1: number, x2: number, y2: number, t: number) {
    const g = this.ghostLayer;
    const totalLen = Math.hypot(x2 - x1, y2 - y1);
    const visibleLen = totalLen * t;
    const dash = 8;
    const gap = 6;
    const ux = (x2 - x1) / totalLen;
    const uy = (y2 - y1) / totalLen;
    g.lineStyle(1.5, COLOR.carmine, 0.55);
    let s = 0;
    while (s < visibleLen) {
      const e = Math.min(s + dash, visibleLen);
      g.lineBetween(x1 + ux * s, y1 + uy * s, x1 + ux * e, y1 + uy * e);
      s += dash + gap;
    }
    // Tiny origin mark at the click point so the user remembers "I tapped here".
    g.lineStyle(1, COLOR.carmine, 0.7);
    g.strokeCircle(x1, y1, 4);
  }

  private finishReveal() {
    this.revealId = null;
    this.ghostLayer.clear();
    this.renderAllBodies();
    this.mode = 'viewing';
    this.chrome.setToast('Placed. Reveal at midnight.', 'success');
    this.highlightYourPiece();
  }
}

// ---------- helpers ----------

function snap(n: number) {
  return Math.round(n / SNAP_PX) * SNAP_PX;
}

function clamp(n: number, lo: number, hi: number) {
  return n < lo ? lo : n > hi ? hi : n;
}

function cssHex(n: number) {
  return '#' + n.toString(16).padStart(6, '0');
}

function easeOutQuad(t: number) {
  return 1 - (1 - t) * (1 - t);
}
