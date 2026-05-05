# frontend

Next.js application — the chat UI for Chorus.

**Stack** (see [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §3.6):

- Next.js (App Router) + TypeScript.
- Tailwind CSS + shadcn/ui for components.
- `react-query` for REST data; thin custom WebSocket client for the live message stream.

Messages render sorted by the server-assigned monotonic `id`, never by local timestamp.

Scaffolding lands in #5. No application code yet.
