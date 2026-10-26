# Recover a failed Mermaid module import

Evidence: `src/lib/mermaid.ts` caches `import("mermaid")` in the module-level `loading` promise with `??=`. No rejection handler resets it. If the first import fails offline or after a deploy removes the old chunk, later parse/render calls reuse the rejected promise until the page reloads. This is inferred from the code; the failed-chunk browser scenario has not been reproduced yet.

Scope: FLN-1 offline and stale-chunk work (Task 4), separate from avoiding successful diagram rerenders on SSE reconnect. Decide whether to reset a failed import promise, recover through the planned guarded chunk reload, or both. Reproduce an initial offline/stale-chunk failure and verify recovery without losing drafts before changing behavior.
