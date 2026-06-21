// Chain Reaction — object catalog. Single source of truth for physics props.
// Must match docs/design.md.

import type { ObjectType } from './types';

export interface ObjectSpec {
  type: ObjectType;
  /** Collision shape descriptor. Sim consumes this; client renders sprite by type. */
  shape:
    | { kind: 'rect'; w: number; h: number }
    | { kind: 'circle'; r: number }
    | { kind: 'rightTri'; w: number; h: number; mirror: boolean };
  isStatic: boolean;
  isSensor: boolean;
  density?: number;
  friction?: number;
  /**
   * Air-drag coefficient. Optional. Matter's default is 0.01. We bump it on
   * balloons so the "2 balloons + 1 domino hover" assembly damps out its
   * vertical oscillation and settles instead of bouncing for seconds.
   */
  frictionAir?: number;
  restitution?: number;
  /**
   * Per-tick custom forces evaluated by the sim runner. The sim looks at
   * `customForce` and applies the named behavior; do not eval anything.
   */
  customForce?:
    | { kind: 'buoyancy'; force: number; terminalVy: number } // balloon
    | { kind: 'fan'; range: number; halfAngleRad: number; force: number }
    | { kind: 'magnet'; range: number; force: number; targetLabelPrefix: string };
  /** Allowed user-rotation snapping in degrees. 0 = no rotation. */
  rotationSnapDeg: number;
  /** Allowed cardinal directions for `fan` etc. Empty = any. */
  cardinalOnly?: boolean;
  /** Optional chamfer radius (rect bodies only). Rounded corners help things
   *  like domino chains — a sharp 90° corner against a flat face tends to
   *  catch and stall; a tiny chamfer lets contact slide into a smooth roll. */
  cornerRadius?: number;
}

export const CATALOG: Record<ObjectType, ObjectSpec> = {
  domino: {
    type: 'domino',
    shape: { kind: 'rect', w: 12, h: 64 },
    isStatic: false,
    isSensor: false,
    density: 0.001,
    friction: 0.3,
    restitution: 0.05,
    // Small chamfer makes corner-on-face hits roll into the next domino
    // instead of jamming at a stalled 90° contact. Area loss is < 0.5% so
    // mass and visual footprint are effectively unchanged.
    cornerRadius: 1.5,
    rotationSnapDeg: 15,
  },
  // Structural piece: static rectangle. Use as wall / bridge / platform.
  // Distinct from domino (which is dynamic and will topple under gravity).
  block: {
    type: 'block',
    shape: { kind: 'rect', w: 48, h: 24 },
    isStatic: true,
    isSensor: false,
    friction: 0.4,
    restitution: 0.2,
    // Quarter-turn snap so blocks stay axis-aligned and read as architecture
    // (vertical pillars / horizontal beams), not as a tilted slab.
    rotationSnapDeg: 90,
  },
  ramp_l: {
    type: 'ramp_l',
    shape: { kind: 'rightTri', w: 96, h: 48, mirror: true },
    isStatic: true,
    isSensor: false,
    friction: 0.2,
    restitution: 0,
    rotationSnapDeg: 15,
  },
  ramp_r: {
    type: 'ramp_r',
    shape: { kind: 'rightTri', w: 96, h: 48, mirror: false },
    isStatic: true,
    isSensor: false,
    friction: 0.2,
    restitution: 0,
    rotationSnapDeg: 15,
  },
  ball: {
    type: 'ball',
    shape: { kind: 'circle', r: 16 },
    isStatic: false,
    isSensor: false,
    // Mass = π·r²·density = π·256·0.0008 ≈ 0.64. Deliberately lighter than
    // one domino (0.77) so a falling ball can no longer steamroll through a
    // carefully-built balloon platform (2 balloons + 1 domino ≈ 1.77, ~3x
    // the ball's mass — ball bounces off instead of demolishing).
    density: 0.0008,
    friction: 0.05,
    restitution: 0.4,
    rotationSnapDeg: 0,
  },
  balloon: {
    type: 'balloon',
    shape: { kind: 'circle', r: 20 },
    isStatic: false,
    isSensor: false,
    // Mass = π·r²·density = π·400·0.0004 ≈ 0.503.
    //
    // ---- Hover-balance design ----
    // The signature interaction is "2 balloons + 1 domino hovers in place".
    // We tune buoyancy.force so the system is mathematically zero-net:
    //
    //   2 · m_balloon · buoyancy = (2 · m_balloon + m_domino) · gravity
    //   buoyancy = (1 + m_domino / (2 · m_balloon)) · gravity
    //   buoyancy = (1 + 0.768 / 1.006) · 0.001 ≈ 0.001764
    //
    // Consequences:
    //   1 balloon free        → net up ≈ 0.000384/mass (still rises, terminal -2)
    //   1 balloon + 1 domino  → net DOWN (sinks slowly)
    //   2 balloons + 1 domino → net ≈ 0 (HOVERS, the design hook)
    //   3 balloons + 1 domino → net up (rises)
    //
    // For the hover to actually visually settle, we also need:
    //   • friction > 0 so the dome-shaped balloons don't squirt out from
    //     under the domino sideways the moment it lands on them.
    //   • frictionAir > matter default so vertical oscillation damps in ~1s
    //     instead of bouncing for many seconds.
    density: 0.0004,
    friction: 0.5,
    frictionAir: 0.04,
    restitution: 0.2,
    // Buoyancy MUST exceed gravity to actually float. Matter applies gravity
    // each tick as mass × gravity.y × gravity.scale = mass × 1.0 × 0.001
    // = mass × 0.001. Using force=0.001764 makes 2 balloons exactly cancel
    // out 1 domino's weight (see hover-balance math above).
    customForce: { kind: 'buoyancy', force: 0.001764, terminalVy: -2 },
    rotationSnapDeg: 0,
  },
  fan: {
    type: 'fan',
    shape: { kind: 'rect', w: 64, h: 32 },
    isStatic: true,
    isSensor: false,
    friction: 0,
    restitution: 0,
    customForce: {
      kind: 'fan',
      range: 200,
      halfAngleRad: (25 * Math.PI) / 180,
      force: 0.002,
    },
    rotationSnapDeg: 15,
    cardinalOnly: true,
  },
  magnet: {
    type: 'magnet',
    shape: { kind: 'circle', r: 24 },
    isStatic: true,
    isSensor: false,
    customForce: {
      kind: 'magnet',
      range: 150,
      force: 0.0008,
      targetLabelPrefix: 'ball:',
    },
    rotationSnapDeg: 0,
  },
  bumper: {
    type: 'bumper',
    shape: { kind: 'circle', r: 20 },
    isStatic: true,
    isSensor: false,
    friction: 0,
    restitution: 1.2,
    rotationSnapDeg: 0,
  },
};

/** Axis-aligned bounding box (in world px) for overlap checks at placement time. */
export function aabb(spec: ObjectSpec, x: number, y: number) {
  switch (spec.shape.kind) {
    case 'rect':
      return { x0: x - spec.shape.w / 2, y0: y - spec.shape.h / 2, x1: x + spec.shape.w / 2, y1: y + spec.shape.h / 2 };
    case 'circle':
      return { x0: x - spec.shape.r, y0: y - spec.shape.r, x1: x + spec.shape.r, y1: y + spec.shape.r };
    case 'rightTri':
      return { x0: x - spec.shape.w / 2, y0: y - spec.shape.h / 2, x1: x + spec.shape.w / 2, y1: y + spec.shape.h / 2 };
  }
}
