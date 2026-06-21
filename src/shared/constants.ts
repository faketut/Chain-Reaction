// Chain Reaction — world constants. Single source of truth.
// Must match docs/design.md exactly. Imported by both client and server.

export const WORLD_W = 800;
export const WORLD_H = 1200;

export const GRAVITY_Y = 1.0;
export const TIMESTEP_MS = 1000 / 60;

export const MAX_TICKS_PER_PLACEMENT = 600;
export const SETTLE_VELOCITY_EPS = 0.05;
export const SETTLE_TICKS = 60;
export const MAX_PLACEMENTS_PER_POST = 200;
export const PLAYAREA_PAD = 32;

// Goal target bookkeeping.
// GOAL_SENSOR_SIZE_PX  — the square sensor body matter creates for each goal.
// GOAL_PROXIMITY_BLOCK_PX  — base no-place radius (server adds half a sensor
// to forgive users by ~24px before refusing the placement).
export const GOAL_SENSOR_SIZE_PX = 48;
export const GOAL_PROXIMITY_BLOCK_PX = 24;
export const GOAL_PROXIMITY_BUFFER_PX = GOAL_SENSOR_SIZE_PX / 2;

// "Two balls within N ticks" win condition (G5) — 120 ticks ≈ 2 seconds
// at 60 fps. Tune in one place so design + sim agree.
export const TWO_BALL_TIMING_WINDOW_TICKS = 120;
