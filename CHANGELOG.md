# Changelog

Each release of the KongGate desktop app, newest first, with the day it was
released. A release is made on GitHub's Releases page with a tag
`v<version>`; see [Release a new version](README.md#release-a-new-version).
The app itself shows the day its build was made, under its version.

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
