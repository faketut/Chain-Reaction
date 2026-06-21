// Chain Reaction — server entry. Bootstraps Hono with /api/* (gameplay) and
// /internal/* (devvit menu, triggers, scheduler). Devvit Web compiles this to
// dist/server/index.cjs per devvit.json.

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { cron } from './routes/cron';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/triggers', triggers);
internal.route('/cron', cron);

// The api Hono app already registers paths with the `/api/...` prefix, so we
// mount it at root instead of under `/api` to avoid double-prefixing.
app.route('/', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
