// Chain Reaction — server endpoints (Hono). Mounts at /api/*.
//
// Endpoints:
//   GET  /api/post/:postId/state      → current placements, snapshot, hasPlaced
//   POST /api/post/:postId/place      → { type, x, y, rotation } body
//   GET  /api/leaderboard             → cross-post top users
//
// Note: there is intentionally no public /lock endpoint. Locking only happens
// via the nightly-lock scheduler task (src/server/routes/cron.ts) which
// invokes core/post.lockPost() directly. That keeps the MVP/leaderboard
// computation tamper-proof.
//
// Validation: server is the source of truth. Reject anything weird.

import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import {
  MAX_PLACEMENTS_PER_POST,
  PLAYAREA_PAD,
  WORLD_W,
  WORLD_H,
  GOAL_PROXIMITY_BLOCK_PX,
  GOAL_PROXIMITY_BUFFER_PX,
} from '../shared/constants';
import { CATALOG, aabb } from '../shared/catalog';
import { GOAL_TEMPLATES } from '../shared/goals';
import { runSim } from '../shared/sim';
import type { Placement, ObjectType, GoalTemplate } from '../shared/types';
import {
  getMeta,
  getPlacements,
  hasUserPlaced,
  claimUserPlacement,
  appendPlacement,
  setSnapshot,
  getSnapshot,
  placementCount,
  getResult,
  getLeaderboard,
} from './state';
import { ensureMeta } from './core/post';

export const app = new Hono();

app.get('/api/post/:postId/state', async (c) => {
  // Trust the Devvit context's postId over the URL param. The client may
  // send a fallback like 'dev_local_post' when no global is injected; the
  // server always knows which real post is being viewed.
  const postId = context.postId ?? c.req.param('postId');
  const userId = context.userId ?? 'anon';

  // Self-heal: if redis lost meta but the Reddit post still exists (e.g.
  // playtest reinstall wiped redis), create meta on the fly so the puzzle
  // becomes playable instead of 404ing.
  let meta = await getMeta(postId);
  if (!meta && context.postId) {
    try {
      meta = await ensureMeta(context.postId);
    } catch (e) {
      console.error('ensureMeta failed', e);
    }
  }

  const [placements, snapshot, alreadyPlaced, result] = await Promise.all([
    getPlacements(postId),
    getSnapshot(postId),
    hasUserPlaced(postId, userId),
    getResult(postId),
  ]);

  if (!meta) return c.json({ error: 'post not initialized' }, 404);

  return c.json({
    meta,
    template: templateById(meta.templateId),
    placements,
    snapshot,
    result, // null until locked
    you: { userId, hasPlaced: alreadyPlaced },
    locked: meta.lockedAt !== null,
  });
});

app.post('/api/post/:postId/place', async (c) => {
  const postId = context.postId ?? c.req.param('postId');
  const userId = context.userId;
  if (!userId) return c.json({ error: 'must be logged in' }, 401);

  const body = await c.req.json<{
    type: ObjectType;
    x: number;
    y: number;
    rotation: number;
  }>();

  // 0) Post must exist + not be locked.
  const meta = await getMeta(postId);
  if (!meta) return c.json({ error: 'post not initialized' }, 404);
  if (meta.lockedAt !== null) return c.json({ error: 'post is locked' }, 409);

  // 1) One-per-user — atomic claim. The Redis SET-NX returns true exactly
  // once per user; subsequent attempts (same user, even racing in parallel)
  // return false so we can never double-place. We rollback the claim only
  // if a later validation step rejects the placement.
  const claimed = await claimUserPlacement(postId, userId);
  if (!claimed) {
    return c.json({ error: 'you have already placed today' }, 409);
  }

  // From here on, if we abort with a 4xx we must release the claim so the
  // user can retry with a valid input. (We do NOT release on 5xx because we
  // don't know if Redis state is consistent.)
  const releaseClaim = () => claimUserPlacement(postId, userId, { release: true });

  // 2) Type must be a placeable user object (no goals).
  if (!(body.type in CATALOG)) {
    await releaseClaim();
    return c.json({ error: 'invalid type' }, 400);
  }
  const spec = CATALOG[body.type];

  // 3) Bounds + rotation snap.
  const x = clamp(body.x, PLAYAREA_PAD, WORLD_W - PLAYAREA_PAD);
  const y = clamp(body.y, PLAYAREA_PAD, WORLD_H - PLAYAREA_PAD);
  const rotation = snapRotation(body.rotation, spec.rotationSnapDeg, !!spec.cardinalOnly);

  // 4) Cap.
  const count = await placementCount(postId);
  if (count >= MAX_PLACEMENTS_PER_POST) {
    await releaseClaim();
    return c.json({ error: 'post full' }, 409);
  }

  // 5) Overlap with existing bodies (server-side check; cheap, AABB-only).
  const template = templateById(meta.templateId);
  if (!template) {
    await releaseClaim();
    return c.json({ error: 'unknown template' }, 500);
  }

  const existing = await getPlacements(postId);
  const all = [...template.startPlacements, ...existing];
  const newBox = aabb(spec, x, y);
  for (const other of all) {
    const otherSpec = other.type === 'goal'
      ? null
      : CATALOG[other.type as ObjectType];
    // Goals: enforce a no-place-near-goal radius, not strict AABB overlap.
    if (other.type === 'goal') {
      const dx = x - other.x;
      const dy = y - other.y;
      if (Math.hypot(dx, dy) < GOAL_PROXIMITY_BLOCK_PX + GOAL_PROXIMITY_BUFFER_PX) {
        await releaseClaim();
        return c.json({ error: 'too close to goal' }, 409);
      }
      continue;
    }
    if (!otherSpec) continue;
    const otherBox = aabb(otherSpec, other.x, other.y);
    if (boxesOverlap(newBox, otherBox)) {
      await releaseClaim();
      return c.json({ error: 'overlaps existing object' }, 409);
    }
  }

  // 6) Persist placement.
  const placement: Placement = {
    id: `${postId}-${count}`,
    userId,
    type: body.type,
    x,
    y,
    rotation,
    ts: Date.now(),
  };
  await appendPlacement(postId, placement);

  // 7) Run authoritative sim and cache snapshot.
  const placements = [...existing, placement];
  const snap = runSim({ seed: meta.seed, template, placements });
  await setSnapshot(postId, snap);

  return c.json({ placement, snapshot: snap });
});

// Cross-post leaderboard. Read-only — credits are written exclusively in
// lockPost() (invoked by the nightly-lock scheduler task). `kind` selects
// which board; `limit` is clamped to keep the response small. Anonymous to
// read.
app.get('/api/leaderboard', async (c) => {
  const kindParam = c.req.query('kind');
  const kind: 'mvp' | 'influential' = kindParam === 'influential' ? 'influential' : 'mvp';
  const rawLimit = Number.parseInt(c.req.query('limit') ?? '10', 10);
  const limit = Number.isFinite(rawLimit) ? clamp(rawLimit, 1, 50) : 10;
  const entries = await getLeaderboard(kind, limit);
  return c.json({ kind, entries });
});

function templateById(id: string): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((t) => t.id === id);
}

function clamp(n: number, lo: number, hi: number) {
  return n < lo ? lo : n > hi ? hi : n;
}

function boxesOverlap(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function snapRotation(rad: number, snapDeg: number, cardinalOnly: boolean): number {
  if (snapDeg === 0) return 0;
  if (cardinalOnly) {
    const cards = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    let best = cards[0]!;
    let bestD = Infinity;
    for (const c of cards) {
      const d = Math.abs(angleDelta(rad, c));
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  const step = (snapDeg * Math.PI) / 180;
  return Math.round(rad / step) * step;
}

function angleDelta(a: number, b: number) {
  const d = ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI;
  return d;
}
