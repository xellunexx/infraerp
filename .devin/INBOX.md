<!--
Devin mailbox — drop notes here while the agent is working.

Type or paste anything BELOW this comment block and SAVE the file. On the
agent's next tool call a PostToolUse hook picks it up and injects it as
context — you never touch the chat box, so the running agent is not
interrupted and the note does not wait for the end of the run.

- Content is delivered once, then archived to INBOX.consumed.log and the
  note area is cleared for the next message (this comment stays).
- Latency = until the current tool call finishes (a long `exec` like a
  build or test run delays delivery until it returns).
- If the file holds only this comment, nothing is delivered.
- A global mailbox (INBOX.md next to the hook script) is always watched
  too — it reaches the agent no matter which project is open.
-->
