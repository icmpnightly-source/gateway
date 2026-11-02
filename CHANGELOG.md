# Changelog

Each release of the KongGate desktop app, newest first, with the day it was
released. A release is made on GitHub's Releases page with a tag
`v<version>`; see [Release a new version](README.md#release-a-new-version).
The app itself shows the day its build was made, under its version.

## Unreleased

When this is released, give it its version and date (`## 2.1.0 — <date>`).

- **Plugins.** What the gateway does with a work's requests is now a list of
  plugins on the work's new "Plaginlar" tab, in the order they run, each
  switched on or off. The token, CORS, rate limit, fixed headers and request
  id are built-in plugins, and new ones join them: API keys, user name and
  password (HTTP Basic), IP allow and deny lists, request and answer changes
  (headers and query parameters), a size limit for request bodies, and a
  cache for GET answers.
- **Plugins of your own:** `.mjs` files in the plugins folder
  (`%APPDATA%\KongGate\plugins`), added to works like the built-in ones. The
  folder's `README.txt` shows how to write one; Settings > Plugins lists them,
  opens the folder and reads it again.
- A work using a plugin the computer does not have answers 500 while that
  plugin is switched on, rather than letting everyone in.
- Works and project files from 2.0.0 are turned into plugins by themselves;
  the data file as it was is kept as `data.json.before-plugins`. A project
  exported now (format 2) cannot be imported by 2.0.0.
- `konggate plugins` lists the plugins; `konggate works` shows each work's.

## 2.0.0 — 2026-10-31

The first release of KongGate as a desktop app for Windows: the gateway and its
screens in one program, with nothing else to install (no Docker, no Node.js).

- Projects and works are kept in a file on each PC, and go to another PC as an
  exported JSON file.
- JWT secrets and the administrator's password are kept in a shared PostgreSQL
  database if one is set, so every PC verifies tokens with them; in the same
  local file otherwise.
- The `konggate` command line does from a terminal what the screens do.
- The app says its version and the day it was built: at the bottom of the
  left bar, in `konggate help` and `konggate status`, in the .exe's
  properties and in the zip's name.

Before this, KongGate was Kong in Docker with a web UI (version 1.0, kept in
the `_kong-version` folder).
