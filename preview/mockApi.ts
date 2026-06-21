// Chain Reaction — preview-only mock of /api/* endpoints.
// Overrides window.fetch BEFORE the client code is imported. The client uses
// vanilla fetch + relative URLs so this is sufficient to make PlayScene and
// ReplayScene work without a server.

import type {
  Placement,
  PostMeta,
  PostResult,
  SimResult,
  ObjectType,
} from '../src/shared/types';
import { GOAL_TEMPLATES } from '../src/shared/goals';
import { runSim } from '../src/shared/sim';
import { seedFromString } from '../src/shared/rng';

export type Mode =
  | 'empty'
  | 'midgame'
  | 'placed'
  | 'locked'
  | 'g1'
  | 'g2'
  | 'g3'
  | 'g4'
  | 'g5'
  | 'g6'
  | 'bridge';

const TEMPLATE_MODES = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'] as const;
type TemplateMode = (typeof TEMPLATE_MODES)[number];
function isTemplateMode(m: Mode): m is TemplateMode {
  return (TEMPLATE_MODES as readonly string[]).includes(m);
}

interface MockState {
  meta: PostMeta;
  placements: Placement[];
  snapshot: SimResult | null;
  result: PostResult | null;
  youUserId: string;
  youHasPlaced: boolean;
}

function newMeta(mode: Mode): PostMeta {
  // gN modes load template GN directly; legacy modes pick a "nice-looking" one.
  const templateId = isTemplateMode(mode)
    ? mode.toUpperCase()
    : mode === 'midgame'
      ? 'G2'
      : mode === 'bridge'
        ? 'G1'
        : 'G1';
  return {
    postId: `preview_${mode}`,
    templateId,
    seed: seedFromString(`preview_${mode}`),
    day: 3,
    createdAt: Date.now(),
    lockedAt: mode === 'locked' ? Date.now() : null,
  };
}

function userPlacements(meta: PostMeta, mode: Mode): Placement[] {
  if (mode === 'empty' || isTemplateMode(mode)) return [];
  if (mode === 'bridge') {
    // Demo: two vertical blocks as pillars + one horizontal block on top as
    // a bridge + a ball above the bridge. Blocks are STATIC (the structural
    // piece), so unlike the previous domino-based version this setup actually
    // holds together when the sim runs.
    //
    // Geometry (block is 48×24, world is 800×1200):
    //   pillar A: center (380, 900) rot π/2 → 24w × 48h, top at y=876
    //   pillar B: center (520, 900) rot π/2 → 24w × 48h, top at y=876
    //   bridge:   center (450, 864) rot 0   → 48w × 24h, bottom at y=876
    //   ball:     (450, 560) → falls straight down onto bridge center.
    return [
      placement('br_pillarA', 'demo_user', 'block', 380, 900, Math.PI / 2, meta.postId),
      placement('br_pillarB', 'demo_user', 'block', 520, 900, Math.PI / 2, meta.postId),
      placement('br_bridge',  'demo_user', 'block', 450, 864, 0,           meta.postId),
      placement('br_ball',    'demo_user', 'ball',  450, 560, 0,           meta.postId),
    ];
  }
  if (mode === 'placed') {
    return [
      placement('mid_a', 'mock_u_self',  'domino', 320, 1020, 0, meta.postId),
    ];
  }
  // midgame + locked share a richer set
  return [
    placement('mid_a', 'mock_u_alice',  'domino', 320, 1020, 0, meta.postId),
    placement('mid_b', 'mock_u_bob',    'domino', 360, 1020, 0, meta.postId),
    placement('mid_c', 'mock_u_carol',  'domino', 400, 1020, 0, meta.postId),
    placement('mid_d', 'mock_u_dan',    'domino', 440, 1020, 0, meta.postId),
    placement('mid_e', 'mock_u_eve',    'bumper', 260, 760,  0, meta.postId),
    placement('mid_f', 'mock_u_frank',  'ramp_r', 200, 320,  0, meta.postId),
    placement('mid_g', 'mock_u_gwen',   'ball',   200, 280,  0, meta.postId),
    placement('mid_h', 'mock_u_self',   'magnet', 540, 700,  0, meta.postId),
    // Fan pointing right (angle = 0) so the wind cone is visible across the
    // mid playfield. Lets us eyeball the new direction overlay on #midgame.
    placement('mid_i', 'mock_u_henry',  'fan',    160, 600,  0, meta.postId),
  ];
}

function placement(
  id: string,
  userId: string,
  type: ObjectType,
  x: number,
  y: number,
  rotation: number,
  postId: string,
): Placement {
  return { id: `${postId}-${id}`, userId, type, x, y, rotation, ts: 1 };
}

function buildState(mode: Mode): MockState {
  const meta = newMeta(mode);
  const template = GOAL_TEMPLATES.find((t) => t.id === meta.templateId)!;
  const placements = userPlacements(meta, mode);
  const snapshot = runSim({ seed: meta.seed, template, placements });

  let result: PostResult | null = null;
  if (mode === 'locked') {
    const ids = placements.map((p) => p.id);
    result = {
      ...snapshot,
      mvpUserId: placements[0]?.userId ?? null,
      influentialPlacementIds: ids.length > 0 ? [ids[Math.floor(ids.length / 2)]!] : [],
    };
  }

  const youUserId = 'mock_u_self';
  const youHasPlaced = mode === 'placed' || mode === 'locked';
  return { meta, placements, snapshot, result, youUserId, youHasPlaced };
}

let current: MockState = buildState(readModeFromHash());

function readModeFromHash(): Mode {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  const all = ['empty', 'midgame', 'placed', 'locked', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'bridge'] as const;
  return (all as readonly string[]).includes(h) ? (h as Mode) : 'empty';
}

export function installMockFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url;

    // GET /api/post/:postId/state
    const stateMatch = url.match(/^\/api\/post\/([^/]+)\/state$/);
    if (stateMatch && (!init || (init.method ?? 'GET') === 'GET')) {
      const template = GOAL_TEMPLATES.find((t) => t.id === current.meta.templateId)!;
      const body = {
        meta: current.meta,
        template,
        placements: current.placements,
        snapshot: current.snapshot,
        result: current.result,
        you: { userId: current.youUserId, hasPlaced: current.youHasPlaced },
        locked: current.meta.lockedAt !== null,
      };
      return jsonResponse(200, body);
    }

    // POST /api/post/:postId/place
    const placeMatch = url.match(/^\/api\/post\/([^/]+)\/place$/);
    if (placeMatch && init?.method === 'POST') {
      if (current.youHasPlaced) return jsonResponse(409, { error: 'you have already placed today' });
      if (current.meta.lockedAt !== null) return jsonResponse(409, { error: 'post is locked' });

      const body = JSON.parse((init.body as string) ?? '{}') as {
        type: ObjectType;
        x: number;
        y: number;
        rotation: number;
      };

      const newPl: Placement = {
        id: `${current.meta.postId}-self`,
        userId: current.youUserId,
        type: body.type,
        x: body.x,
        y: body.y,
        rotation: body.rotation,
        ts: Date.now(),
      };
      current.placements.push(newPl);
      current.youHasPlaced = true;

      const template = GOAL_TEMPLATES.find((t) => t.id === current.meta.templateId)!;
      current.snapshot = runSim({ seed: current.meta.seed, template, placements: current.placements });
      return jsonResponse(200, { placement: newPl, snapshot: current.snapshot });
    }

    // GET /api/leaderboard?kind=mvp&limit=N — preview stub with mock standings.
    if (url.startsWith('/api/leaderboard') && (!init || (init.method ?? 'GET') === 'GET')) {
      const u = new URL(url, 'http://preview.local');
      const kind = u.searchParams.get('kind') === 'influential' ? 'influential' : 'mvp';
      const limit = Math.max(1, Math.min(50, Number.parseInt(u.searchParams.get('limit') ?? '10', 10) || 10));
      const entries = [
        { userId: 'mock_u_alice', score: 12 },
        { userId: 'mock_u_bob',   score: 9 },
        { userId: 'mock_u_carol', score: 7 },
        { userId: 'mock_u_dan',   score: 5 },
        { userId: 'mock_u_eve',   score: 4 },
        { userId: 'mock_u_frank', score: 3 },
        { userId: 'mock_u_self',  score: 2 },
      ].slice(0, limit);
      return jsonResponse(200, { kind, entries });
    }

    return original(input as RequestInfo, init);
  };

  // Reload state when the hash changes (preview-only convenience).
  window.addEventListener('hashchange', () => {
    current = buildState(readModeFromHash());
    window.location.reload();
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function highlightActiveMode() {
  const hash = (typeof window !== 'undefined' ? window.location.hash : '') || '#empty';
  document.querySelectorAll<HTMLAnchorElement>('#modeswitch a').forEach((a) => {
    a.classList.toggle('on', a.getAttribute('href') === hash);
  });
}
