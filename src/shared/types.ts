// Chain Reaction — shared types. Imported by client and server.

export type ObjectType =
  | 'domino'
  | 'block'
  | 'ramp_l'
  | 'ramp_r'
  | 'ball'
  | 'balloon'
  | 'fan'
  | 'magnet'
  | 'bumper';

/** Goal sensors are placed by the template, never by users. */
export type SystemType = 'goal';

export type AnyType = ObjectType | SystemType;

export interface Placement {
  /** Stable id, e.g. `t2_xxxx-<seq>` or a uuid. */
  id: string;
  /** Reddit user id (e.g. `t2_xxxx`) or `system` for template objects. */
  userId: string;
  type: AnyType;
  x: number;
  y: number;
  /** Radians. 0 for types that don't accept rotation. */
  rotation: number;
  /** Server-assigned epoch ms. Sort key. */
  ts: number;
}

export interface GoalTemplate {
  id: string;
  prompt: string;
  /** Pre-placed immutable bodies (start objects + goal sensor). */
  startPlacements: Placement[];
  /**
   * Optional: custom win condition beyond "any dynamic body enters the goal sensor".
   * Strings are matched in the sim. Keep it small; no eval.
   */
  winCondition?:
    | { kind: 'sensorEntered' } // default
    | { kind: 'sensorEnteredBy'; labelPrefix: string }
    | { kind: 'bodyRotatedPast'; bodyLabel: string; radians: number }
    | { kind: 'allOfInOrder'; sensorLabels: string[]; finalLabel: string };
}

export interface SnapshotBody {
  i: number;        // insertion index (stable across runs)
  label: string;
  x: number;        // rounded to 4 decimals
  y: number;
  a: number;
  vx: number;
  vy: number;
  va: number;
}

export interface SimResult {
  snapshot: SnapshotBody[];
  solved: boolean;
  solvedAtTick: number | null;
}

export interface PostMeta {
  postId: string;
  templateId: string;
  seed: number;
  day: number;          // ordinal day for the subreddit
  createdAt: number;    // epoch ms
  lockedAt: number | null;
}

export interface PostResult extends SimResult {
  mvpUserId: string | null;
  /** Per-user placement counts that were "influential" (would flip outcome if removed). */
  influentialPlacementIds: string[];
}
