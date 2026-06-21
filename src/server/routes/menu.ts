// Chain Reaction — moderator menu: manually create today's daily post.

import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const { id } = await createDailyPost();
    return c.json<UiResponse>(
      {
        navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${id}`,
      },
      200,
    );
  } catch (error) {
    console.error('menu/post-create failed', error);
    return c.json<UiResponse>(
      { showToast: 'Failed to create Chain Reaction post' },
      400,
    );
  }
});
