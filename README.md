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

Where things are kept:

- **Projects and works**: in a file on the PC the app runs on, shared with
  nobody. A project goes to another PC as an exported JSON file.
- **JWT secrets and the administrator's password**: in a shared PostgreSQL
  database if one is named in the settings, so that the administrator enters a
  secret once and every PC verifies tokens with it; in the same local file
  otherwise.

Everything the screens do can also be done from a terminal (`konggate`).

How it got here: it began as Kong in Docker with a web UI
([_kong-version](_kong-version)), became a desktop app with its own gateway and
everything in a shared PostgreSQL ([_database-version](_database-version)),
then moved the projects into a local file because one shared database mixed
everybody's projects together, and kept the database for the secrets only,
because only the administrator knows those.

## What is where

| Folder | What |
| --- | --- |
| [desktop/engine](desktop/engine) | The gateway and the API the screens use. Plain Node.js, no Electron in it; its one package is the PostgreSQL client. |
| [desktop/cli.mjs](desktop/cli.mjs) | The command line: talks to a running KongGate, or is one (`serve`). |
| [desktop/main.mjs](desktop/main.mjs) | The Electron shell: a window, a tray icon, and the engine in the same process. |
| [frontend](frontend) | The screens (React). Built into static files that the engine serves. |
| [konggate-desktop](konggate-desktop) | The built app, its zip, and a compose file for the secrets' database. Made by the build. |
| [CHANGELOG.md](CHANGELOG.md) | Every release: its version, its date, what it changed. |
| [.github](.github) | The workflow that builds and publishes a release. |

## Build the app

```bash
cd desktop
npm install
node node_modules/electron/install.js
node build.mjs
```

writes [konggate-desktop](konggate-desktop): `KongGate-win32-x64/KongGate.exe`
with `konggate.cmd` beside it, the same folder as a zip
(`KongGate-<version>-<date>-win-x64.zip`), and a `README.txt` for whoever gets
it. The version is the one in [desktop/package.json](desktop/package.json); the
date is the day of the build, which the app shows under its version (at the
bottom of the left bar), `konggate help` and `konggate status` print, and the
.exe's Properties > Details give as its product version. The build starts the packaged program once, and asks its
command line for help once, to check that both come up. If KongGate is running
from that folder, only the zip is replaced.

The frontend's own dependencies must be installed too (`frontend/node_modules`).
`node_modules/electron/install.js` downloads Electron itself (`electron.exe`),
which installing its package no longer does; once is enough per Electron
version.

## Release a new version

Releases are built on GitHub's own Windows machines by
[.github/workflows/desktop.yml](.github/workflows/desktop.yml) and published on
the repository's Releases page.

1. Raise `version` in [desktop/package.json](desktop/package.json) (`2.0.0` →
   `2.0.1` for fixes, `2.1.0` for something new, `3.0.0` for a change people
   must adapt to), and add a `## <version> — <date>` section at the top of
   [CHANGELOG.md](CHANGELOG.md) saying what changed. Commit both to `main`.
2. Tag that commit with the version and push the tag:

   ```bash
   git tag v2.0.1
   git push origin v2.0.1
   ```

3. GitHub tests the engine, builds the app, and publishes
   `KongGate-<version>-<date>-win-x64.zip` as the release
   "KongGate <version> (<date>)", with the version's CHANGELOG section as its
   notes. It refuses a tag that is not `v` + the version in package.json, and
   a version CHANGELOG.md says nothing about.

"Run workflow" on the Actions tab, or a pull request that touches the app,
does the same without publishing anything: the zip is kept with the run for
14 days, to try out first.

## Develop

```bash
cd desktop
npm run engine
```

runs the engine without a window (`konggate serve`, its files in
`desktop/.dev`) and serves the frontend's last build on http://localhost:8101.
For live reload of the screens, run the frontend's dev server beside it; it
passes `/api`, `/try` and `/echo` on to the engine:

```bash
cd frontend
npm run dev
```

and start the engine with the dev server's address, or its API turns that
page's calls away:

```bash
node cli.mjs serve --data .dev --dev-origin=http://localhost:5173
```

```bash
cd desktop
npm test
```

exercises the whole engine in a temporary folder: forwarding, tokens and every
signature algorithm, limits, CORS, timeouts, the log, export and import between
two engines, what is on disk after a restart, and the command line. With
`KONGGATE_TEST_DB=postgres://user:password@host:port/database` (a database
nobody uses) it also covers secrets kept in a shared database.

## The command line

`konggate` (`konggate.cmd` in the app's folder; `node cli.mjs` in a checkout)
talks to the KongGate running on the same PC through the API the screens use,
so there is one program holding the data either way.

```text
konggate status | projects | works [project]
konggate export <project> [file]      konggate import <file>
konggate secrets | secrets add <name> | secrets remove <name>
konggate password
konggate port [number] [--local|--public]
konggate database | database set --host <address> … | database off
konggate log [--failed] [--limit 20]
konggate serve                         the gateway without a window
konggate stop                          stop the running KongGate; its ports are freed
```

`konggate help` lists the options. Passwords and secret values are typed
without being shown, or read from `KONGGATE_ADMIN_PASSWORD`,
`KONGGATE_DB_PASSWORD` and `KONGGATE_SECRET_VALUE` for scripts. A running
KongGate is found through `running.json` in its data folder.

## How it works

**The app listens on two ports:**

| Port | Who calls it | What |
| --- | --- | --- |
| 8100 (set on the Settings page) | clients | the gateway |
| 8101, this PC only (the next free one if taken) | the app's own window, the command line | the screens and their API |

A gateway port that another program holds is reported in the app, with a link
to the setting; the gateway does not start until a free one is chosen.

**Closing and quitting.** The window's close button asks whether to keep the
gateway running in the background (the app stays in the tray, its port stays
taken) or to quit; the answer can be remembered and is a setting. Quitting, by
the tray menu, Ctrl+Q, that answer or `konggate stop`, stops the engine and
ends the program with `app.exit`: `app.quit` asked for from inside Electron's
own quitting does nothing, which once left the program behind without a window.

**On disk** (`%APPDATA%\KongGate`):

| File | What |
| --- | --- |
| `data.json` | projects and works; without a database, also the secrets and the administrator's password (as a salted hash) |
| `settings.json` | the gateway's port, whether other PCs may call it, what closing the window does, the database connection |
| `konggate.log` | errors |

Local secrets' values and the database password are encrypted for the Windows
user before they are written.

**In the database** (tables `kg_secrets` and `kg_settings`, created by the
first app that connects): the secrets and the administrator's password, and a
counter that goes up with every change. Each app asks for it every three
seconds and reads the secrets again when it has moved. With the database out of
reach a gateway carries on with the secrets it last read; if it never read any,
the works that verify tokens let none through.

**A project as a file.** "Eksport" on a project's page saves the project and
its works as `<name>.konggate.json`. "Import" on the projects page adds such a
file as a new project (renamed "name (2)" if the name is taken). A secret is
named in the file, never carried in it: on import the name is matched with a
secret that is already there, or becomes one "without a value" for the
administrator to fill in. The import also says which of the new works answer a
path that an existing work already answers.

**A request** goes through a work in this order: CORS preflight → token →
request limit → fixed headers → request id → forwarding. A work is chosen by
the longest matching path, compared segment by segment (`/orders` takes
`/orders` and `/orders/7`, not `/orders2`).

**CORS** is a browser rule: a web page may call another address only if that
address says it may. With CORS **off** on a work, the gateway says nothing, so a
browser app on another computer (or another port) is blocked, while Postman,
curl and servers are not affected; the browser's preflight is passed on to the
destination untouched, for a destination that handles CORS itself. With CORS
**on**, the gateway answers the preflight itself, before any token check, for
the origins listed (or `*`), and lets the page read its own headers
(`X-Trace-Id`, the request id, `RateLimit-*`).

**A destination that does not answer** gives the client a 504 or 502 with a
`reason` saying which of these it was: no connection within 5 seconds, no
answer within the work's timeout, connection refused, no route, unknown name,
connection closed, not HTTP, TLS failure. The work's "Sinab ko'rish" tab and
the log explain each.

**Trying a work** ("Sinab ko'rish", the second tab of an open work) is an API
client for that work: method, the rest of the path, query parameters, headers,
a body (JSON, text or form fields) and a token (a made-up one for works that
do not verify, or one of your own). The answer is shown with its status, time,
size, headers and body. The request can go **through the gateway**, as a
client's would, or **straight to the work's destination**, on the path the
gateway would use: when the first fails and the second works, the work's
settings are at fault; when both fail, the destination or the network is. The
app itself sends the request (`POST /api/works/<id>/send`), so it carries only
what was asked for. The request is kept per work between visits (never a token
of your own), and can be copied as a `curl` command.

## Who can do what

Nobody signs in to use the app. Only the **administrator** signs in, to manage
the **JWT secrets**: add, replace, delete, and fill in the ones an import
brought by name. Everyone else sees their names and picks one for a work to
verify tokens against. The app never shows a secret's value again.

The administrator's password is set by whoever signs in first: for every PC
when the secrets are in the database, for that PC otherwise.

What this does not cover: the app's rules are for people using the app. Every
PC that uses the database holds its password, and whoever has that password can
read the secrets from the database directly. Likewise someone with the Windows
account can read `data.json`.

## Not there

- WebSocket connections through the gateway.
- Exporting traces to Jaeger or another collector: the log is the app's own,
  in memory (the last 1000 requests).
- Builds for macOS or Linux. The engine runs anywhere Node.js does
  (`node cli.mjs serve`); only the packaging is Windows-only.
