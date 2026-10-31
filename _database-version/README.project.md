# KongGate

A gateway with its own UI, as one desktop program: describe each rule as
"this request comes in → this is what the destination gets", and the program
itself forwards the requests.

Rules ("works") are grouped into **projects**. A client sends a JWT
(`Authorization: Bearer …`); per work, the gateway can:

- **forward** chosen fields of the token to the destination as headers: paste
  a sample token, tick the fields to send;
- **verify** the token against a named secret: signature (HS/RS/ES/PS/EdDSA),
  expiry, issuer, audience;
- **gate** the work on field values (e.g. `role` must be `admin`);
- add a **request id**, and **record** requests in the app's own log: what came
  in, what left for the destination, what it answered and what the client was
  given, to filter by outcome, answer code, method or path and sort by code or
  duration;
- **rate-limit** per client address or per token user, answer browser **CORS**
  checks, and always send fixed **extra headers**.

Only the **database** (PostgreSQL) lives on a server. Every PC runs the app,
gateway included, and every PC connected to the same database has the same
projects, works and secrets.

There is no Kong in it any more: Kong does not run on Windows without Docker,
so the gateway is our own, written in Node.js. The Kong-based version this
grew out of is kept in [_kong-version](_kong-version).

## What is where

| Folder | What |
| --- | --- |
| [desktop/engine](desktop/engine) | The gateway and the API the screens use. Plain Node.js, no Electron in it. |
| [desktop/main.mjs](desktop/main.mjs) | The Electron shell: a window, a tray icon, and the engine in the same process. |
| [frontend](frontend) | The screens (React). Built into static files that the engine serves. |
| [konggate-desktop](konggate-desktop) | The built app, its zip, and the database's compose file. Made by the build. |

## Build the app

```bash
cd desktop
npm install
node build.mjs
```

writes [konggate-desktop](konggate-desktop): `KongGate-win32-x64/KongGate.exe`,
the same folder as a zip, and a `README.txt` saying how to set up the database
and the PCs. The build starts the packaged program once to check that it
comes up.

The frontend's own dependencies must be installed too (`frontend/node_modules`).

## Develop

```bash
cd desktop
npm run engine
```

runs the engine without a window (settings in `desktop/.dev/settings.json`,
created on first save) and serves the last built screens on
http://localhost:8101. For live reload of the screens, run the frontend's dev
server beside it; it passes `/api`, `/try` and `/echo` on to the engine:

```bash
cd frontend
npm run dev
```

and start the engine with the dev server's address, or its API turns that
page's calls away:

```bash
node engine/cli.mjs --dev-origin=http://localhost:5173
```

```bash
cd desktop
npm test
```

exercises the whole engine against a real PostgreSQL
(`KONGGATE_TEST_DB=postgres://user:password@host:port/database`): forwarding,
tokens and every signature algorithm, limits, CORS, timeouts, the log, and two
engines sharing one database.

## How it works

**On each PC** the app listens on two ports:

| Port | Who calls it | What |
| --- | --- | --- |
| 8100 (settable) | clients | the gateway |
| 8101, this PC only | the app's own window | the screens and their API |

**In the database** (tables `kg_projects`, `kg_works`, `kg_secrets`,
`kg_settings`, created by the first app that connects) is everything that is
shared. A counter there goes up with every change; each app asks for it every
two seconds and reloads when it has moved, so a work saved on one PC is live
on the others within a couple of seconds. If the database goes away, a gateway
carries on with what it last read.

**Per PC** (`%APPDATA%\KongGate\settings.json`): where the database is, the
gateway's port, and whether other PCs may call it. The database password is
kept encrypted for the Windows user.

**A request** goes through a work in this order: CORS preflight → token →
request limit → fixed headers → request id → forwarding. A work is chosen by
the longest matching path, compared segment by segment (`/orders` takes
`/orders` and `/orders/7`, not `/orders2`).

**A destination that does not answer** gives the client a 504 or 502 with a
`reason` saying which of these it was: no connection within 5 seconds, no
answer within the work's timeout, connection refused, no route, unknown name,
connection closed, not HTTP, TLS failure. The "try it" dialog explains each.

## Who can do what

Nobody signs in to use the app: everyone sees and edits every project and work.

Only the **administrator** signs in, to manage the **JWT secrets**: add,
replace, delete. Everyone else sees their names and picks one, by name, for a
work to verify tokens against. The app never shows a secret's value again.

The administrator's password is set by whoever opens the sign-in first, and is
kept (as a salted hash) in the database, so it is the same on every PC.

What this does not cover: **every PC holds the database password**, so whoever
has it can open the database directly and read or change anything, secret
values included (they are stored as they were entered). The app's rules are
for people using the app. Hand the database password only to people who may
know the secrets.

## Not there

- WebSocket connections through the gateway.
- Exporting traces to Jaeger or another collector: the log is the app's own,
  in memory (the last 1000 requests), per PC.
- Builds for macOS or Linux. The engine runs anywhere Node.js does
  (`npm run engine`); only the packaging is Windows-only.
