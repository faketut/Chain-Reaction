// Chain Reaction — scheduler endpoints. Wired in devvit.json:
//   daily-create-post  → 14:00 UTC, creates today's puzzle
//   nightly-lock       → 07:55 UTC (next day), locks yesterday's post

import { Hono } from 'hono';
import { redis } from '@devvit/web/server';
import { createDailyPost, lockPost } from '../core/post';

export const cron = new Hono();

// Sorted set: score = creation timestamp, member = post id.
// Most recent ids appear with highest scores.
const RECENT_KEY = 'cr:recent_post_ids';
const RETAIN_COUNT = 14;

cron.post('/daily-create-post', async (c) => {
  try {
    const { id } = await createDailyPost();
    await redis.zAdd(RECENT_KEY, { member: id, score: Date.now() });
    // Trim to keep only the highest-scoring (most recent) RETAIN_COUNT.
    const total = await redis.zCard(RECENT_KEY);
    if (total > RETAIN_COUNT) {
      // Remove the oldest (rank 0..total-RETAIN_COUNT-1).
      await redis.zRemRangeByRank(RECENT_KEY, 0, total - RETAIN_COUNT - 1);
    }
    return c.json({ status: 'success', postId: id }, 200);
  } catch (error) {
    console.error('cron/daily-create-post failed', error);
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});

cron.post('/nightly-lock', async (c) => {
  try {
    // Sweep the recent window. lockPost is a no-op if already locked.
    const members = await redis.zRange(RECENT_KEY, 0, -1);
    const locked: string[] = [];
    for (const m of members) {
      const wasLocked = await lockPost(m.member);
      if (wasLocked) locked.push(m.member);
    }
    return c.json({ status: 'success', locked }, 200);
  } catch (error) {
    console.error('cron/nightly-lock failed', error);
    return c.json({ status: 'error', message: String(error) }, 500);
  }
});
