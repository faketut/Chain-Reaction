# preview/

Headless local dev for the Chain Reaction client. Runs the Phaser app in your browser with a mocked Devvit API — no Reddit account, no upload, no playtest sub required.

[![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Phaser](https://img.shields.io/badge/Phaser-4.1-9B59B6?logo=phaser&logoColor=white)](https://phaser.io)

[← README](../README.md)

---

## Run

```sh
npm run preview        # from repo root
```

Open <http://127.0.0.1:5173>.

## How it works

`mockApi.ts` overrides `window.fetch` before the client code is imported, so every call to `/api/state`, `/api/place`, `/api/leaderboard` is served from an in-memory store. The shared sim, goals, RNG, and types are imported straight from `src/shared/` — so the preview tests the exact physics the live app ships with.

## Modes

Append a URL fragment to switch into a scenario:

| URL | |
|---|---|
| `/` | empty G1, ready to place |
| `/#g1` … `/#g6` | any template, empty |
| `/#midgame` | post with several placements |
| `/#placed` | current "user" has already placed |
| `/#locked` | locked post with replay + MVP |
| `/#bridge` | G6 floating-bridge, pre-built |

## When to use it

For Phaser scene work, tweens, visual tokens, and reproducing bugs without burning a daily playtest. For anything touching Devvit auth, scheduler, or real Redis, use `npm run dev r/ChainReaction` instead.
