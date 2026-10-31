// Runs the engine without a window: for development (the UI's dev server
// talks to it) and for trying things out.
//
//   node engine/cli.mjs [--dev-origin=http://localhost:5173] [settings.json]
//
// --dev-origin: an extra origin the API takes calls from, which is what the
// UI's dev server is. (Also read from KONGGATE_DEV_ORIGIN, comma-separated.)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEngine } from './index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

const FLAG = '--dev-origin=';
const args = process.argv.slice(2);
const devOrigins = [
  ...args.filter((arg) => arg.startsWith(FLAG)).map((arg) => arg.slice(FLAG.length)),
  ...(process.env.KONGGATE_DEV_ORIGIN ?? '').split(','),
].filter(Boolean);
const settingsFile = args.find((arg) => !arg.startsWith('--')) ?? path.join(here, '..', '.dev', 'settings.json');

const engine = await startEngine({
  settingsFile: path.resolve(settingsFile),
  uiDir: path.resolve(here, '..', '..', 'frontend', 'dist'),
  devOrigins,
  version: 'dev',
});

const { gateway, database } = engine.status();
console.log(`app      ${engine.url}`);
console.log(`gateway  port ${gateway.port}${gateway.running ? '' : ` (not running: ${gateway.error?.message})`}`);
console.log(`database ${database.host ? `${database.host}:${database.port}/${database.name}` : 'not set up yet'}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await engine.stop();
    process.exit(0);
  });
}
