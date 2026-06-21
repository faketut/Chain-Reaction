// Chain Reaction — hand-drawn rendering helpers.
//
// Every body and overlay is drawn with a deterministic per-id wobble so the
// same domino always has the same imperfection. Wobble is purely visual; it
// never touches physics state.
//
// All functions take a Phaser.GameObjects.Graphics target and a `seedId`
// (the placement id) — same id, same wobble, every render.

import Phaser from 'phaser';
import { mulberry32, seedFromString } from '../../shared/rng';
import { COLOR, SKETCH_WOBBLE_PX, STROKE_WIDTH } from './tokens';

export interface SketchOpts {
  stroke?: number;          // hex color
  strokeAlpha?: number;
  fill?: number;            // hex color, omit for outline only
  fillAlpha?: number;
  lineWidth?: number;
  /** 0..1; how far through the draw-in animation we are. 1 = fully drawn. */
  progress?: number;
  /** Skip the hand-drawn corner jitter so the shape is geometrically exact.
   * Used for pieces (like domino) whose readability depends on being a true
   * rectangle — the wobble made them look like skewed parallelograms. */
  crisp?: boolean;
}

function jitter(rng: () => number) {
  return (rng() - 0.5) * 2 * SKETCH_WOBBLE_PX;
}

function rotatePoint(x: number, y: number, cos: number, sin: number) {
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/** Draw a closed polyline with hand-drawn double-stroke and optional fill. */
function strokePoly(
  g: Phaser.GameObjects.Graphics,
  pts: { x: number; y: number }[],
  opts: SketchOpts,
) {
  const stroke = opts.stroke ?? COLOR.graphite;
  const strokeAlpha = opts.strokeAlpha ?? 1;
  const lineWidth = opts.lineWidth ?? STROKE_WIDTH;
  const progress = clamp01(opts.progress ?? 1);

  if (opts.fill !== undefined && progress >= 1) {
    g.fillStyle(opts.fill, opts.fillAlpha ?? 1);
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.closePath();
    g.fillPath();
  }

  // Outline drawn as connected segments so we can stop part-way for the
  // draw-in animation. Two passes with slight offset = hand-drawn look.
  const closed = [...pts, pts[0]!];
  const totalLen = polyLen(closed);
  const targetLen = totalLen * progress;

  for (let pass = 0; pass < 2; pass++) {
    const offset = pass === 0 ? 0 : 0.6;
    g.lineStyle(lineWidth, stroke, strokeAlpha * (pass === 0 ? 1 : 0.5));
    g.beginPath();
    g.moveTo(closed[0]!.x + offset, closed[0]!.y + offset);
    let drawn = 0;
    for (let i = 1; i < closed.length; i++) {
      const a = closed[i - 1]!;
      const b = closed[i]!;
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (drawn + seg <= targetLen) {
        g.lineTo(b.x + offset, b.y + offset);
        drawn += seg;
      } else if (targetLen > drawn) {
        const t = (targetLen - drawn) / seg;
        g.lineTo(a.x + (b.x - a.x) * t + offset, a.y + (b.y - a.y) * t + offset);
        drawn = targetLen;
        break;
      } else {
        break;
      }
    }
    g.strokePath();
  }
}

function polyLen(pts: { x: number; y: number }[]) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) {
    n += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return n;
}

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ---------- public API ----------

export function sketchRect(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
  seedId: string,
  opts: SketchOpts = {},
) {
  const rng = mulberry32(seedFromString(seedId));
  const halfW = w / 2;
  const halfH = h / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const j = () => (opts.crisp ? 0 : jitter(rng));
  const local = [
    { x: -halfW + j(), y: -halfH + j() },
    { x:  halfW + j(), y: -halfH + j() },
    { x:  halfW + j(), y:  halfH + j() },
    { x: -halfW + j(), y:  halfH + j() },
  ];
  const pts = local.map((p) => {
    const r = rotatePoint(p.x, p.y, cos, sin);
    return { x: cx + r.x, y: cy + r.y };
  });
  strokePoly(g, pts, opts);
}

export function sketchCircle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  seedId: string,
  opts: SketchOpts = {},
) {
  const rng = mulberry32(seedFromString(seedId));
  const segs = 18;
  const startAngle = rng() * Math.PI * 2; // hand-drawn circles rarely start at 3 o'clock
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < segs; i++) {
    const a = startAngle + (i / segs) * Math.PI * 2;
    const wob = 1 + (rng() - 0.5) * 0.04;
    pts.push({ x: cx + Math.cos(a) * r * wob, y: cy + Math.sin(a) * r * wob });
  }
  strokePoly(g, pts, opts);
}

export function sketchTriangle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
  mirror: boolean,
  angle: number,
  seedId: string,
  opts: SketchOpts = {},
) {
  const rng = mulberry32(seedFromString(seedId));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local = mirror
    ? [
        { x:  w / 2, y: -h / 2 },
        { x: -w / 2, y:  h / 2 },
        { x:  w / 2, y:  h / 2 },
      ]
    : [
        { x: -w / 2, y: -h / 2 },
        { x:  w / 2, y:  h / 2 },
        { x: -w / 2, y:  h / 2 },
      ];
  const pts = local.map((p) => {
    const j = { x: p.x + jitter(rng), y: p.y + jitter(rng) };
    const r = rotatePoint(j.x, j.y, cos, sin);
    return { x: cx + r.x, y: cy + r.y };
  });
  strokePoly(g, pts, opts);
}

/** Graph-paper grid. Drawn once into a graphics object then cached as texture. */
export function drawGraphPaper(
  g: Phaser.GameObjects.Graphics,
  width: number,
  height: number,
  spacing: number,
) {
  // Major lines every 4 cells, minor every 1 cell. Both very low contrast.
  g.lineStyle(1, COLOR.rule, 0.45);
  for (let x = 0; x <= width; x += spacing) {
    g.lineBetween(x, 0, x, height);
  }
  for (let y = 0; y <= height; y += spacing) {
    g.lineBetween(0, y, width, y);
  }
  g.lineStyle(1, COLOR.rule, 0.85);
  for (let x = 0; x <= width; x += spacing * 4) {
    g.lineBetween(x, 0, x, height);
  }
  for (let y = 0; y <= height; y += spacing * 4) {
    g.lineBetween(0, y, width, y);
  }
}

/** The signature element: a hand-drawn target reticle for goals. */
export function sketchReticle(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  size: number,
  seedId: string,
  opts: { pulse?: number; solved?: boolean } = {},
) {
  const r = size / 2;
  const stroke = opts.solved ? COLOR.seal : COLOR.carmine;
  const pulse = opts.pulse ?? 0;

  // Outer ring
  sketchCircle(g, cx, cy, r * (1 + pulse * 0.06), `${seedId}::outer`, {
    stroke,
    lineWidth: 3,
  });
  // Inner ring
  sketchCircle(g, cx, cy, r * 0.55, `${seedId}::inner`, {
    stroke,
    lineWidth: 2,
  });
  // Center dot
  g.fillStyle(stroke, 1);
  g.fillCircle(cx, cy, 3);
  // Crosshairs — two short ticks each side, hand-jittered
  const rng = mulberry32(seedFromString(`${seedId}::cross`));
  g.lineStyle(2, stroke, 1);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const j1 = jitter(rng) * 0.4;
    const j2 = jitter(rng) * 0.4;
    g.lineBetween(
      cx + dx * (r * 0.7) + j1,
      cy + dy * (r * 0.7) + j2,
      cx + dx * r * 1.05 + j1,
      cy + dy * r * 1.05 + j2,
    );
  }
}
