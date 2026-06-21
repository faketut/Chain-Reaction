// Chain Reaction — deterministic sim. Pure function plus stepwise class.
// Runs both server-side (authority) and client-side (replay).
//
// Determinism contract (must hold; harness verifies it):
//   - Fixed timestep TIMESTEP_MS, fixed TICKS budget.
//   - Bodies inserted in (template start, then ts asc, userId asc, id asc).
//   - All randomness flows through the seeded RNG.
//   - No Math.random, no Date.now inside the loop.
//   - Output snapshot rounded to 4 decimals; -0 normalized to 0.

import Matter from 'matter-js';
import {
  WORLD_W,
  WORLD_H,
  GRAVITY_Y,
  TIMESTEP_MS,
  MAX_TICKS_PER_PLACEMENT,
  GOAL_SENSOR_SIZE_PX,
  TWO_BALL_TIMING_WINDOW_TICKS,
} from './constants';
import { CATALOG } from './catalog';
import type {
  Placement,
  GoalTemplate,
  SnapshotBody,
  SimResult,
} from './types';
import { mulberry32 } from './rng';

const { Engine, Bodies, Body, Composite, Events } = Matter;

export interface SimInput {
  seed: number;
  template: GoalTemplate;
  /** User placements (template start objects are added separately). */
  placements: Placement[];
  /** Override tick budget (defaults to MAX_TICKS_PER_PLACEMENT). */
  ticks?: number;
}

type WinCondition = NonNullable<GoalTemplate['winCondition']> | { kind: 'sensorEntered' };

/**
 * Stepwise simulation. Construct once, call `step()` per tick, read body
 * positions from `bodiesById` for rendering. Used by ReplayScene.
 */
export class Sim {
  readonly engine: Matter.Engine;
  readonly tracked: Matter.Body[] = [];
  readonly bodiesById = new Map<string, Matter.Body>();
  /** Insertion-order ids, for stable iteration in render code. */
  readonly orderedIds: string[] = [];

  tick = 0;
  solved = false;
  solvedAtTick: number | null = null;

  private readonly rng: () => number;
  private readonly maxTicks: number;
  private readonly win: WinCondition;
  private readonly orderedHits: string[] = [];
  private readonly firstHitTick = new Map<string, number>();

  constructor(input: SimInput) {
    this.rng = mulberry32(input.seed);
    this.maxTicks = input.ticks ?? MAX_TICKS_PER_PLACEMENT;
    this.win = input.template.winCondition ?? { kind: 'sensorEntered' };

    this.engine = Engine.create({
      gravity: { x: 0, y: GRAVITY_Y },
      enableSleeping: false,
    });
    this.engine.timing.timeScale = 1;

    Composite.add(this.engine.world, [
      Bodies.rectangle(WORLD_W / 2, -10, WORLD_W, 20, { isStatic: true, label: 'wall:top' }),
      Bodies.rectangle(WORLD_W / 2, WORLD_H + 10, WORLD_W, 20, { isStatic: true, label: 'wall:bot' }),
      Bodies.rectangle(-10, WORLD_H / 2, 20, WORLD_H, { isStatic: true, label: 'wall:left' }),
      Bodies.rectangle(WORLD_W + 10, WORLD_H / 2, 20, WORLD_H, { isStatic: true, label: 'wall:right' }),
    ]);

    const all: Placement[] = [
      ...input.template.startPlacements,
      ...sortPlacements(input.placements),
    ];
    for (const pl of all) {
      const body = bodyFor(pl, this.rng);
      Composite.add(this.engine.world, body);
      this.tracked.push(body);
      this.bodiesById.set(pl.id, body);
      this.orderedIds.push(pl.id);
    }

    Events.on(this.engine, 'collisionStart', (evt) => this.onCollision(evt));
  }

  step(): void {
    if (this.tick >= this.maxTicks) return;
    applyCustomForces(this.tracked);
    Engine.update(this.engine, TIMESTEP_MS);

    if (this.win.kind === 'bodyRotatedPast' && !this.solved) {
      const win = this.win;
      const target = this.tracked.find((b) => b.label === win.bodyLabel);
      if (target && Math.abs(target.angle) >= win.radians) this.markSolved();
    }
    this.tick++;
  }

  done(): boolean {
    return this.tick >= this.maxTicks;
  }

  snapshot(): SnapshotBody[] {
    return this.tracked.map((b, i) => ({
      i,
      label: b.label,
      x: round4(b.position.x),
      y: round4(b.position.y),
      a: round4(b.angle),
      vx: round4(b.velocity.x),
      vy: round4(b.velocity.y),
      va: round4(b.angularVelocity),
    }));
  }

  private markSolved() {
    if (this.solved) return;
    this.solved = true;
    this.solvedAtTick = this.tick;
  }

  private onCollision(evt: Matter.IEventCollision<Matter.Engine>) {
    if (this.solved) return;
    for (const pair of evt.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      const sensor = a.isSensor ? a : b.isSensor ? b : null;
      const other = sensor ? (sensor === a ? b : a) : null;
      if (!sensor || !other) continue;

      switch (this.win.kind) {
        case 'sensorEntered':
          if (sensor.label.startsWith('goal:') && !other.isStatic) this.markSolved();
          break;
        case 'sensorEnteredBy':
          if (sensor.label.startsWith('goal:') && other.label.startsWith(this.win.labelPrefix)) {
            const key = other.label;
            if (!this.firstHitTick.has(key)) this.firstHitTick.set(key, this.tick);
            if (this.firstHitTick.size >= 2) {
              const ts = [...this.firstHitTick.values()].sort((x, y) => x - y);
              const first = ts[0]!;
              const last = ts[ts.length - 1]!;
              if (last - first <= TWO_BALL_TIMING_WINDOW_TICKS) this.markSolved();
            }
          }
          break;
        case 'allOfInOrder': {
          const win = this.win;
          if (sensor.label === win.finalLabel) {
            if (
              this.orderedHits.length === win.sensorLabels.length &&
              this.orderedHits.every((l, i) => l === win.sensorLabels[i])
            ) {
              this.markSolved();
            }
          } else if (win.sensorLabels.includes(sensor.label)) {
            const expected = win.sensorLabels[this.orderedHits.length];
            if (sensor.label === expected) this.orderedHits.push(sensor.label);
          }
          break;
        }
        case 'bodyRotatedPast':
          break;
      }
    }
  }
}

/** One-shot sim. Equivalent to constructing a Sim and stepping until done. */
export function runSim(input: SimInput): SimResult {
  const s = new Sim(input);
  while (!s.done()) s.step();
  return { snapshot: s.snapshot(), solved: s.solved, solvedAtTick: s.solvedAtTick };
}

// ---------- helpers ----------

function sortPlacements(ps: Placement[]): Placement[] {
  return [...ps].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function bodyFor(p: Placement, rng: () => number): Matter.Body {
  const wobble = (rng() - 0.5) * 0.5;
  const x = p.x + wobble;

  if (p.type === 'goal') {
    return Bodies.rectangle(x, p.y, GOAL_SENSOR_SIZE_PX, GOAL_SENSOR_SIZE_PX, {
      label: `goal:${p.id}`,
      isStatic: true,
      isSensor: true,
      angle: p.rotation,
    });
  }

  const spec = CATALOG[p.type];
  const label = `${p.type}:${p.id}`;
  const opts: Matter.IChamferableBodyDefinition = {
    label,
    angle: p.rotation,
    isStatic: spec.isStatic,
    isSensor: spec.isSensor,
    density: spec.density,
    friction: spec.friction,
    restitution: spec.restitution,
    // Optional: only forwarded when the spec sets it (e.g. balloon hover damping).
    ...(spec.frictionAir !== undefined ? { frictionAir: spec.frictionAir } : {}),
  };

  switch (spec.shape.kind) {
    case 'rect': {
      // Honor optional chamfer (rounded corners). Falls through to a plain
      // rectangle when undefined to keep the existing hashes stable.
      const rectOpts = spec.cornerRadius !== undefined
        ? { ...opts, chamfer: { radius: spec.cornerRadius } }
        : opts;
      return Bodies.rectangle(x, p.y, spec.shape.w, spec.shape.h, rectOpts);
    }
    case 'circle':
      return Bodies.circle(x, p.y, spec.shape.r, opts);
    case 'rightTri': {
      const { w, h, mirror } = spec.shape;
      const verts = mirror
        ? [
            { x: w / 2, y: -h / 2 },
            { x: -w / 2, y: h / 2 },
            { x: w / 2, y: h / 2 },
          ]
        : [
            { x: -w / 2, y: -h / 2 },
            { x: w / 2, y: h / 2 },
            { x: -w / 2, y: h / 2 },
          ];
      return Bodies.fromVertices(x, p.y, [verts], opts, true);
    }
  }
}

function applyCustomForces(bodies: Matter.Body[]) {
  for (const b of bodies) {
    const colon = b.label.indexOf(':');
    if (colon < 0) continue;
    const type = b.label.slice(0, colon);
    const spec = (CATALOG as Record<string, (typeof CATALOG)[keyof typeof CATALOG] | undefined>)[type];
    if (!spec || !spec.customForce) continue;

    const cf = spec.customForce;
    if (cf.kind === 'buoyancy') {
      Body.applyForce(b, b.position, { x: 0, y: -cf.force * b.mass });
      if (b.velocity.y < cf.terminalVy) {
        Body.setVelocity(b, { x: b.velocity.x, y: cf.terminalVy });
      }
    } else if (cf.kind === 'fan') {
      const dx = Math.cos(b.angle);
      const dy = Math.sin(b.angle);
      for (const target of bodies) {
        if (target === b || target.isStatic) continue;
        const rx = target.position.x - b.position.x;
        const ry = target.position.y - b.position.y;
        const d = Math.hypot(rx, ry);
        if (d > cf.range || d < 1e-6) continue;
        const nx = rx / d;
        const ny = ry / d;
        const cos = nx * dx + ny * dy;
        if (cos < Math.cos(cf.halfAngleRad)) continue;
        const falloff = 1 - d / cf.range;
        Body.applyForce(target, target.position, {
          x: dx * cf.force * falloff,
          y: dy * cf.force * falloff,
        });
      }
    } else if (cf.kind === 'magnet') {
      for (const target of bodies) {
        if (target === b) continue;
        if (!target.label.startsWith(cf.targetLabelPrefix)) continue;
        const rx = b.position.x - target.position.x;
        const ry = b.position.y - target.position.y;
        const d = Math.hypot(rx, ry);
        if (d > cf.range || d < 1e-6) continue;
        const f = cf.force * (1 - d / cf.range);
        Body.applyForce(target, target.position, {
          x: (rx / d) * f,
          y: (ry / d) * f,
        });
      }
    }
  }
}

function round4(n: number): number {
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}
