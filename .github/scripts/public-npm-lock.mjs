// Makes a package-lock.json written on the office network installable anywhere.
//
//   node .github/scripts/public-npm-lock.mjs frontend/package-lock.json
//
// The frontend's lock names a package mirror on the office network as where
// each package comes from. Its packages are the npm registry's own, byte for
// byte (the lock's checksums prove it on install), so they are fetched from the
// registry instead. The lock also lists, without a version, packages for other
// systems that were never installed (macOS, Linux on ARM, ...); npm cannot read
// those, so they are dropped. Only the copy on the build machine is changed.

import { readFileSync, writeFileSync } from 'node:fs';

const MIRROR = 'http://192.168.2.26:8083/repository/npm-locally/';
const REGISTRY = 'https://registry.npmjs.org/';

const file = process.argv[2];
const lock = JSON.parse(readFileSync(file, 'utf8'));
let moved = 0;
let dropped = 0;
for (const [key, entry] of Object.entries(lock.packages)) {
  if (key && !entry.version && !entry.link) {
    delete lock.packages[key];
    dropped += 1;
  } else if (entry.resolved?.startsWith(MIRROR)) {
    entry.resolved = REGISTRY + entry.resolved.slice(MIRROR.length);
    moved += 1;
  }
}
writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`${file}: ${moved} package(s) now come from ${REGISTRY}; ${dropped} entry(ies) without a version dropped`);
