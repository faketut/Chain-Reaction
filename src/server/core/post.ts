// Chain Reaction — daily post creation + lock. Called from menus, triggers,
// and scheduler endpoints.

import { reddit, context } from '@devvit/web/server';
import { pickTemplate, GOAL_TEMPLATES } from '../../shared/goals';
import { seedFromString } from '../../shared/rng';
import { runSim } from '../../shared/sim';
import { getMeta, setMeta, getPlacements, setSnapshot, setResult, creditMvp, creditInfluential } from '../state';
import type { PostMeta } from '../../shared/types';

// Day 0 = Jan 1 2026, the hackathon's anchor for template rotation.
const DAY_EPOCH_MS = Date.UTC(2026, 0, 1);
function todayOrdinal(): number {
  return Math.floor((Date.now() - DAY_EPOCH_MS) / 86_400_000);
}

export async function createDailyPost(): Promise<{ id: string; meta: PostMeta }> {
  const subredditName = context.subredditName;
  if (!subredditName) throw new Error('no subreddit in context');

  const day = todayOrdinal();
  const template = pickTemplate(day);
  const post = await reddit.submitCustomPost({
    title: `Chain Reaction · Day ${day + 1}: ${template.prompt}`,
  });

  const meta: PostMeta = {
    postId: post.id,
    templateId: template.id,
    seed: seedFromString(post.id),
    day,
    createdAt: Date.now(),
    lockedAt: null,
  };
  await setMeta(meta);
  return { id: post.id, meta };
}

/**
 * Return existing meta for a post, or create + persist fresh meta using
 * today's template. Used by GET /api/post/:postId/state so playtest reinstalls
 * (which wipe redis but leave the real Reddit post intact) don't 404 on
 * already-existing posts. Safe in production: real posts always go through
 * createDailyPost() first, so this branch only runs for orphans.
 */
export async function ensureMeta(postId: string): Promise<PostMeta> {
  const existing = await getMeta(postId);
  if (existing) return existing;

  const day = todayOrdinal();
  const template = pickTemplate(day);
  if (!template) {
    // Should never happen — pickTemplate always returns a rotation entry. If
    // it ever does, fail loudly rather than persist broken meta.
    throw new Error(`pickTemplate returned no template for day ${day}`);
  }
  const meta: PostMeta = {
    postId,
    templateId: template.id,
    seed: seedFromString(postId),
    day,
    createdAt: Date.now(),
    lockedAt: null,
  };
  await setMeta(meta);
  return meta;
}

/**
 * Lock a post: compute MVP via leave-one-out and persist the result. Returns
 * true if the post was actually locked (was previously open), false if it
 * was already locked or unknown.
 */
export async function lockPost(postId: string): Promise<boolean> {
  const meta = await getMeta(postId);
  if (!meta) return false;
  if (meta.lockedAt !== null) return false;

  const template = GOAL_TEMPLATES.find((t) => t.id === meta.templateId);
  if (!template) return false;

  const placements = await getPlacements(postId);
  const baseline = runSim({ seed: meta.seed, template, placements });

  const influentialIds: string[] = [];
  for (const p of placements) {
    const minus = placements.filter((q) => q.id !== p.id);
    const r = runSim({ seed: meta.seed, template, placements: minus });
    if (r.solved !== baseline.solved) influentialIds.push(p.id);
  }
  const mvpUserId =
    influentialIds.length > 0
      ? placements.find((p) => p.id === influentialIds[0])?.userId ?? null
      : null;

  await setResult(postId, {
    ...baseline,
    mvpUserId,
    influentialPlacementIds: influentialIds,
  });
  await setSnapshot(postId, baseline);
  await setMeta({ ...meta, lockedAt: Date.now() });

  // ---------- leaderboard credit ----------
  // Crediting happens exactly once per post, here at lock time. MVP gets a
  // single point; every influential placement's user also gets a point in
  // the broader 'influential' board. De-duplicate across users so a single
  // contributor with two influential placements still only earns +1.
  if (mvpUserId) {
    try { await creditMvp(mvpUserId); } catch (e) { console.error('creditMvp failed', e); }
  }
  const influentialUserIds = new Set<string>();
  for (const id of influentialIds) {
    const u = placements.find((p) => p.id === id)?.userId;
    if (u) influentialUserIds.add(u);
  }
  for (const u of influentialUserIds) {
    try { await creditInfluential(u); } catch (e) { console.error('creditInfluential failed', e); }
  }

  // ---------- stickied "verdict" comment ----------
  // Post a single mod-stickied comment naming the MVP and the contributor
  // count so the comment thread has a focal point for discussion.
  try {
    await postVerdictComment(postId, {
      solved: baseline.solved,
      mvpUserId,
      contributorCount: new Set(placements.map((p) => p.userId)).size,
    });
  } catch (e) {
    console.error('postVerdictComment failed', e);
  }

  return true;
}

async function postVerdictComment(
  postId: string,
  v: { solved: boolean; mvpUserId: string | null; contributorCount: number },
): Promise<void> {
  let mvpHandle = '';
  if (v.mvpUserId) {
    try {
      const user = await reddit.getUserById(v.mvpUserId as `t2_${string}`);
      if (user?.username) mvpHandle = `u/${user.username}`;
    } catch { /* fall through to anonymous credit */ }
  }

  const lines: string[] = [];
  if (v.solved) {
    lines.push("**Solved!** The chain reaction reached the goal.");
    if (mvpHandle) lines.push(`MVP: ${mvpHandle} — their placement was load-bearing.`);
    else if (v.mvpUserId) lines.push("MVP credited (user could not be resolved).");
  } else {
    lines.push("**Not solved this time** — the ball never reached the goal.");
  }
  lines.push(`Built by **${v.contributorCount}** contributor${v.contributorCount === 1 ? '' : 's'}.`);
  lines.push('');
  lines.push("Tomorrow's puzzle drops at 14:00 UTC. One piece per player — make it count.");

  const comment = await reddit.submitComment({ id: postId as `t3_${string}`, text: lines.join('\n\n') });
  try { await comment.distinguish(true); } catch (e) { console.error('distinguish failed', e); }
}

