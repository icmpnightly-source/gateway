KongGate, the shared-database version (frozen on 2026-10-12)
============================================================

For a few hours the desktop app kept its projects, works and secrets in a
PostgreSQL database that every PC connected to. It was replaced by a file on
each PC plus JSON export/import, because one shared database mixed everybody's
projects together.

This folder keeps that version's sources as they were:

  desktop/    the engine (db.mjs is the PostgreSQL part), its test, the build
              script and the files that went out with the app (database/)
  frontend/   the screens (src), with the "connect to the database" page
  README.project.md   the project's README of that time

To bring it back, put these over ../desktop and ../frontend and add "pg" to
desktop/package.json again.
