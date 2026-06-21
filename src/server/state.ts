// Chain Reaction — Redis state shape + CRUD. Server-only.
//
// Key conventions (per post):
//   post:{postId}:meta        Hash    PostMeta JSON
//   post:{postId}:placements  List    Placement JSON, append-only, ordered
//   post:{postId}:users       Set     userIds who have placed (for one-per-user)
//   post:{postId}:snapshot    String  last SimResult JSON
//   post:{postId}:result      String  PostResult JSON, set at lock time
//
// All values are JSON for simplicity. Migrate to msgpack later if needed.

import { redis } from '@devvit/web/server';
import type { Placement, PostMeta, PostResult, SimResult } from '../shared/types';

const k = {
  meta: (id: string) => `post:${id}:meta`,
  placements: (id: string) => `post:${id}:placements`,
  users: (id: string) => `post:${id}:users`,
  snapshot: (id: string) => `post:${id}:snapshot`,
  result: (id: string) => `post:${id}:result`,
};

export async function getMeta(postId: string): Promise<PostMeta | null> {
  const s = await redis.get(k.meta(postId));
  return s ? (JSON.parse(s) as PostMeta) : null;
}

export async function setMeta(meta: PostMeta): Promise<void> {
  await redis.set(k.meta(meta.postId), JSON.stringify(meta));
}

export async function getPlacements(postId: string): Promise<Placement[]> {
  // Sorted set: score = insertion index (monotonic), member = placement JSON.
  // zRange returns ZMember[] (member + score). We sort by score asc.
  const members = await redis.zRange(k.placements(postId), 0, -1);
  return members.map((m) => JSON.parse(m.member) as Placement);
}

export async function appendPlacement(postId: string, p: Placement): Promise<void> {
  // Use current size as insertion score so order is stable.
  const score = await redis.zCard(k.placements(postId));
  await redis.zAdd(k.placements(postId), { member: JSON.stringify(p), score });
}

export async function hasUserPlaced(postId: string, userId: string): Promise<boolean> {
  // Hash field membership: presence of the field marks "placed".
  const v = await redis.hGet(k.users(postId), userId);
  return v != null;
}

export async function markUserPlaced(postId: string, userId: string): Promise<void> {
  await redis.hSet(k.users(postId), { [userId]: '1' });
}

/**
 * Atomically claim a user's per-post placement slot, or release one when a
 * subsequent validation step rejects the placement.
 *
 * Returns true exactly once per (postId, userId): the first successful claim.
 * Subsequent calls (or concurrent racing requests) return false so we cannot
 * double-place. Implemented via SET-NX on a dedicated key — Devvit Redis
 * supports `set(key, val, { nx: true })` which returns null when the key
 * already exists.
 *
 * Pass `{ release: true }` to roll the claim back if a later check fails
 * (overlap, oversized payload, etc.) so the user can retry with valid input.
 * Releasing is best-effort; if it fails the user simply waits until the post
 * locks.
 */
export async function claimUserPlacement(
  postId: string,
  userId: string,
  opts: { release?: boolean } = {},
): Promise<boolean> {
  const key = `${k.users(postId)}:${userId}`;
  if (opts.release) {
    try {
      await redis.del(key);
    } catch (e) {
      console.error('claimUserPlacement release failed', e);
    }
    // Also clear the legacy hash field so getPlacements consumers stay in
    // sync. Failure here is non-fatal for the same reason.
    try {
      await redis.hDel(k.users(postId), [userId]);
    } catch {
      // ignore
    }
    return true;
  }
  // set returns the stored value on success, null when the key already exists
  // because of the `nx: true` guard.
  const ok = await redis.set(key, '1', { nx: true });
  if (ok === null || ok === undefined) return false;
  // Mirror into the legacy hash so existing callers (preview, reporting)
  // still see "placed". The hash write is non-atomic but it only matters as a
  // hint — the per-key claim above is the authoritative one.
  try {
    await redis.hSet(k.users(postId), { [userId]: '1' });
  } catch (e) {
    console.error('claimUserPlacement mirror-write failed', e);
  }
  return true;
}

export async function getSnapshot(postId: string): Promise<SimResult | null> {
  const s = await redis.get(k.snapshot(postId));
  return s ? (JSON.parse(s) as SimResult) : null;
}

export async function setSnapshot(postId: string, snap: SimResult): Promise<void> {
  await redis.set(k.snapshot(postId), JSON.stringify(snap));
}

export async function getResult(postId: string): Promise<PostResult | null> {
  const s = await redis.get(k.result(postId));
  return s ? (JSON.parse(s) as PostResult) : null;
}

export async function setResult(postId: string, r: PostResult): Promise<void> {
  await redis.set(k.result(postId), JSON.stringify(r));
}

export async function placementCount(postId: string): Promise<number> {
  return await redis.zCard(k.placements(postId));
}

// ---------- leaderboard ----------
//
// Two global sorted-sets (not per-post) ranking users across all daily posts:
//   leaderboard:mvp          score = how many days the user was MVP
//   leaderboard:influential  score = how many of the user's placements
//                                    changed solved/unsolved at lock time
// Both are updated atomically at lockPost() time. Members are userIds.

const kLeaderboardMvp = 'leaderboard:mvp';
const kLeaderboardInf = 'leaderboard:influential';

export async function creditMvp(userId: string): Promise<void> {
  await redis.zIncrBy(kLeaderboardMvp, userId, 1);
}

export async function creditInfluential(userId: string): Promise<void> {
  await redis.zIncrBy(kLeaderboardInf, userId, 1);
}

export type LeaderboardEntry = { userId: string; score: number };

export async function getLeaderboard(
  kind: 'mvp' | 'influential',
  limit = 10,
): Promise<LeaderboardEntry[]> {
  const key = kind === 'mvp' ? kLeaderboardMvp : kLeaderboardInf;
  // `by: 'rank'` + `reverse: true` returns highest-score first.
  const rows = await redis.zRange(key, 0, limit - 1, { by: 'rank', reverse: true });
  return rows.map((r) => ({ userId: r.member, score: r.score }));
}
