// Chain Reaction — body renderer. One source of truth for "draw a placement
// in its hand-drawn style" so the static post-state, the ghost preview, the
// MVP highlight, and the live replay all look like the same hand drew them.

import Phaser from 'phaser';
import type { Placement, ObjectType } from '../../shared/types';
import { CATALOG } from '../../shared/catalog';
import { COLOR } from './tokens';
import { sketchRect, sketchCircle, sketchTriangle, sketchReticle, type SketchOpts } from './sketch';

export interface BodyDrawState {
  /** World-space center. */
  x: number;
  y: number;
  /** Radians. */
  angle: number;
  /** Optional vertical velocity from the sim (px/tick). Used by the balloon
   *  renderer to show "ascending" vs "hovering" cues. */
  vy?: number;
}

export interface BodyDrawOpts {
  /** Stroke color override. Default = graphite. */
  stroke?: number;
  /** Stroke alpha override. */
  strokeAlpha?: number;
  /** Add a translucent fill under the stroke. */
  fill?: number;
  fillAlpha?: number;
  /** 0..1 stroke draw-in progress (for the reveal animation). */
  progress?: number;
  /** Highlight ring (for MVP placements / "your piece"). */
  highlight?: 'none' | 'you' | 'mvp';
}

/**
 * Draw any placement onto the given graphics layer at the given pose.
 * Pure draw call — graphics is expected to have been cleared by the caller.
 */
export function drawBody(
  g: Phaser.GameObjects.Graphics,
  pl: Placement,
  pose: BodyDrawState,
  opts: BodyDrawOpts = {},
) {
  const stroke = opts.stroke ?? COLOR.graphite;
  // With exactOptionalPropertyTypes, the receiving SketchOpts treats omitted
  // keys differently from explicit `undefined`. Build baseOpts by spreading
  // only the keys the caller actually provided.
  const baseOpts: SketchOpts = { stroke };
  if (opts.strokeAlpha !== undefined) baseOpts.strokeAlpha = opts.strokeAlpha;
  if (opts.fill !== undefined) baseOpts.fill = opts.fill;
  if (opts.fillAlpha !== undefined) baseOpts.fillAlpha = opts.fillAlpha;
  if (opts.progress !== undefined) baseOpts.progress = opts.progress;

  if (pl.type === 'goal') {
    sketchReticle(g, pose.x, pose.y, 56, pl.id, { solved: opts.stroke === COLOR.seal });
    return;
  }

  const spec = CATALOG[pl.type as ObjectType];

  switch (spec.shape.kind) {
    case 'rect':
      // Domino and block must read as true rectangles (their identity depends
      // on right angles). Skip the hand-drawn jitter for both.
      sketchRect(
        g,
        pose.x,
        pose.y,
        spec.shape.w,
        spec.shape.h,
        pose.angle,
        pl.id,
        (pl.type === 'domino' || pl.type === 'block')
          ? { ...baseOpts, crisp: true }
          : baseOpts,
      );
      break;
    case 'circle':
      sketchCircle(g, pose.x, pose.y, spec.shape.r, pl.id, baseOpts);
      break;
    case 'rightTri':
      sketchTriangle(
        g,
        pose.x,
        pose.y,
        spec.shape.w,
        spec.shape.h,
        spec.shape.mirror,
        pose.angle,
        pl.id,
        baseOpts,
      );
      break;
  }

  // Balloon: same physics shape as ball (circle), but visually distinct so
  // players can tell them apart at a glance. Two cues: a knot + tether at
  // the bottom, and a tiny inner highlight crescent. Plus an upward arrow
  // hint communicating "this floats".
  if (pl.type === 'balloon' && spec.shape.kind === 'circle') {
    drawBalloonOverlay(g, pose.x, pose.y, spec.shape.r, baseOpts.stroke ?? COLOR.graphite, opts.strokeAlpha ?? 1, pose.vy ?? -1);
  }

  // Block: same crisp rectangle as domino, but with diagonal hatch lines so
  // players can tell at a glance "this one is the immovable wall/bridge,
  // not the toppling domino".
  if (pl.type === 'block' && spec.shape.kind === 'rect') {
    drawBlockHatch(g, pose.x, pose.y, spec.shape.w, spec.shape.h, pose.angle, baseOpts.stroke ?? COLOR.graphite, opts.strokeAlpha ?? 1);
  }

  // Fan: draw the wind cone so the user can see WHERE the wind will blow.
  // We deliberately render the cone shorter than the sim's `range` (200px)
  // because at full length it overwhelms the play area. The shape still
  // communicates direction and influence-area precisely; the cone is a
  // hint, not a measuring stick.
  if (pl.type === 'fan' && spec.customForce?.kind === 'fan') {
    const visualRange = spec.customForce.range * 0.45;
    drawFanCone(g, pose.x, pose.y, pose.angle, visualRange, spec.customForce.halfAngleRad, opts.strokeAlpha ?? 1);
  }

  if (opts.highlight === 'you') {
    g.lineStyle(1.5, COLOR.carmine, 0.9);
    g.strokeCircle(pose.x, pose.y, bodyRadius(pl) + 6);
  } else if (opts.highlight === 'mvp') {
    g.lineStyle(2, COLOR.ochre, 1);
    g.strokeCircle(pose.x, pose.y, bodyRadius(pl) + 8);
  }
}

/** Conservative radius for highlight rings. */
export function bodyRadius(pl: Placement): number {
  if (pl.type === 'goal') return 30;
  const spec = CATALOG[pl.type as ObjectType];
  switch (spec.shape.kind) {
    case 'rect':
      return Math.hypot(spec.shape.w, spec.shape.h) / 2;
    case 'circle':
      return spec.shape.r;
    case 'rightTri':
      return Math.hypot(spec.shape.w, spec.shape.h) / 2;
  }
}

/**
 * Hand-drawn balloon decorations: a knot triangle + tether at the bottom, a
 * crescent highlight inside, and three small upward chevrons hinting at
 * buoyancy. Drawn on TOP of the base circle so the circle is the actual
 * collider footprint.
 */
function drawBalloonOverlay(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  r: number,
  stroke: number,
  alpha: number,
  vy: number,
) {
  // Knot: small downward-pointing triangle just below the circle.
  g.lineStyle(1.8, stroke, 0.95 * alpha);
  g.beginPath();
  g.moveTo(x - 4, y + r);
  g.lineTo(x + 4, y + r);
  g.lineTo(x,     y + r + 6);
  g.closePath();
  g.strokePath();
  // Tether: short wavy line trailing down from the knot.
  g.lineStyle(1, stroke, 0.7 * alpha);
  g.beginPath();
  g.moveTo(x, y + r + 6);
  g.lineTo(x - 2, y + r + 12);
  g.lineTo(x + 1, y + r + 18);
  g.lineTo(x - 1, y + r + 22);
  g.strokePath();
  // Inner highlight crescent — a short arc in the upper-left of the circle
  // that reads as "shiny round thing", not a solid ball.
  g.lineStyle(1.2, stroke, 0.55 * alpha);
  const arcSteps = 8;
  const startTheta = Math.PI * 1.15; // upper-left
  const endTheta   = Math.PI * 1.45;
  let prev = {
    x: x + Math.cos(startTheta) * (r - 5),
    y: y + Math.sin(startTheta) * (r - 5),
  };
  for (let i = 1; i <= arcSteps; i++) {
    const t = startTheta + ((endTheta - startTheta) * i) / arcSteps;
    const next = {
      x: x + Math.cos(t) * (r - 5),
      y: y + Math.sin(t) * (r - 5),
    };
    g.lineBetween(prev.x, prev.y, next.x, next.y);
    prev = next;
  }
  // Buoyancy cue. The balloon has two visual states driven by its current
  // vertical velocity:
  //   • Ascending  (|vy| large) → three carmine upward chevrons ("↑↑↑").
  //   • Hovering   (|vy| ≈ 0)   → two short carmine tick marks on either side
  //                              of the balloon's equator, like a level
  //                              indicator ("—    —").
  // We cross-fade between the two so a balloon settling into hover smoothly
  // loses its chevrons and gains its level marks — turning the invisible
  // hover-balance physics into a legible visual event.
  const speed = Math.abs(vy);
  const ascentAlpha = Math.min(1, speed / 1.2);          // 0 at rest, 1 at terminal
  const hoverAlpha = 1 - Math.min(1, speed / 0.15);      // 1 at rest, 0 by |vy|=0.15
  if (ascentAlpha > 0.05) {
    g.lineStyle(1.3, COLOR.carmine, 0.6 * alpha * ascentAlpha);
    for (let i = 0; i < 3; i++) {
      const cy = y - r - 8 - i * 6;
      const w = 5 - i * 0.8;
      g.lineBetween(x - w, cy + 2, x, cy);
      g.lineBetween(x + w, cy + 2, x, cy);
    }
  }
  if (hoverAlpha > 0.05) {
    g.lineStyle(1.6, COLOR.carmine, 0.85 * alpha * hoverAlpha);
    g.lineBetween(x - r - 8, y, x - r - 2, y);
    g.lineBetween(x + r + 2, y, x + r + 8, y);
  }
}

/**
 * Hatched diagonal lines inside a block's rectangle. The hatches communicate
 * "solid / structural" — architectural drawings use the same convention for
 * walls and load-bearing elements. Lines are clipped to the rectangle and
 * rotated with the block's angle so they always read as parallel.
 */
function drawBlockHatch(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angle: number,
  stroke: number,
  alpha: number,
) {
  const halfW = w / 2 - 2;
  const halfH = h / 2 - 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toWorld = (lx: number, ly: number) => ({
    x: cx + lx * cos - ly * sin,
    y: cy + lx * sin + ly * cos,
  });

  // Diagonal hatches in local space, then rotated. Spacing of 8px works well
  // for the 48×24 default and scales reasonably for any rotation.
  g.lineStyle(1, stroke, alpha * 0.5);
  const spacing = 8;
  // Diagonal lines go from top-left toward bottom-right (slope -1 in local
  // coords). We parameterize by their intercept on the local x-axis (where
  // local y = 0): the line is (lx, lx + b) for b ∈ [-(halfW+halfH), halfW+halfH].
  const minB = -(halfW + halfH);
  const maxB =  (halfW + halfH);
  for (let b = Math.ceil(minB / spacing) * spacing; b <= maxB; b += spacing) {
    // Clip the infinite line (lx, lx + b) to the rect [-halfW,halfW] × [-halfH,halfH].
    // Intersections with x = ±halfW: y = ±halfW + b
    // Intersections with y = ±halfH: x = ±halfH - b
    const candidates: { lx: number; ly: number }[] = [];
    const tryAdd = (lx: number, ly: number) => {
      if (lx >= -halfW - 0.01 && lx <= halfW + 0.01 && ly >= -halfH - 0.01 && ly <= halfH + 0.01) {
        candidates.push({ lx, ly });
      }
    };
    tryAdd(-halfW, -halfW + b);
    tryAdd( halfW,  halfW + b);
    tryAdd(-halfH - b, -halfH);
    tryAdd( halfH - b,  halfH);
    if (candidates.length < 2) continue;
    const a = toWorld(candidates[0]!.lx, candidates[0]!.ly);
    const c = toWorld(candidates[1]!.lx, candidates[1]!.ly);
    g.lineBetween(a.x, a.y, c.x, c.y);
  }
}

/**
 * Hand-drawn wind cone for the fan. Two dashed edges + a far-arc, plus three
 * chevron tick marks pointing outward so the direction is unmistakable even
 * at thumbnail size.
 */
function drawFanCone(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  angle: number,
  range: number,
  halfAngle: number,
  alpha: number,
) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Perpendicular to direction, used for chevron wings.
  const px = -dy;
  const py = dx;

  // Cone starts just past the fan rect's front edge so it doesn't bleed into
  // the body. Fan rect half-width is 32, so begin at 34.
  const near = 34;
  const far = range;

  // Rotate forward direction by ±halfAngle to get the two cone edges.
  // Standard 2D rotation: (x', y') = (x·cosθ - y·sinθ, x·sinθ + y·cosθ).
  const cosH = Math.cos(halfAngle);
  const sinH = Math.sin(halfAngle);
  const eAx = dx * cosH - dy * sinH; // +halfAngle
  const eAy = dx * sinH + dy * cosH;
  const eBx = dx * cosH + dy * sinH; // -halfAngle
  const eBy = -dx * sinH + dy * cosH;

  // Near-edge endpoints on both rays.
  const aN = { x: x + eAx * near, y: y + eAy * near };
  const bN = { x: x + eBx * near, y: y + eBy * near };
  // Far-edge endpoints on both rays.
  const aF = { x: x + eAx * far,  y: y + eAy * far  };
  const bF = { x: x + eBx * far,  y: y + eBy * far  };

  // Two dashed edges, carmine, low alpha so they read as "influence area"
  // rather than physical geometry.
  g.lineStyle(1.2, COLOR.carmine, 0.45 * alpha);
  drawDashed(g, aN.x, aN.y, aF.x, aF.y, 6, 5);
  drawDashed(g, bN.x, bN.y, bF.x, bF.y, 6, 5);

  // Far-edge arc (the "front" of the cone). Sweep from -halfAngle to
  // +halfAngle around the forward direction so we always take the short way.
  const arcSteps = 10;
  g.lineStyle(1.2, COLOR.carmine, 0.35 * alpha);
  let prev = { x: x + eBx * far, y: y + eBy * far }; // -halfAngle endpoint
  for (let i = 1; i <= arcSteps; i++) {
    const t = -halfAngle + (2 * halfAngle * i) / arcSteps;
    const cx = Math.cos(t);
    const sx = Math.sin(t);
    // Rotate (cx, sx) by `angle` so the arc orbits the fan's facing.
    const wx = cx * dx - sx * dy;
    const wy = cx * dy + sx * dx;
    const next = { x: x + wx * far, y: y + wy * far };
    g.lineBetween(prev.x, prev.y, next.x, next.y);
    prev = next;
  }

  // Three small chevrons along the centerline, pointing outward.
  // Sized small (8px wings) and fading further from the fan to suggest decay.
  g.lineStyle(1.5, COLOR.carmine, 0.7 * alpha);
  const positions = [0.35, 0.6, 0.85];
  const wing = 6;
  for (const t of positions) {
    const r = near + (far - near) * t;
    const tipX = x + dx * r;
    const tipY = y + dy * r;
    const backX = tipX - dx * 10;
    const backY = tipY - dy * 10;
    // Two short lines forming a ">" pointing in the wind direction.
    g.lineBetween(backX + px * wing, backY + py * wing, tipX, tipY);
    g.lineBetween(backX - px * wing, backY - py * wing, tipX, tipY);
  }
}

function drawDashed(
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
    const s = drawn;
    const e = Math.min(drawn + dash, len);
    g.lineBetween(x1 + nx * s, y1 + ny * s, x1 + nx * e, y1 + ny * e);
    drawn = e + gap;
  }
}
