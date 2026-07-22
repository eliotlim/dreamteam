# DreamTeam 🚀

A co-op browser party game about surviving the product development cycle, in the
spirit of [Spaceteam](https://spaceteam.ca/): instructions appear on *your*
screen, but the control they refer to is probably on a *teammate's* screen.
Ship features, squash bugs, and resolve production incidents — by shouting
across the room.

- **Roles**: Product Manager, Designer, Engineer, Ops/SRE — plus a **Spectator**
  dashboard designed for a projector.
- **Team tools**: Kanban board, Slack-lookalike chat (with `ceo-dave`,
  `customer-support`, and `pagerbot`), logs / metrics / traces observability
  view, and a live infrastructure map.
- **Incidents**: outages, traffic spikes, third-party integration failures,
  queue backlogs, and regional failovers — each degrades the infra map,
  poisons the telemetry, and pages the team.
- **Sprints**: escalating difficulty, sprint reviews, and a final retro with a
  team score. Miss deadlines and team health drains; hit zero and the startup
  runs out of runway.
- **Highly configurable**: presets (Chill / Standard / Chaos) plus per-knob
  control over pacing, deadlines, penalties, incident mix, and bot chatter —
  all host-editable in the lobby.

## Stack

- **Client**: React 19 + Tailwind CSS v4 (Vite), minimalist design system with
  light/dark mode.
- **Server**: Cloudflare Worker serving the SPA, with one SQLite-backed
  **Durable Object per room** for coordination — WebSocket hibernation for
  realtime, alarms for the 1 s game tick, state persisted so rooms survive
  eviction.
- Dev/build glued together by `@cloudflare/vite-plugin` — one dev server runs
  both the SPA and the Worker.

## Develop

```sh
pnpm install
pnpm dev          # http://localhost:5173 — open in several tabs to play solo
```

## Deploy

```sh
pnpm deploy       # vite build && wrangler deploy (needs `wrangler login` once)
```

## Layout

```
server/index.js    Worker entry: room create/join API, WS routing, asset serving
server/room.js     GameRoom Durable Object: the entire game engine
shared/content.js  Controls, tasks, incidents, infra topology, bots (shared)
src/               React app: screens, panels, design system (components/ui.jsx)
```
