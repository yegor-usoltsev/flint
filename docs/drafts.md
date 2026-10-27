# Draft recovery

Issue titles and descriptions and wiki titles and bodies keep using the existing local drafts. When an open editor's save fails because of a network error, HTTP 429 or a server error, reconnecting or returning online retries it once. Each retry checks the current account, sends its original account with the write, and goes through the existing version checks and per-resource queue.

A conflict still requires a choice in the editor. Drafts restored after a reload, closed editors, validation errors and rolled-back property edits do not replay automatically. Existing local draft keys and formats are unchanged; no service worker, persisted API cache or offline property-write queue is added.

Switching accounts clears the previous account's drafts as before. A stale tab cannot save its text as the newly signed-in user: the server rejects that write, and the tab refreshes its account. This check covers text drafts; property edits, comments, creation and uploads retain their existing behavior. API tokens and clients that omit the optional header remain compatible. The account check needs the updated server: after downgrading, reload open tabs before editing.
