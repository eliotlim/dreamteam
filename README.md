# DreamTeam 🚀

A co-op browser party game about surviving the product development cycle, in the
spirit of [Spaceteam](https://spaceteam.ca/): instructions appear on *your*
screen, but the control they refer to is probably on a *teammate's* screen.
Ship features, squash bugs, and resolve production incidents — by shouting
across the room.

- **Roles**: Product Manager, Designer, Engineer, Ops/SRE — plus a **Spectator**
  dashboard designed for a projector. Roles carry real responsibilities:
  Engineers hold the infra/SRE consoles and get a debugger lens that marks the
  buggy line in code reviews; Ops owns ticket triage — tickets land on ops
  screens first, with an instinct marker on the right call.
- **Three game modes**: **Arcade** (incidents tell you exactly which dials to
  turn and the whole company runs from one dashboard — pure party),
  **Assisted** (goal *and* fix shown immediately, free — but infra is operated
  from the infra map), and **Realism** (only a vague pager alert — read the
  graphs, find the failing component, fix it yourselves; optional runbook
  hints cost 25 points, toggleable in the lobby).
- **Mega mode** (lobby toggle): crowd play for big groups — pool dials are
  duplicated across many screens and dial missions demand a **quorum** ("Set
  Backup Frequency to 3 — 4 of 6 needed"), so the whole room has to move
  together.
- **Team tools**: Kanban board, Slack-lookalike chat (with `ceo-dave`,
  `customer-support`, and `pagerbot`), logs / metrics / traces observability
  view, and a live infrastructure map — switched via a left app navbar on
  desktop, bottom tabs on mobile.
- **Mission variety**: dial-turning Spaceteam missions, **review-and-ship code
  missions**, and **ticket triage** (route customer requests and bug reports to
  the right priority).
- **Code reviews with consequences**: 1000 pre-computed snippets, themed so the
  code always matches the task ("Fix: Invoice totals off by one cent" shows
  invoice code). Tap the broken line to patch it, then hit **🚀 Ship** — some
  builds arrive clean and should ship as-is, and shipping with a missed bug
  crash-loops the backend pods or melts the frontend until someone restarts /
  hotfixes prod.
- **A real load simulation**: RPS demand vs. replica capacity drives
  utilization, latency, and error rates. Incidents are *situations* — a traffic
  spike overloads the backend until you scale out, a dead payments provider
  floods the queue until someone flips the circuit breaker, a memory leak decays
  throughput until you restart the pods, a cache stampede hammers the DB until
  TTLs rebuild warmth, a bad deploy burns error budget until an engineer pushes
  a hotfix, a bot flood floods the edge until the firewall gets strict.
  Recovery is judged by the system actually recovering, not by magic dial
  combos.
- **Disaster recovery, for real**: regional failovers require repointing DNS and
  riding out TTL propagation while the cold standby region scales up; database
  corruption requires restoring from backup — a ~10 s RTO, with data loss (RPO)
  decided by how aggressive your Backup Frequency dial was.
- **A growing platform**: you start with a core stack (DNS → LB → frontend /
  backend → DB, more on higher difficulty); shipping epic features deploys new
  services (cache, queue, payments, search, …) — more infra, more failure modes.
  The architecture view is a live React Flow diagram with per-service stats
  (LB rps, backend load/pods, DB iops, queue depth, cache hit rate) — and every
  node is tappable: an inspector shows live detail stats, renders the controls
  *you* hold for that service, and names the teammate to shout at for the rest.
- **Sprints & a real retro**: escalating difficulty, sprint reviews, and a
  final retro with a team score, a **cause-and-effect Gantt chart** of the
  whole game (shipped bug → pods crashed → who fixed it), and an engine-driven
  **failure-mode analysis** ("recurring failure mode: cache stampedes ×3 —
  write the runbook"). Miss deadlines and team health drains; hit zero and the
  startup runs out of runway.
- **Lobby comforts**: custom startup name, rename yourself after joining, QR
  code + copyable invite link, optional room password (host can set / change /
  remove it), and host handoff — the lobby creator hosts by default and can
  crown a successor.
- **Highly configurable**: presets (Chill / Standard / Chaos) plus per-knob
  control over pacing, deadlines, penalties, incident mix, and bot chatter —
  all host-editable in the lobby.

## Stack

- **Client**: React 19 + Tailwind CSS v4 (Vite), minimalist design system with
  light/dark mode. Fully responsive — phones get a bottom-nav console, desktop
  gets a left app navbar with per-view badges and the React Flow
  (@xyflow/react) architecture diagram.
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
server/room.js     GameRoom Durable Object: the entire game engine + causal event ledger
shared/content.js  Controls, tasks, incidents, infra topology, bots (shared)
shared/snippets.js 1000 pre-computed code-review snippets, themed per mission title
src/               React app: screens, panels, design system (components/ui.jsx)
```
