// Chain Reaction — the 5 launch goal templates. Must match docs/design.md.

import type { GoalTemplate, Placement } from './types';

function p(
  id: string,
  type: Placement['type'],
  x: number,
  y: number,
  rotation = 0,
): Placement {
  return { id, userId: 'system', type, x, y, rotation, ts: 0 };
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    id: 'G1',
    prompt: 'Get the ball to the bottom-right corner.',
    startPlacements: [
      p('g1_ramp', 'ramp_r', 120, 180),
      p('g1_ball', 'ball', 120, 120),
      p('g1_goal', 'goal', 720, 1000),
    ],
  },
  {
    id: 'G2',
    prompt: 'Tip the first domino from across the room.',
    startPlacements: [
      p('g2_seed_domino', 'domino', 680, 980),
      p('g2_ramp', 'ramp_l', 120, 240),
      p('g2_ball', 'ball', 120, 200),
      // Sensor backed against the seed domino; win = sensorEnteredBy seed_domino.
      p('g2_goal', 'goal', 700, 980),
    ],
    winCondition: { kind: 'bodyRotatedPast', bodyLabel: 'domino:g2_seed_domino', radians: Math.PI / 3 },
  },
  {
    id: 'G3',
    prompt: 'Get the ball over the wall.',
    startPlacements: [
      p('g3_ball', 'ball', 120, 980),
      // The wall is a static "domino" rotated into a tall slab via tooling at sim time;
      // for simplicity at scaffold time we represent it as a tall, thin domino.
      p('g3_wall', 'domino', 400, 720),
      p('g3_goal', 'goal', 680, 980),
    ],
  },
  {
    id: 'G4',
    prompt: 'Route the ball through three checkpoints, then to the goal.',
    startPlacements: [
      p('g4_ball', 'ball', 120, 200),
      p('g4_cp1', 'goal', 250, 540),
      p('g4_cp2', 'goal', 550, 540),
      p('g4_cp3', 'goal', 400, 780),
      p('g4_goal', 'goal', 400, 980),
    ],
    winCondition: {
      kind: 'allOfInOrder',
      sensorLabels: ['goal:g4_cp1', 'goal:g4_cp2', 'goal:g4_cp3'],
      finalLabel: 'goal:g4_goal',
    },
  },
  {
    id: 'G5',
    prompt: 'Both balls must reach the goal within 2 seconds of each other.',
    startPlacements: [
      p('g5_ball_a', 'ball', 120, 200),
      p('g5_ball_b', 'ball', 680, 200),
      p('g5_goal', 'goal', 400, 980),
    ],
    // Sim implements this check directly; encoded here as a simple sensor entry
    // with a special multi-entry rule resolved in sim.ts.
    winCondition: { kind: 'sensorEnteredBy', labelPrefix: 'ball:' },
  },
  {
    // G6 "Floating Bridge" — first level that hinges on the balloon-domino
    // hover trick. The intended solution: a hovering platform (2 balloons +
    // 1 horizontal domino) fills the gap so the ball rolls across both
    // pillars and off the right edge into the goal. Stacking static blocks
    // in the gap is an acceptable brute-force alt-solution.
    //
    // Geometry (world is 800 × 1200, palette occupies y > 1068):
    //   ramp_r at (170, 300)  → ball gets rightward velocity off the slope
    //   left pillar: blocks at (170, 480/504/528)  → top edge y ≈ 468
    //   right pillar: blocks at (310, 504/528)     → top edge y ≈ 492
    //     gap between pillars in x: 194 → 286, ~92 px wide
    //     pillar tops only differ by 24 px → ball rolls across smoothly
    //   goal at (720, 1020) — bottom-right, above the palette
    id: 'G6',
    prompt: 'Bridge the gap with a floating platform — try two balloons under a domino.',
    startPlacements: [
      // Ball + ramp launcher at top of left pillar.
      p('g6_ball', 'ball', 150, 240),
      p('g6_ramp', 'ramp_r', 170, 432),
      // Left pillar (3 blocks tall).
      p('g6_pL1', 'block', 170, 528),
      p('g6_pL2', 'block', 170, 504),
      p('g6_pL3', 'block', 170, 480),
      // Right pillar (2 blocks tall, slightly lower so ball lands easily).
      p('g6_pR1', 'block', 310, 528),
      p('g6_pR2', 'block', 310, 504),
      // Goal at the bottom right, above the palette strip (palette covers y > 1068).
      p('g6_goal', 'goal', 720, 1020),
    ],
  },
];

/**
 * Day → template selection. Clean rotation through every published template
 * so each puzzle gets equal airtime over a 6-day cycle. Deterministic and
 * idempotent — same day always returns the same template, with no hidden
 * difficulty heuristics that surprise returning players.
 */
export function pickTemplate(dayOrdinal: number): GoalTemplate {
  // Stable order — keep new templates at the end to preserve historical days.
  const rotation = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'];
  // `%` on a negative ordinal can return negative; mod normalisation keeps it
  // safe if the epoch is ever moved or clock-skewed.
  const idx = ((dayOrdinal % rotation.length) + rotation.length) % rotation.length;
  const id = rotation[idx]!;
  const t = GOAL_TEMPLATES.find((g) => g.id === id);
  if (!t) throw new Error(`unknown template ${id}`);
  return t;
}

/**
 * Stable per-day seed for any future procedural variation (object jitter,
 * checkpoint shuffling, etc). Today the sim still seeds off the postId so
 * leaderboards stay deterministic; this is reserved for v2 generator work.
 */
export function dailySeed(dayOrdinal: number): number {
  // Mulberry-style scramble — keeps neighbouring days far apart in the
  // output space so visual feel changes meaningfully day-over-day.
  let h = (dayOrdinal | 0) + 0x6d2b79f5;
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return (h ^ (h >>> 14)) >>> 0;
}
