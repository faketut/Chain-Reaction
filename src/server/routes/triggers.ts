// Chain Reaction — onAppInstall trigger. Creates the first daily post so the
// subreddit has something to play with right after install.

import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const { id } = await createDailyPost();
    const input = await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Chain Reaction post ${id} created in r/${context.subredditName} (trigger: ${input.type})`,
      },
      200,
    );
  } catch (error) {
    console.error('triggers/on-app-install failed', error);
    return c.json<TriggerResponse>(
      { status: 'error', message: 'Failed to create Chain Reaction post' },
      400,
    );
  }
});
