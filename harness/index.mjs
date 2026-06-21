// Chain Reaction — determinism harness.
//
// Goal: prove that, given identical (seed, placements, template) inputs, the
// physics sim produces a byte-identical final snapshot hash across multiple
// runs in the same process. If this ever fails, the architecture (server
// authority + client replay + "most influential placement" calc) cannot ship.
//
// Run:  npm install && npm test
//
// Exit code 0 = all checks pass. Non-zero = a determinism violation.

import Matter from 'matter-js';
import { createHash } from 'node:crypto';

const { Engine, World, Bodies, Body, Composite, Events } = Matter;

// ---------- world constants (must match docs/design.md) ----------
const WORLD_W = 800;
const WORLD_H = 1200;
const TIMESTEP_MS = 1000 / 60; // 16.6667
const TICKS = 600;             // 10 seconds of sim
const PLAYAREA_PAD = 32;

// ---------- seeded RNG (mulberry32) ----------
// All "randomness" in the game must flow through this. No Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic seed from a postId-like string.
function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- placement → body factory ----------
// Minimal subset of the catalog needed to exercise determinism: domino, ball,
// ramp_r, bumper, goal. Adding more types should not affect determinism as long
// as the insertion-order rule is preserved.
function bodyFromPlacement(p) {
  switch (p.type) {
    case 'domino':
      return Bodies.rectangle(p.x, p.y, 12, 64, {
        label: `domino:${p.id}`,
        angle: p.rotation ?? 0,
        density: 0.001,
        friction: 0.3,
        restitution: 0.05,
      });
    case 'ball':
      return Bodies.circle(p.x, p.y, 16, {
        label: `ball:${p.id}`,
        density: 0.0015,
        friction: 0.05,
        restitution: 0.4,
      });
    case 'ramp_r':
      return Bodies.fromVertices(
        p.x,
        p.y,
        [[
          { x: -48, y: -24 },
          { x: 48, y: 24 },
          { x: -48, y: 24 },
        ]],
        { label: `ramp_r:${p.id}`, isStatic: true, friction: 0.2, restitution: 0 },
        true,
      );
    case 'bumper':
      return Bodies.circle(p.x, p.y, 20, {
        label: `bumper:${p.id}`,
        isStatic: true,
        friction: 0,
        restitution: 1.4,
      });
    case 'goal':
      return Bodies.rectangle(p.x, p.y, 48, 48, {
        label: `goal:${p.id}`,
        isStatic: true,
        isSensor: true,
      });
    default:
      throw new Error(`unknown placement type: ${p.type}`);
  }
}

// ---------- sim ----------
//
// Insertion order is the contract: placements sorted by (ts asc, userId asc).
// Walls and goal are added FIRST in a fixed order so they always own the same
// body ids.
function runSim({ seed, placements }) {
  const rng = mulberry32(seed);
  const engine = Engine.create({
    gravity: { x: 0, y: 1 },
    // Disabling sleeping removes a major nondeterminism source across runs.
    enableSleeping: false,
  });
  // Lock the timing model: we step manually with a fixed dt below, so this
  // mostly matters when Engine.update internals consult timing.
  engine.timing.timeScale = 1;

  // Walls (always first, always same order).
  const walls = [
    Bodies.rectangle(WORLD_W / 2, -10, WORLD_W, 20, { isStatic: true, label: 'wall:top' }),
    Bodies.rectangle(WORLD_W / 2, WORLD_H + 10, WORLD_W, 20, { isStatic: true, label: 'wall:bot' }),
    Bodies.rectangle(-10, WORLD_H / 2, 20, WORLD_H, { isStatic: true, label: 'wall:left' }),
    Bodies.rectangle(WORLD_W + 10, WORLD_H / 2, 20, WORLD_H, { isStatic: true, label: 'wall:right' }),
  ];
  Composite.add(engine.world, walls);

  // Sort placements deterministically.
  const sorted = [...placements].sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });

  // Apply RNG-driven jitter at insertion time (proves the seed flows through).
  // Sub-pixel wobble: ±0.25 px in x. Sim-deterministic because rng is seeded.
  const trackedBodies = [];
  for (const p of sorted) {
    const wobble = (rng() - 0.5) * 0.5;
    const body = bodyFromPlacement({ ...p, x: p.x + wobble });
    Composite.add(engine.world, body);
    trackedBodies.push(body);
  }

  // Detect goal entry.
  let solved = false;
  let solvedAtTick = null;
  const goal = Composite.allBodies(engine.world).find((b) => b.label.startsWith('goal:'));
  Events.on(engine, 'collisionStart', (evt) => {
    if (solved || !goal) return;
    for (const pair of evt.pairs) {
      const other = pair.bodyA === goal ? pair.bodyB : pair.bodyB === goal ? pair.bodyA : null;
      if (other && !other.isStatic) {
        solved = true;
      }
    }
  });

  // Step.
  for (let tick = 0; tick < TICKS; tick++) {
    Engine.update(engine, TIMESTEP_MS);
    if (solved && solvedAtTick === null) solvedAtTick = tick;
  }

  // Snapshot only user-placed bodies, in insertion order (NOT iteration order
  // of allBodies, which can shift if Matter reorders internally).
  const snapshot = trackedBodies.map((b, i) => ({
    i,
    label: b.label,
    x: round4(b.position.x),
    y: round4(b.position.y),
    a: round4(b.angle),
    vx: round4(b.velocity.x),
    vy: round4(b.velocity.y),
    va: round4(b.angularVelocity),
  }));

  return { snapshot, solved, solvedAtTick };
}

function round4(n) {
  // Round to 4 decimals, but normalize -0 to 0 so the hash is stable.
  const r = Math.round(n * 10000) / 10000;
  return Object.is(r, -0) ? 0 : r;
}

function hashResult(result) {
  return createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

// ---------- scenario ----------
// A handcrafted G1-flavored scenario: ball on a ramp, line of dominoes, bumper
// near the bottom, goal sensor in the bottom-right.
function scenarioG1() {
  const placements = [
    { id: 'p0', userId: 'u_ramp',  type: 'ramp_r',  x: 120, y: 240, rotation: 0, ts: 1 },
    { id: 'p1', userId: 'u_ball',  type: 'ball',    x: 90,  y: 200, rotation: 0, ts: 2 },
    { id: 'p2', userId: 'a_d1',    type: 'domino',  x: 260, y: 1140, rotation: 0, ts: 3 },
    { id: 'p3', userId: 'b_d2',    type: 'domino',  x: 320, y: 1140, rotation: 0, ts: 3 },
    { id: 'p4', userId: 'c_d3',    type: 'domino',  x: 380, y: 1140, rotation: 0, ts: 3 },
    { id: 'p5', userId: 'u_bump',  type: 'bumper',  x: 200, y: 900,  rotation: 0, ts: 4 },
    { id: 'p6', userId: 'u_d4',    type: 'domino',  x: 440, y: 1140, rotation: 0, ts: 5 },
    { id: 'p7', userId: 'u_d5',    type: 'domino',  x: 500, y: 1140, rotation: 0, ts: 6 },
    { id: 'g',  userId: 'system',  type: 'goal',    x: 720, y: 1100, rotation: 0, ts: 0 },
  ];
  return { seed: seedFromString('post_t3_abc123'), placements };
}

// ---------- checks ----------
function check(label, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}${detail ? ` — ${detail}` : ''}`);
  return cond;
}

function main() {
  let ok = true;

  // 1) Same input, 5 runs, identical hash.
  const base = scenarioG1();
  const hashes = [];
  for (let i = 0; i < 5; i++) {
    const result = runSim(base);
    hashes.push(hashResult(result));
  }
  const allEqual = hashes.every((h) => h === hashes[0]);
  ok &= check('same-input runs produce identical hash', allEqual, hashes[0].slice(0, 12));
  if (!allEqual) {
    console.log('  hashes:', hashes.map((h) => h.slice(0, 12)));
  }

  // 2) Reordering ts-tied placements by userId is also deterministic
  //    (because the sort is stable on (ts, userId)). Shuffling the input
  //    array before sort must not change the result.
  const shuffled = {
    ...base,
    placements: [...base.placements].reverse(),
  };
  const reorderedHash = hashResult(runSim(shuffled));
  ok &= check(
    'shuffling input array yields same hash (deterministic sort)',
    reorderedHash === hashes[0],
    reorderedHash.slice(0, 12),
  );

  // 3) Changing the SEED must change the hash (proves RNG is wired into the sim).
  const reseeded = { ...base, seed: base.seed ^ 0xdeadbeef };
  const reseededHash = hashResult(runSim(reseeded));
  ok &= check(
    'changing seed changes hash (RNG affects sim)',
    reseededHash !== hashes[0],
    reseededHash.slice(0, 12),
  );

  // 4) Adding one placement must change the hash (proves placements are simulated).
  const withExtra = {
    ...base,
    placements: [
      ...base.placements,
      { id: 'p8', userId: 'u_extra', type: 'domino', x: 560, y: 1140, rotation: 0, ts: 7 },
    ],
  };
  const extraHash = hashResult(runSim(withExtra));
  ok &= check(
    'adding a placement changes hash',
    extraHash !== hashes[0],
    extraHash.slice(0, 12),
  );

  // 5) "Most influential placement" probe: removing each placement one at a time
  //    and recording outcome flips. Not asserted — printed for the design doc.
  const baseResult = runSim(base);
  console.log(`\n  base solved=${baseResult.solved} at tick=${baseResult.solvedAtTick}`);
  for (const p of base.placements) {
    if (p.type === 'goal') continue;
    const minus = {
      ...base,
      placements: base.placements.filter((q) => q.id !== p.id),
    };
    const r = runSim(minus);
    const flipped = r.solved !== baseResult.solved;
    console.log(
      `    remove ${p.id} (${p.type}, by ${p.userId}): solved=${r.solved}` +
        (flipped ? '  <-- influential' : ''),
    );
  }

  if (!ok) {
    console.error('\nDETERMINISM HARNESS FAILED');
    process.exit(1);
  }
  console.log('\nAll determinism checks passed.');
}

main();
