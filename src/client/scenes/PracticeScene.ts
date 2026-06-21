// Chain Reaction — PracticeScene.
//
// A standalone sandbox so new players can learn how each object behaves
// before committing to today's daily puzzle. Same physics, same renderer,
// same palette — but unlimited placements, instant Run, and Reset. Nothing
// in this scene touches the server.
//
// State machine:
//   building → placing → building → ... → running → verdict → building
//
// "building" includes the palette tear-off; pieces dropped here are stored
// in a local array. "running" hands the array + the practice template to
// the deterministic Sim and plays it forward exactly as ReplayScene does.

import Phaser from 'phaser';
import {
  WORLD_W,
  WORLD_H,
  PLAYAREA_PAD,
  MAX_TICKS_PER_PLACEMENT,
} from '../../shared/constants';
import { CATALOG } from '../../shared/catalog';
import { Sim } from '../../shared/sim';
import type { Placement, ObjectType, GoalTemplate } from '../../shared/types';
import { COLOR, FONT, SNAP_PX } from '../design/tokens';
import { drawBody } from '../design/bodyRenderer';
import { sketchRect } from '../design/sketch';
import { SceneChrome } from './SceneChrome';
import { PaletteStrip, PRACTICE_PALETTE } from './PaletteStrip';
import { RotationDial } from './RotationDial';

type Mode = 'building' | 'placing' | 'running' | 'verdict';

// Inline template. Defining it here (rather than in goals.ts) keeps the
// daily puzzle catalog clean and the practice playground a self-contained
// concern. The win condition is intentionally easy so first-timers get a
// taste of "SOLVED" feedback.
const PRACTICE_TEMPLATE: GoalTemplate = {
  id: 'PR',
  prompt: 'Practice — try anything. No one sees this.',
  startPlacements: [
    { id: 'pr_ball', userId: 'system', type: 'ball', x: 120, y: 180, rotation: 0, ts: 0 },
    { id: 'pr_ramp', userId: 'system', type: 'ramp_r', x: 120, y: 240, rotation: 0, ts: 0 },
    { id: 'pr_goal', userId: 'system', type: 'goal', x: 680, y: 980, rotation: 0, ts: 0 },
  ],
};

export class PracticeScene extends Phaser.Scene {
  private mode: Mode = 'building';

  private chrome!: SceneChrome;
  private palette!: PaletteStrip;
  private dial!: RotationDial;

  // Layers
  private bodyLayer!: Phaser.GameObjects.Graphics;
  private ghostLayer!: Phaser.GameObjects.Graphics;
  private fxLayer!: Phaser.GameObjects.Graphics;
  private uiLayer!: Phaser.GameObjects.Container;

  // Local placement store — never sent anywhere.
  private placements: Placement[] = [];
  private nextLocalId = 0;

  // Placement state (same shape as PlayScene)
  private picked: ObjectType | null = null;
  private ghostX = WORLD_W / 2;
  private ghostY = WORLD_H / 2;
  private ghostRotation = 0;
  private ghostValid = true;

  // Sim during 'running' phase.
  private sim: Sim | null = null;

  // Action / mode buttons (rebuilt on transitions).
  private actionBtns: Phaser.GameObjects.Container[] = [];
  private backBtn!: Phaser.GameObjects.Container;

  constructor() {
    super('Practice');
  }

  create() {
    this.chrome = new SceneChrome(this);
    this.palette = new PaletteStrip(this);
    this.dial = new RotationDial(this);

    this.bodyLayer = this.add.graphics().setDepth(10);
    this.ghostLayer = this.add.graphics().setDepth(20);
    this.fxLayer = this.add.graphics().setDepth(15);
    this.uiLayer = this.add.container(0, 0).setDepth(50);

    this.dial.build();
    this.dial.onChange = (r) => {
      this.ghostRotation = r;
      this.redrawGhost();
    };
    this.dial.onTap = () => {
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
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.mode === 'placing') this.cancelPlacing();
      else if (this.mode === 'verdict') this.continueEditing();
    });
    // Undo: Z (and U) pops the most recent user placement while in 'building'.
    // Sandbox-only — we don't replay history, just remove and re-render.
    const undoHandler = () => this.undoLastPlacement();
    this.input.keyboard?.on('keydown-Z', undoHandler);
    this.input.keyboard?.on('keydown-U', undoHandler);

    this.chrome.build(
      {
        templateId: PRACTICE_TEMPLATE.id,
        day: 0,
        seedShort: 'play',
        mode: 'practice',
      },
      PRACTICE_TEMPLATE.prompt,
    );

    // Persistent top-right "back to today" link sits just under the PRACTICE
    // label. Tap returns to the daily puzzle scene.
    this.backBtn = this.makeBackButton();
    this.uiLayer.add(this.backBtn);

    this.renderAllBodies();
    this.enterBuilding();
  }

  override update(_time: number, _delta: number) {
    if (this.mode !== 'running' || !this.sim) return;
    this.sim.step();
    this.renderSimFrame();
    if (this.sim.tick >= MAX_TICKS_PER_PLACEMENT || this.sim.solved) {
      this.enterVerdict();
    }
  }

  // ---------- state transitions ----------

  private enterBuilding() {
    this.mode = 'building';
    this.picked = null;
    this.sim = null;
    this.dial.hide();
    this.ghostLayer.clear();
    this.fxLayer.clear();
    this.tearDownActionButtons();
    this.renderAllBodies();
    this.palette.show();
    this.palette.build((type) => this.beginPlacing(type), PRACTICE_PALETTE);
    this.buildBuildingButtons();
    this.chrome.setToast(
      this.placements.length === 0
        ? 'Tap an object below to drop it. Hit run when ready.'
        : `${this.placements.length} piece${this.placements.length === 1 ? '' : 's'} placed. Run sim, undo (Z), or add more.`,
    );
  }

  private beginPlacing(type: ObjectType) {
    if (this.mode !== 'building') return;
    this.mode = 'placing';
    this.picked = type;
    this.palette.hide();

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

    this.tearDownActionButtons();
    this.buildPlacingButtons();
    this.redrawGhost();
  }

  private cancelPlacing() {
    if (this.mode !== 'placing') return;
    this.picked = null;
    this.dial.hide();
    this.ghostLayer.clear();
    this.enterBuilding();
  }

  private confirmPlacing() {
    if (this.mode !== 'placing' || !this.picked || !this.ghostValid) return;
    const pl: Placement = {
      id: `pr_user_${this.nextLocalId++}`,
      userId: 'me',
      type: this.picked,
      x: this.ghostX,
      y: this.ghostY,
      rotation: this.ghostRotation,
      ts: Date.now(),
    };
    this.placements.push(pl);
    this.picked = null;
    this.dial.hide();
    this.ghostLayer.clear();
    this.enterBuilding();
  }

  private runSim() {
    if (this.mode !== 'building') return;
    this.mode = 'running';
    this.dial.hide();
    this.ghostLayer.clear();
    this.palette.hide();
    this.tearDownActionButtons();
    this.chrome.setToast('Running…');
    // Deterministic — same seed = same playback every time.
    this.sim = new Sim({
      seed: 0xC0FFEE,
      template: PRACTICE_TEMPLATE,
      placements: this.placements,
    });
  }

  /** Pop the most recently placed user piece. No-op outside 'building'. */
  private undoLastPlacement() {
    if (this.mode !== 'building') return;
    if (this.placements.length === 0) {
      this.chrome.setToast('Nothing to undo.');
      return;
    }
    const removed = this.placements.pop()!;
    this.renderAllBodies();
    // Rebuild the bottom toolbar so the run/clear button reflects the new
    // placement count (e.g. flips back to 'back' at zero pieces).
    this.tearDownActionButtons();
    this.buildBuildingButtons();
    this.chrome.setToast(
      this.placements.length === 0
        ? `Undid ${removed.type}. Tap an object below to drop it.`
        : `Undid ${removed.type}. ${this.placements.length} left.`,
    );
  }

  private enterVerdict() {
    this.mode = 'verdict';
    const solved = this.sim?.solved ?? false;
    this.chrome.setToast(
      solved ? 'SOLVED — the ball reached the goal.' : 'Stalled. Try a different layout.',
      solved ? 'success' : 'error',
    );
    this.drawVerdictStamp(solved);
    this.buildVerdictButtons();
  }

  private continueEditing() {
    if (this.mode !== 'verdict') return;
    this.fxLayer.clear();
    this.enterBuilding();
  }

  private clearAll() {
    this.placements = [];
    this.fxLayer.clear();
    this.enterBuilding();
  }

  // ---------- rendering ----------

  private renderAllBodies() {
    this.bodyLayer.clear();
    for (const pl of PRACTICE_TEMPLATE.startPlacements) {
      drawBody(this.bodyLayer, pl, { x: pl.x, y: pl.y, angle: pl.rotation }, {
        stroke: COLOR.graphite,
        strokeAlpha: 0.6,
      });
    }
    for (const pl of this.placements) {
      drawBody(this.bodyLayer, pl, { x: pl.x, y: pl.y, angle: pl.rotation }, {
        stroke: COLOR.graphite,
      });
    }
  }

  private renderSimFrame() {
    if (!this.sim) return;
    this.bodyLayer.clear();
    const all = [...PRACTICE_TEMPLATE.startPlacements, ...this.placements];
    for (const pl of all) {
      const body = this.sim.bodiesById.get(pl.id);
      const pose = body
        ? { x: body.position.x, y: body.position.y, angle: body.angle, vy: body.velocity.y }
        : { x: pl.x, y: pl.y, angle: pl.rotation };
      drawBody(this.bodyLayer, pl, pose, {
        stroke: pl.type === 'goal' && this.sim.solved ? COLOR.seal : COLOR.graphite,
        strokeAlpha: PRACTICE_TEMPLATE.startPlacements.includes(pl) ? 0.6 : 1,
      });
    }
  }

  private redrawGhost() {
    if (this.mode !== 'placing' || !this.picked) return;
    this.ghostLayer.clear();

    const pl: Placement = {
      id: 'ghost',
      userId: 'me',
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
    // Crosshair at snap point.
    this.ghostLayer.lineStyle(1, COLOR.carmine, this.ghostValid ? 0.6 : 0.95);
    this.ghostLayer.lineBetween(this.ghostX - 6, this.ghostY, this.ghostX + 6, this.ghostY);
    this.ghostLayer.lineBetween(this.ghostX, this.ghostY - 6, this.ghostX, this.ghostY + 6);

    this.dial.move(this.ghostX, this.ghostY);
    this.updateButtonsForGhost();
  }

  private checkGhostValid(pl: Placement): boolean {
    if (pl.x < PLAYAREA_PAD || pl.x > WORLD_W - PLAYAREA_PAD) return false;
    if (pl.y < PLAYAREA_PAD || pl.y > WORLD_H - PLAYAREA_PAD - this.palette.height) return false;
    return true;
  }

  private drawVerdictStamp(solved: boolean) {
    this.fxLayer.clear();
    // Hand-drawn rounded badge in the center, like ReplayScene's SOLVED stamp.
    const cx = WORLD_W / 2;
    const cy = WORLD_H / 2;
    const text = solved ? 'SOLVED' : 'STALLED';
    const color = solved ? COLOR.seal : COLOR.carmine;
    sketchRect(this.fxLayer, cx, cy, 320, 100, 0, 'verdict', {
      stroke: color, lineWidth: 4, fill: COLOR.paper, fillAlpha: 0.9,
    });
    sketchRect(this.fxLayer, cx, cy, 300, 80, 0, 'verdict2', {
      stroke: color, lineWidth: 2,
    });
    const t = this.add.text(cx, cy, text, {
      fontFamily: FONT.mono,
      fontSize: '56px',
      fontStyle: 'bold',
      color: '#' + color.toString(16).padStart(6, '0'),
    }).setOrigin(0.5).setDepth(16);
    t.setAngle(-6);
    // Pop-in scale.
    t.setScale(0.6);
    this.tweens.add({
      targets: t,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
    });
    // Tween in the rect lineWidth by re-tweening alpha for simplicity.
    this.tweens.add({
      targets: this.fxLayer,
      alpha: { from: 0, to: 1 },
      duration: 200,
    });
    // Auto-remove text when leaving verdict — track on fxLayer clear via a one-shot.
    this.events.once('verdict-cleanup', () => t.destroy());
  }

  // ---------- input ----------

  private onPointerMove(p: Phaser.Input.Pointer) {
    if (this.mode !== 'placing' || !p.isDown) return;
    if (this.dial.isLocked() || this.dial.isPressing()) return;
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
    if (this.dial.isLocked() || this.dial.isPressing()) return;
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    if (wp.y > WORLD_H - this.palette.height) return;
    this.ghostX = clamp(snap(wp.x), PLAYAREA_PAD, WORLD_W - PLAYAREA_PAD);
    this.ghostY = clamp(snap(wp.y), PLAYAREA_PAD, WORLD_H - PLAYAREA_PAD - this.palette.height);
    this.redrawGhost();
  }

  // ---------- buttons ----------

  private buildBuildingButtons() {
    const btnY = WORLD_H - this.palette.height + 14;
    const hasPlacements = this.placements.length > 0;
    const runBtn = this.makeButton(
      WORLD_W - 88,
      btnY,
      'run sim',
      hasPlacements ? COLOR.graphite : COLOR.paper2,
      hasPlacements ? COLOR.paper : COLOR.graphite,
      () => { if (hasPlacements) this.runSim(); },
    );
    if (!hasPlacements) runBtn.setAlpha(0.4);
    const clearBtn = this.makeButton(
      80,
      btnY,
      hasPlacements ? 'clear' : 'back',
      COLOR.paper2,
      COLOR.graphite,
      () => { hasPlacements ? this.clearAll() : this.scene.start('Play', { postId: getPostId() }); },
    );
    this.uiLayer.add(runBtn);
    this.uiLayer.add(clearBtn);
    this.actionBtns.push(runBtn, clearBtn);
  }

  private buildPlacingButtons() {
    const btnY = WORLD_H - this.palette.height + 14;
    const placeBtn = this.makeButton(WORLD_W - 88, btnY, 'place', COLOR.graphite, COLOR.paper, () =>
      this.confirmPlacing(),
    );
    const cancelBtn = this.makeButton(80, btnY, 'cancel', COLOR.paper2, COLOR.graphite, () =>
      this.cancelPlacing(),
    );
    this.uiLayer.add(placeBtn);
    this.uiLayer.add(cancelBtn);
    this.actionBtns.push(placeBtn, cancelBtn);
  }

  private buildVerdictButtons() {
    const btnY = WORLD_H - this.palette.height + 14;
    const continueBtn = this.makeButton(WORLD_W - 88, btnY, 'edit more', COLOR.graphite, COLOR.paper, () =>
      this.continueEditing(),
    );
    const clearBtn = this.makeButton(80, btnY, 'clear all', COLOR.paper2, COLOR.graphite, () =>
      this.clearAll(),
    );
    this.uiLayer.add(continueBtn);
    this.uiLayer.add(clearBtn);
    this.actionBtns.push(continueBtn, clearBtn);
  }

  private tearDownActionButtons() {
    for (const b of this.actionBtns) b.destroy();
    this.actionBtns = [];
    this.events.emit('verdict-cleanup');
  }

  private updateButtonsForGhost() {
    const place = this.actionBtns[0];
    if (place && this.mode === 'placing') place.setAlpha(this.ghostValid ? 1 : 0.4);
  }

  private makeBackButton(): Phaser.GameObjects.Container {
    // Tiny "← daily" link tucked under the PRACTICE label.
    const c = this.add.container(WORLD_W - 24, 38);
    const text = this.add.text(0, 0, '← back to daily', {
      fontFamily: FONT.mono,
      fontSize: '11px',
      color: '#1F2024',
    }).setOrigin(1, 0);
    c.add(text);
    const hit = this.add.zone(-50, 6, 110, 18).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => text.setColor('#C8312B'));
    hit.on('pointerout', () => text.setColor('#1F2024'));
    hit.on('pointerdown', () => this.scene.start('Play', { postId: getPostId() }));
    c.add(hit);
    return c;
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
      if (hovered) {
        g.fillStyle(COLOR.graphite, 0.15);
        g.fillRect(-w / 2 + 2, -h / 2 + 3, w, h);
      }
      const fillColor = hovered
        ? (bg === COLOR.graphite ? COLOR.carmine : COLOR.paper)
        : bg;
      g.fillStyle(fillColor, 1);
      g.fillRect(-w / 2, -h / 2, w, h);
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
      color: '#' + fg.toString(16).padStart(6, '0'),
    }).setOrigin(0.5);
    c.add([g, text]);

    const hit = this.add.zone(0, 0, w, h).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', onClick);
    hit.on('pointerover', () => paint(true));
    hit.on('pointerout', () => paint(false));
    c.add(hit);
    return c;
  }
}

// ---------- helpers ----------

function snap(n: number) {
  return Math.round(n / SNAP_PX) * SNAP_PX;
}
function clamp(n: number, lo: number, hi: number) {
  return n < lo ? lo : n > hi ? hi : n;
}
function getPostId(): string {
  const url = new URL(window.location.href);
  return url.searchParams.get('postId')
    ?? (window as unknown as { __DEVVIT_POST_ID__?: string }).__DEVVIT_POST_ID__
    ?? 'dev_local_post';
}
