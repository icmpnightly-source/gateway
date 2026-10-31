KongGate, the Kong-based version (frozen on 2026-10-12)
======================================================

Before the gateway was rewritten as our own engine inside a desktop app, it
was Kong in Docker with two Lua plugins and a web UI in front. This folder
keeps what the rewrite changed or removed, so that version can still be
rebuilt:

  frontend/           the UI's source as it was (src, index.html, vite config,
                      nginx template, Dockerfile, .dockerignore). To build it
                      again, put these back over ../frontend.
  gateway/            the Kong plugins and the images' Dockerfiles
  docker-compose.yml  the development stack
  build-offline.mjs   the script that produced ../konggate-offline

To run or rebuild this version, copy gateway/, docker-compose.yml and
build-offline.mjs back to the project's root: they expect to sit there,
next to ../frontend.
