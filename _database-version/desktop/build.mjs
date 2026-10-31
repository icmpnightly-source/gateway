// Builds the desktop app for Windows into ../konggate-desktop: a folder that
// runs as it is (KongGate.exe), the same folder as a zip to carry around, and
// what the database's server needs.
//
//   node build.mjs
//
// Needs the dependencies of this folder and of ../frontend installed; the
// Electron that npm put in node_modules is the one that gets shipped.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const out = path.join(root, 'konggate-desktop');
const NAME = 'KongGate-win32-x64';
// Where the app ends up, and where it is put together first: the place it
// ends up in may hold a copy of the app that is running right now.
const published = path.join(out, NAME);
const staging = path.join(out, '.build');
const folder = path.join(staging, NAME);
const exe = path.join(folder, 'KongGate.exe');
const { version } = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`.trimEnd());
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`\n"${command}" failed; the app was not built.`);
    process.exit(1);
  }
  return result;
}

const electron = path.join(here, 'node_modules', 'electron', 'dist');
if (!existsSync(path.join(electron, 'electron.exe'))) {
  console.error('Electron for Windows is not in node_modules (run: node node_modules/electron/install.js).');
  process.exit(1);
}

// 1. The app's screens, as static files the engine serves. (npm is a .cmd on
//    Windows, which only a shell can start.)
run('npm run build', [], { cwd: path.join(root, 'frontend'), shell: true });
rmSync(path.join(here, 'ui'), { recursive: true, force: true });
cpSync(path.join(root, 'frontend', 'dist'), path.join(here, 'ui'), { recursive: true });

// 2. The icon, drawn from scratch.
run(process.execPath, [path.join(here, 'assets', 'make-icon.mjs')]);

// 3. Electron itself, under the app's own name.
console.log(`\n> assembling ${path.relative(root, published)}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(electron, folder, { recursive: true });
renameSync(path.join(folder, 'electron.exe'), exe);
rmSync(path.join(folder, 'resources', 'default_app.asar'), { force: true });

// 4. The app: what Electron runs when it finds resources/app.
const app = path.join(folder, 'resources', 'app');
for (const item of ['main.mjs', 'package.json', 'engine', 'ui', 'assets/icon.png', 'assets/tray.png']) {
  cpSync(path.join(here, item), path.join(app, item), { recursive: true });
}
// Only what the running app needs of node_modules: npm knows which those are.
const listed = spawnSync('npm ls --omit=dev --all --parseable', [], { cwd: here, shell: true, encoding: 'utf8' });
const runtime = listed.stdout.split(/\r?\n/).filter((line) => line && path.resolve(line) !== path.resolve(here));
if (runtime.length === 0) {
  console.error('npm did not list the runtime dependencies; the app was not built.');
  process.exit(1);
}
for (const dependency of runtime) {
  cpSync(dependency, path.join(app, path.relative(here, dependency)), { recursive: true });
}

// 5. The program file says whose it is: icon, name and version.
const program = ResEdit.NtExecutable.from(readFileSync(exe), { ignoreCert: true });
const resources = ResEdit.NtExecutableResource.from(program);
const [iconGroup] = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  resources.entries,
  iconGroup.id,
  iconGroup.lang,
  ResEdit.Data.IconFile.from(readFileSync(path.join(here, 'assets', 'icon.ico'))).icons.map((icon) => icon.data),
);
const [versionInfo] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
const [major, minor, patch] = version.split('.').map(Number);
versionInfo.setFileVersion(major, minor, patch, 0);
versionInfo.setProductVersion(major, minor, patch, 0);
versionInfo.setStringValues(versionInfo.getAllLanguagesForStringValues()[0], {
  ProductName: 'KongGate',
  FileDescription: 'KongGate',
  CompanyName: 'KongGate',
  LegalCopyright: 'KongGate',
  InternalName: 'KongGate',
  OriginalFilename: 'KongGate.exe',
});
versionInfo.outputToResourceEntries(resources.entries);
resources.outputResource(program);
writeFileSync(exe, Buffer.from(program.generate()));

// 6. Prove the packaged program starts and shows its first screen, with a
//    data folder of its own so nobody's settings are touched.
const smokeData = path.join(staging, 'data');
console.log('\n> KongGate.exe (self-check)');
const smoke = spawnSync(exe, [], {
  env: { ...process.env, KONGGATE_SMOKE: '1', KONGGATE_USER_DATA: smokeData },
  encoding: 'utf8',
  timeout: 60000,
});
rmSync(smokeData, { recursive: true, force: true });
const seen = smoke.stdout?.split('\n').find((line) => line.startsWith('{'));
if (smoke.status !== 0 || !seen) {
  console.error(`The packaged app did not start properly:\n${smoke.stdout}\n${smoke.stderr}`);
  process.exit(1);
}
const { path: firstPage, status } = JSON.parse(seen);
console.log(`  started: first page ${firstPage}, version ${status.version}, gateway on port ${status.gateway.port}`);

// 7. The same folder as one file. Windows' own tar writes zip archives; it is
//    named in full because another tar, which does not, may come first.
const zip = path.join(out, `KongGate-${version}-win-x64.zip`);
rmSync(zip, { force: true });
const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
run(tar, ['-a', '-c', '-f', zip, '-C', staging, NAME]);

// 8. What goes with the app: how to run it, and the database for the server.
//    The database's password is made up once and then kept.
cpSync(path.join(here, 'dist-files'), out, { recursive: true });
const databaseEnv = path.join(out, 'database', '.env');
if (!existsSync(databaseEnv)) {
  writeFileSync(
    databaseEnv,
    `# What the apps sign in to the database with (user "konggate").
KONGGATE_DB_PASSWORD=${randomBytes(18).toString('base64url')}

# The port the database is reached on.
KONGGATE_DB_PORT=5432
`,
  );
}

// 9. Into place. Windows will not rename a folder a running program is in,
//    and says so before anything is touched: the old copy is then left whole.
const aside = path.join(out, '.old');
let isInPlace = true;
rmSync(aside, { recursive: true, force: true });
try {
  if (existsSync(published)) renameSync(published, aside);
  renameSync(folder, published);
} catch (error) {
  if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
  isInPlace = false;
}
rmSync(aside, { recursive: true, force: true });
rmSync(staging, { recursive: true, force: true });

const megabytes = Math.round(statSync(zip).size / 1024 / 1024);
console.log(`\nDone: ${path.relative(root, zip)} (${megabytes} MB)`);
if (isInPlace) {
  console.log(`      ${path.relative(root, published)}${path.sep}KongGate.exe`);
} else {
  console.log(`\nKongGate is running from ${path.relative(root, published)}, so that folder still holds the`);
  console.log('previous build. Quit the app (tray icon, Quit) and run the build again, or unzip the new zip.');
}
