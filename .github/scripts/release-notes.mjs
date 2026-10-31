// Prints what CHANGELOG.md says about one version: the release's notes.
//
//   node .github/scripts/release-notes.mjs 2.0.0
//
// Fails when CHANGELOG.md has no "## <version> — <date>" section for it.

import { readFileSync } from 'node:fs';

const version = process.argv[2];
const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
const section = changelog.split(/^## /m).find((part) => part.startsWith(`${version} `));
if (!section) {
  console.error(`CHANGELOG.md has no "## ${version} — <date>" section: add one saying what this release changes.`);
  process.exit(1);
}
console.log(section.slice(section.indexOf('\n') + 1).trim());
