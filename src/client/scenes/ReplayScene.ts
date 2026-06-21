// Chain Reaction — ReplayScene.
//
// Scheduled when a post is locked. Re-runs the deterministic sim client-side
// from {seed, template, placements} and animates it. The choreography is the
// signature moment of the day:
//
//   Phase 1 — DRAFTING (1.5s):  template start objects sketch in
//   Phase 2 — STAGING (3s):     each user placement is *drawn* in, in order
//   Phase 3 — RELEASE:          gravity engages, sim plays at 1x
//   Phase 4 — VERDICT:          on solve, reticle pulses + teal "SOLVED" stamp
//                                MVP placement is haloed in ochre.

import Phaser from 'phaser';
import { WORLD_W, WORLD_H, MAX_TICKS_PER_PLACEMENT } from '../../shared/constants';
import type { Placement } from '../../shared/types';
import { Sim } from '../../shared/sim';
import type { PostStateResponse } from '../api';
import { getPostState, getLeaderboard } from '../api';
import { COLOR, FONT } from '../design/tokens';
import { drawBody, bodyRadius } from '../design/bodyRenderer';
import { sketchReticle, sketchRect } from '../design/sketch';
import { SceneChrome } from './SceneChrome';

const REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Phase = 'idle' | 'drafting' | 'staging' | 'release' | 'verdict';

export class ReplayScene extends Phaser.Scene {
  private postId!: string;
  private state: PostStateResponse | null = null;

  private chrome!: SceneChrome;
  private bgLayer!: Phaser.GameObjects.Graphics;
  private bodyLayer!: Phaser.GameObjects.Graphics;
  private fxLayer!: Phaser.GameObjects.Graphics;

  private sim: Sim | null = null;
  private phase: Phase = 'idle';
  private phaseStart = 0;

  // Order in which user placements appear during staging.
  private stagingOrder: Placement[] = [];
  // Currently revealed user-placement count during staging.
  private staged = 0;

  private mvpPlacement: Placement | null = null;
  private verdictText: Phaser.GameObjects.Text | null = null;

  // Trails behind dynamic bodies during release.
  private trails = new Map<string, Array<{ x: number; y: number; t: number }>>();

  constructor() {
    super('Replay');
  }

  init(data: { postId: string; state?: PostStateResponse }) {
    this.postId = data.postId;
    this.state = data.state ?? null;
  }

  async create() {
    this.chrome = new SceneChrome(this);
    this.bgLayer = this.add.graphics().setDepth(5);
    this.bodyLayer = this.add.graphics().setDepth(10);
    this.fxLayer = this.add.graphics().setDepth(15);

    if (!this.state) {
      try {
        this.state = await getPostState(this.postId);
      } catch (e) {
        this.add.text(WORLD_W / 2, WORLD_H / 2, `replay load failed:\n${(e as Error).message}`, {
          fontFamily: FONT.mono, fontSize: '13px', color: '#C8312B', align: 'center',
        }).setOrigin(0.5);
        return;
      }
    }

    const { meta, template, placements, result } = this.state;
    this.chrome.build(
      {
        templateId: meta.templateId,
        day: meta.day,
        seedShort: meta.seed.toString(16).slice(-4),
        mode: 'replay',
      },
      template.prompt,
    );

    // Sort user placements by ts/userId/id (server is supposed to keep them
    // ordered already, but normalize defensively).
    this.stagingOrder = [...placements].sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    if (result?.influentialPlacementIds.length) {
      const id = result.influentialPlacementIds[0]!;
      this.mvpPlacement = placements.find((p) => p.id === id) ?? null;
    }

    // Spin up sim and immediately render the start objects (drafting phase).
    this.sim = new Sim({ seed: meta.seed, template, placements });
    this.phase = 'drafting';
    this.phaseStart = this.time.now;
    this.chrome.setToast(`replay · ${placements.length} placements`);

    // Scrubber rule below the prompt.
    this.fxLayer.lineStyle(1, COLOR.graphite, 0.25);
    this.fxLayer.lineBetween(20, 130, WORLD_W - 20, 130);
  }

  override update(_time: number) {
    if (!this.sim || !this.state) return;
    switch (this.phase) {
      case 'drafting': this.tickDrafting(); break;
      case 'staging':  this.tickStaging();  break;
      case 'release':  this.tickRelease();  break;
      case 'verdict':  this.tickVerdict();  break;
    }
  }

  // ---------- drafting (1.5s): sketch in template start objects ----------

  private tickDrafting() {
    const dur = REDUCED_MOTION ? 0 : 1500;
    const t = dur === 0 ? 1 : Math.min(1, (this.time.now - this.phaseStart) / dur);

    this.bodyLayer.clear();
    if (!this.state) return;
    const start = this.state.template.startPlacements;
    for (let i = 0; i < start.length; i++) {
      const pl = start[i]!;
      const localT = clamp01(t * start.length - i);
      drawBody(this.bodyLayer, pl, { x: pl.x, y: pl.y, angle: pl.rotation }, {
        stroke: COLOR.graphite,
        strokeAlpha: 0.6,
        progress: localT,
      });
    }

    if (t >= 1) {
      this.phase = 'staging';
      this.phaseStart = this.time.now;
    }
  }

  // ---------- staging (3s): user placements draw in one by one ----------

  private tickStaging() {
    if (!this.state) return;
    const total = this.stagingOrder.length;
    const dur = REDUCED_MOTION || total === 0 ? 0 : 3000;
    const t = dur === 0 ? 1 : Math.min(1, (this.time.now - this.phaseStart) / dur);
    const targetCount = Math.floor(t * total);
    this.staged = Math.min(total, targetCount);

    this.bodyLayer.clear();
    // Re-draw start objects fully.
    for (const pl of this.state.template.startPlacements) {
      drawBody(this.bodyLayer, pl, { x: pl.x, y: pl.y, angle: pl.rotation }, {
        stroke: COLOR.graphite,
        strokeAlpha: 0.6,
      });
    }
    // Fully drawn user placements.
    for (let i = 0; i < this.staged; i++) {
      const pl = this.stagingOrder[i]!;
      drawBody(this.bodyLayer, pl, { x: pl.x, y: pl.y, angle: pl.rotation }, {
        stroke: COLOR.graphite,
      });
    }
    // The currently-drawing placement, with stroke progress.
    if (this.staged < total) {
      const pl = this.stagingOrder[this.staged]!;
      const within = total === 0 ? 1 : (t * total) - this.staged;
      drawBody(this.bodyLayer, pl, { x: pl.x, y: pl.y, angle: pl.rotation }, {
        stroke: COLOR.carmine,
        progress: clamp01(within),
      });
    }

    if (t >= 1) {
      this.phase = 'release';
      this.phaseStart = this.time.now;
      this.chrome.setToast('release', 'info');
    }
  }

  // ---------- release: drive Sim.step() once per Phaser update ----------

  private tickRelease() {
    if (!this.sim || !this.state) return;

    // One sim step per render frame keeps replay at sim's natural 60Hz.
    this.sim.step();

    // Update body layer from current sim positions.
    this.bodyLayer.clear();
    for (const pl of this.state.template.startPlacements) {
      const body = this.sim.bodiesById.get(pl.id);
      const pose = body
        ? { x: body.position.x, y: body.position.y, angle: body.angle, vy: body.velocity.y }
        : { x: pl.x, y: pl.y, angle: pl.rotation };
      drawBody(this.bodyLayer, pl, pose, {
        stroke: pl.type === 'goal' && this.sim.solved ? COLOR.seal : COLOR.graphite,
        strokeAlpha: pl.type === 'goal' ? 1 : 0.7,
      });
    }
    for (const pl of this.stagingOrder) {
      const body = this.sim.bodiesById.get(pl.id);
      const pose = body
        ? { x: body.position.x, y: body.position.y, angle: body.angle, vy: body.velocity.y }
        : { x: pl.x, y: pl.y, angle: pl.rotation };
      const isMvp = this.mvpPlacement?.id === pl.id;
      drawBody(this.bodyLayer, pl, pose, {
        stroke: COLOR.graphite,
        highlight: isMvp ? 'mvp' : 'none',
      });

      // Trails for dynamic bodies.
      if (body && !body.isStatic) this.appendTrail(pl.id, body.position.x, body.position.y);
    }
    this.drawTrails();

    if (this.sim.tick >= MAX_TICKS_PER_PLACEMENT || this.sim.solved) {
      this.phase = 'verdict';
      this.phaseStart = this.time.now;
      this.showVerdict();
    }
  }

  private appendTrail(id: string, x: number, y: number) {
    let arr = this.trails.get(id);
    if (!arr) { arr = []; this.trails.set(id, arr); }
    arr.push({ x, y, t: this.time.now });
    // Cap length.
    if (arr.length > 30) arr.shift();
  }

  private drawTrails() {
    this.fxLayer.clear();
    this.fxLayer.lineStyle(1, COLOR.graphite, 0.18);
    this.fxLayer.lineBetween(20, 130, WORLD_W - 20, 130);

    for (const arr of this.trails.values()) {
      if (arr.length < 2) continue;
      this.fxLayer.lineStyle(1, COLOR.graphite, 0.10);
      this.fxLayer.beginPath();
      this.fxLayer.moveTo(arr[0]!.x, arr[0]!.y);
      for (let i = 1; i < arr.length; i++) this.fxLayer.lineTo(arr[i]!.x, arr[i]!.y);
      this.fxLayer.strokePath();
    }
  }

  // ---------- verdict ----------

  private showVerdict() {
    if (!this.sim || !this.state) return;
    const solved = this.sim.solved;
    const stampColor = solved ? COLOR.seal : COLOR.carmine;
    const stampHex = solved ? '#1B5E50' : '#C8312B';

    // Hand-drawn stamp border: a sketched rectangle around the verdict text,
    // slightly rotated like a hand-applied rubber stamp.
    const stampGroup = this.add.container(WORLD_W / 2, WORLD_H / 2);
    const border = this.add.graphics();
    sketchRect(border, 0, 0, 360, 120, 0, `verdict-stamp-${solved ? 'ok' : 'no'}`, {
      stroke: stampColor,
      lineWidth: 4,
    });
    // Double-line border, classic stamp look.
    sketchRect(border, 0, 0, 340, 100, 0, `verdict-stamp2-${solved ? 'ok' : 'no'}`, {
      stroke: stampColor,
      lineWidth: 2,
    });
    stampGroup.add(border);

    const big = this.add.text(
      0,
      0,
      solved ? 'SOLVED' : 'STALLED',
      {
        fontFamily: FONT.mono,
        fontSize: '72px',
        fontStyle: 'bold',
        color: stampHex,
        align: 'center',
      },
    ).setOrigin(0.5);
    stampGroup.add(big);

    stampGroup.setAngle(-6);
    stampGroup.setAlpha(0);
    stampGroup.setScale(0.6);
    this.tweens.add({
      targets: stampGroup,
      alpha: 1,
      scale: 1,
      duration: REDUCED_MOTION ? 0 : 280,
      ease: 'Back.easeOut',
    });
    this.verdictText = big;

    const sub = this.add.text(
      WORLD_W / 2,
      WORLD_H / 2 + 38,
      solved
        ? `at tick ${this.sim.solvedAtTick} · ${this.stagingOrder.length} placements`
        : `${this.stagingOrder.length} placements · short of the goal`,
      {
        fontFamily: FONT.mono,
        fontSize: '13px',
        color: solved ? '#1B5E50' : '#C8312B',
      },
    ).setOrigin(0.5);
    sub.setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 1, duration: 600, delay: 200 });

    if (solved) {
      // Pulse the goal reticle.
      const goalPl = this.state.template.startPlacements.find((p) => p.type === 'goal');
      if (goalPl) {
        const ring = this.add.graphics();
        let pulse = 0;
        this.time.addEvent({
          loop: true,
          delay: 16,
          callback: () => {
            pulse = Math.min(1, pulse + 0.02);
            ring.clear();
            sketchReticle(ring, goalPl.x, goalPl.y, 56 + pulse * 12, goalPl.id, {
              solved: true,
              pulse: Math.sin(pulse * Math.PI * 4) * 0.3 + 0.3,
            });
          },
        });
      }
    }

    if (this.mvpPlacement) {
      const pl = this.mvpPlacement;
      const body = this.sim.bodiesById.get(pl.id);
      const px = body?.position.x ?? pl.x;
      const py = body?.position.y ?? pl.y;
      const r = bodyRadius(pl) + 8;
      const tag = this.add.text(px + r + 4, py - r - 8, `MVP · ${shortUser(pl.userId)}`, {
        fontFamily: FONT.mono,
        fontSize: '11px',
        color: '#D4A23A',
      });
      tag.setAlpha(0);
      this.tweens.add({ targets: tag, alpha: 1, duration: 500, delay: 400 });
    }

    // Cross-post MVP leaderboard. Fetched async after the verdict stamp lands
    // so it doesn't block the celebratory moment. Failure is silent — the
    // verdict still reads as complete without it.
    void this.renderLeaderboardPanel();

    this.chrome.setToast('tap to replay', 'info');
    this.input.once('pointerdown', () => this.scene.restart({ postId: this.postId, state: this.state }));
  }

  /** Top-N MVP standings rendered as a small panel in the lower-left of the
   *  verdict screen. Read-only; reflects credits already written at lock time. */
  private async renderLeaderboardPanel() {
    let entries: { userId: string; score: number }[] = [];
    try {
      const r = await getLeaderboard('mvp', 5);
      entries = r.entries;
    } catch {
      return; // best effort
    }
    if (entries.length === 0) return;

    const panel = this.add.container(24, WORLD_H / 2 + 80).setDepth(40);
    const headline = this.add.text(0, 0, 'top mvps', {
      fontFamily: FONT.mono,
      fontSize: '10px',
      color: '#8A7A66',
    });
    panel.add(headline);

    const meId = this.state?.you.userId;
    entries.forEach((e, i) => {
      const isMe = !!meId && e.userId === meId;
      const isMvp = this.mvpPlacement?.userId === e.userId;
      const color = isMe || isMvp ? '#D4A23A' : '#3D3326';
      const row = this.add.text(
        0,
        14 + i * 14,
        `${(i + 1).toString().padStart(2, ' ')}. ${shortUser(e.userId).padEnd(12, ' ')} ${e.score}`,
        {
          fontFamily: FONT.mono,
          fontSize: '11px',
          color,
        },
      );
      panel.add(row);
    });

    panel.setAlpha(0);
    this.tweens.add({ targets: panel, alpha: 1, duration: 400, delay: 600 });
  }

  private tickVerdict() {
    // Verdict is event-driven; nothing per-frame.
  }
}

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function shortUser(userId: string) {
  // "t2_abc123" → "abc123" (Reddit user ids), or short raw.
  const m = userId.match(/^t2_(.+)$/);
  return m ? `u/${m[1]}` : userId.length > 10 ? userId.slice(0, 8) + '…' : userId;
}
