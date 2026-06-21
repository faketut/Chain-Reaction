<div align="center">

# Chain Reaction

A daily co-op physics puzzle on Reddit. One piece per player. One solve per day.

[![Devvit](https://img.shields.io/badge/Devvit-0.12.24-FF4500?logo=reddit&logoColor=white)](https://developers.reddit.com)
[![Phaser](https://img.shields.io/badge/Phaser-4.1-9B59B6?logo=phaser&logoColor=white)](https://phaser.io)
[![Matter.js](https://img.shields.io/badge/Matter.js-0.20-3A3A3A)](https://brm.io/matter-js/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.12-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Node](https://img.shields.io/badge/Node-≥22.2-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-BSD--3--Clause-555)](#license)

[Play](https://www.reddit.com/r/ChainReaction/) · [Design](docs/design.md) · [Preview](preview/README.md) · [Harness](harness/README.md)

</div>

---

## Overview

Each day, every subreddit running Chain Reaction gets a fresh puzzle: a starting setup, a target, and an empty stage in between. Every Reddit user can place exactly one piece — a domino, balloon, ramp, magnet, or bumper.

When the post locks, a deterministic physics simulation plays back the contraption everyone built together. If the goal is reached, the post is solved, and the player whose placement actually changed the outcome is named MVP in the replay.

<table>
<tr>
<td align="center" width="33%"><a href="devvit-store/screenshots/g1.png"><img src="devvit-store/screenshots/g1.png" alt="G1 — Drop the ball"/></a><br/><sub>G1 · Drop the ball</sub></td>
<td align="center" width="33%"><a href="devvit-store/screenshots/midgame.png"><img src="devvit-store/screenshots/midgame.png" alt="Mid-game"/></a><br/><sub>Mid-game · six contributors</sub></td>
<td align="center" width="33%"><a href="devvit-store/screenshots/g6.png"><img src="devvit-store/screenshots/g6.png" alt="G6 — Floating bridge"/></a><br/><sub>G6 · Floating bridge</sub></td>
</tr>
</table>

## Quick start

```sh
npm install
npm run check             # type-check + determinism harness
npm run preview           # local mock — http://127.0.0.1:5173
npm run dev r/ChainReaction  # live playtest on Reddit
```

Deploy:

```sh
npm run deploy
npx devvit install r/ChainReaction
```

## How it works

```mermaid
flowchart LR
  Browser["WebView<br/>Phaser + Matter.js"]
  API["Hono /api/*"]
  Cron["Scheduler"]
  Redis[("Devvit Redis")]

  Browser -- GET /state --> API
  Browser -- POST /place --> API
  Browser -- GET /leaderboard --> API
  API <--> Redis
  Cron -- daily-create-post --> API
  Cron -- nightly-lock --> API
```

A daily cycle: post created at 14:00 UTC, placement window stays open ~24h, post locks at 07:55 UTC the next day. At lock time the server runs the baseline sim, then leave-one-out re-simulates to identify the MVP, and credits the cross-post leaderboards.

The one-piece-per-user rule is enforced server-side with an atomic `SET NX` claim per `(postId, userId)`. Lock is invoked only by the scheduler — it has no HTTP route.

## Determinism

Every social moment depends on `runSim(seed, placements, template)` returning byte-identical output for identical inputs. The standalone harness in [harness/](harness/README.md) verifies this on every architecture change. `Math.random()`, wall-clock time, and unordered iteration are not allowed inside the sim.

```sh
npm run harness
```

## Layout

```
docs/         design doc, constants, sim contract
src/shared/   constants, types, catalog, goals, sim, rng — used by client and server
src/server/   Hono routes, Redis state, post lifecycle, cron
src/client/   Phaser scenes (Play / Replay / Practice), design tokens
preview/      Vite + mock-API harness for headless local dev
harness/      standalone determinism test (no Devvit, no build step)
devvit-store/ App Directory submission packet + screenshots
devvit.json   menus, triggers, cron, permissions
```

## Scripts

| Script | |
|---|---|
| `npm run check` | Type-check and run the determinism harness. Pre-commit gate. |
| `npm run dev [r/sub]` | Live-reload playtest on a Reddit subreddit. |
| `npm run preview` | Local Vite preview with mocked `/api/*`. |
| `npm run harness` | Determinism harness only. |
| `npm run deploy` | Type-check and upload to Devvit. |
| `npm run launch` | Deploy and publish to the App Directory. |

## License

BSD-3-Clause. See [package.json](package.json#L5).
