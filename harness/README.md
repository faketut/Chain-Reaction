# harness/

The non-negotiable invariant of Chain Reaction: the simulation is deterministic. If this harness goes red, the architecture cannot ship.

[![checks](https://img.shields.io/badge/checks-4%2F4%20passing-2ea44f)](#what-it-checks)
[![runtime](https://img.shields.io/badge/runtime-Node%20%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)

[← README](../README.md)

---

## Run

```sh
cd harness && npm test
# or, from repo root:
npm run check        # type-check + harness, the pre-commit gate
```

Exit `0` means all checks pass. Anything else is a determinism violation.

## Why it exists

Every social moment depends on `runSim(seed, placements, template)` producing the same bytes for the same inputs.

- The client replay must match what the server computed at lock time.
- MVP detection is leave-one-out re-simulation — drop each placement, re-run, see whose removal flips the outcome. Sim drift → wrong player gets the halo.
- The public hash in the post lets anyone verify the result independently.

`Math.random()`, wall-clock time, and unordered iteration over hash maps are forbidden inside the sim path.

## What it checks

| Check | Proves |
|---|---|
| Same input, 5 runs → identical hash | The sim has no hidden state between runs. |
| Shuffled placement array → identical hash | Placements are sorted deterministically by `(ts, userId, id)`. |
| Different seed → different hash | The seeded RNG is actually wired through. |
| Extra placement → different hash | No silent dedup or off-by-one is dropping inputs. |

## Structure

`index.mjs` is deliberately standalone — no Vite, no TS, no Devvit. It re-implements the small slice of the catalog needed to exercise determinism, so the harness stays loadable as plain Node even if the main build is broken.

If you change physics constants in [docs/design.md](../docs/design.md), mirror them here and in [src/shared/sim.ts](../src/shared/sim.ts).
