// Builds the offline bundle in ./konggate-offline: the app, our three images,
// and one archive holding every image the stack runs on. Copy that folder to
// a machine with Docker and no internet; its README.txt says how to run it.
//
//   node build-offline.mjs
//
// Needs Docker running and the frontend's dependencies installed.

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(root, 'konggate-offline');
const archive = path.join(bundle, 'konggate-images.tar.gz');

// Keep in step with konggate-offline/docker-compose.yml.
const VERSION = '1.0';
const BUILT = [
  { image: `konggate/kong:${VERSION}`, context: 'gateway' },
  { image: `konggate/echo:${VERSION}`, context: 'gateway/echo' },
  { image: `konggate/ui:${VERSION}`, context: 'frontend' },
];
const STOCK = ['postgres:16-alpine', 'jaegertracing/jaeger:2.21.0'];

function run(command, args, { cwd = root, shell = false } = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  // A shell takes the command as one line; without one, the arguments go as they are.
  const { status } = shell
    ? spawnSync(`${command} ${args.join(' ')}`, { cwd, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (status !== 0) {
    console.error(`\n"${command} ${args[0]}" failed; the bundle was not built.`);
    process.exit(1);
  }
}

const hasImage = (image) => spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0;

// 1. The app, as static files for the ui image to serve. (npm is a .cmd on
//    Windows, which only a shell can start.)
run('npm', ['run', 'build'], { cwd: path.join(root, 'frontend'), shell: process.platform === 'win32' });

// 2. Our own images.
for (const { image, context } of BUILT) run('docker', ['build', '--tag', image, context]);

// 3. The ones used as they come. Fetched only if this machine lacks them.
for (const image of STOCK) {
  if (!hasImage(image)) run('docker', ['pull', image]);
}

// 4. Everything into one compressed archive, which "docker load" reads as is.
const images = [...BUILT.map(({ image }) => image), ...STOCK];
console.log(`\n> docker save ${images.join(' ')} | gzip > ${path.relative(root, archive)}`);
const save = spawn('docker', ['save', ...images], { stdio: ['ignore', 'pipe', 'inherit'] });
const saved = new Promise((resolve) => save.on('close', resolve));
await pipeline(save.stdout, createGzip(), createWriteStream(archive));
if ((await saved) !== 0) {
  console.error('\n"docker save" failed; the archive is incomplete.');
  process.exit(1);
}

// 5. The bundle's settings, unless it has some already. The administrator
//    password is carried over from this project's own .env.
const envFile = path.join(bundle, '.env');
if (!existsSync(envFile)) {
  const password = readFileSync(path.join(root, '.env'), 'utf8').match(/^KONGGATE_ADMIN_PASSWORD=(.*)$/m)?.[1] ?? '';
  writeFileSync(
    envFile,
    `# Ports on this machine.
# The app:
UI_PORT=8080
# Where clients send their requests:
KONG_PROXY_PORT=8100
# Jaeger, to look at traces:
JAEGER_UI_PORT=16686

# Who can open Jaeger: 0.0.0.0 lets any computer on the network in, 127.0.0.1
# only this machine. Jaeger has no sign-in of its own, so anyone who can open
# it can read every recorded trace.
JAEGER_BIND=0.0.0.0

# What an administrator signs in with (only administrators are asked for a
# password). Change it, then run: docker compose up -d
KONGGATE_ADMIN_PASSWORD=${password.trim()}
`,
  );
}

const megabytes = Math.round(statSync(archive).size / 1024 / 1024);
console.log(`\nDone: ${path.relative(root, bundle)} is ready (${megabytes} MB of images). Its README.txt says how to run it.`);
