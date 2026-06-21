// Chain Reaction — typed fetch wrappers for /api/*.

import type { Placement, SimResult, PostMeta, GoalTemplate, PostResult, ObjectType } from '../shared/types';

// All client → server calls go through this wrapper so we have one place to
// enforce a sane timeout (mobile users on flaky connections shouldn't see an
// infinite spinner) and to parse server-style error bodies consistently.
const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(input, { ...rest, signal: ctl.signal });
  } catch (e) {
    clearTimeout(t);
    if ((e as { name?: string }).name === 'AbortError') {
      throw new ApiError(`request timed out after ${timeoutMs}ms`, 0);
    }
    throw new ApiError(`network error: ${(e as Error).message}`, 0);
  }
  clearTimeout(t);
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new ApiError(body.error ?? `${input} ${res.status}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new ApiError(`malformed JSON from ${input}: ${(e as Error).message}`, res.status);
  }
}

export interface PostStateResponse {
  meta: PostMeta;
  template: GoalTemplate;
  placements: Placement[];
  snapshot: SimResult | null;
  result: PostResult | null;
  you: { userId: string; hasPlaced: boolean };
  locked: boolean;
}

export async function getPostState(postId: string): Promise<PostStateResponse> {
  return request<PostStateResponse>(`/api/post/${encodeURIComponent(postId)}/state`);
}

export interface PlaceResponse {
  placement: Placement;
  snapshot: SimResult;
}

export async function placeObject(
  postId: string,
  body: { type: ObjectType; x: number; y: number; rotation: number },
): Promise<PlaceResponse> {
  return request<PlaceResponse>(`/api/post/${encodeURIComponent(postId)}/place`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export type LeaderboardKind = 'mvp' | 'influential';
export interface LeaderboardEntry { userId: string; score: number }
export interface LeaderboardResponse {
  kind: LeaderboardKind;
  entries: LeaderboardEntry[];
}

export async function getLeaderboard(
  kind: LeaderboardKind = 'mvp',
  limit = 5,
): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>(`/api/leaderboard?kind=${kind}&limit=${limit}`);
}
