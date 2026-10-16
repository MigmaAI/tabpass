#!/usr/bin/env node
// Checks that extension/dist is a store build, then zips it for the Chrome Web Store.
//
//   node scripts/package.mjs           check, then write release/tabpass-<version>.zip
//   node scripts/package.mjs --check   check only, write nothing
//
// Build first with `yarn --cwd extension build` (not build:dev). Needs Node 20+ and the `zip`
// command; no npm dependencies. In GitHub Actions it also writes version, zip, size and sha256 to
// $GITHUB_OUTPUT so later steps can use them.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'extension', 'dist');
const PACKAGE_JSON = join(ROOT, 'extension', 'package.json');
const RELEASE = join(ROOT, 'release');
const BUILD_COMMAND = 'yarn --cwd extension build';
const STORE_RELAY = 'wss://tabs.migma.ai/extension';

// Origins a store build must never trust: anything on this machine.
const LOCAL_ORIGIN = /^(\*|https?|wss?):\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])([:/]|$)/i;
// Chrome's rule: one to four dot-separated integers, 0-65535, no leading zeros.
const CHROME_VERSION = /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/;
// Junk that must not ship.
const ZIP_EXCLUDE = ['.DS_Store', '*/.DS_Store', 'Thumbs.db', '*/Thumbs.db', '__MACOSX/*'];

const USAGE = `Usage: node scripts/package.mjs [--check]

  (no flag)  Check extension/dist, then write release/tabpass-<version>.zip
  --check    Check extension/dist only; write nothing
  --help     Show this help`;

// ---------- helpers ----------

function rel(path) {
  return relative(ROOT, path) || '.';
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** Every file under dir, as paths relative to dir with forward slashes. */
async function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(dir, path)));
    else files.push(path);
  }
  return files;
}

function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolvePromise(hash.digest('hex')));
  });
}

function formatSize(bytes) {
  const kb = bytes / 1024;
  const human = kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
  return `${bytes.toLocaleString('en-US')} bytes (${human})`;
}

function fail(lines) {
  console.error(lines.join('\n'));
  process.exit(1);
}

/** Files the manifest points at, each with where it was referenced, for a clear error. */
function referencedFiles(manifest) {
  const refs = [];
  const add = (path, where) => {
    if (typeof path === 'string' && path) refs.push({ path: path.replace(/^\//, ''), where });
  };
  for (const [size, path] of Object.entries(manifest.icons ?? {})) add(path, `icons.${size}`);
  const actionIcon = manifest.action?.default_icon;
  if (typeof actionIcon === 'string') add(actionIcon, 'action.default_icon');
  else for (const [size, path] of Object.entries(actionIcon ?? {})) add(path, `action.default_icon.${size}`);
  add(manifest.action?.default_popup, 'action.default_popup');
  add(manifest.background?.service_worker, 'background.service_worker');
  add(manifest.side_panel?.default_path, 'side_panel.default_path');
  add(manifest.options_page, 'options_page');
  add(manifest.options_ui?.page, 'options_ui.page');
  (manifest.content_scripts ?? []).forEach((script, index) => {
    for (const path of script.js ?? []) add(path, `content_scripts[${index}].js`);
    for (const path of script.css ?? []) add(path, `content_scripts[${index}].css`);
  });
  return refs;
}

// ---------- checks ----------

/**
 * Returns { manifest, version, errors, warnings }. Stops early (via fail) only when there is
 * nothing to check: no dist folder or no readable manifest.
 */
async function checkDist() {
  const errors = [];
  const warnings = [];

  if (!(await isDirectory(DIST))) {
    fail([
      `error: ${rel(DIST)} does not exist, so there is nothing to package.`,
      '',
      `  Build the store version first:  ${BUILD_COMMAND}`,
    ]);
  }

  const manifestPath = join(DIST, 'manifest.json');
  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    fail([
      `error: could not read ${rel(manifestPath)}: ${error instanceof Error ? error.message : String(error)}`,
      '',
      `  Rebuild with:  ${BUILD_COMMAND}`,
    ]);
  }

  if (manifest.manifest_version !== 3) {
    errors.push(`manifest_version is ${JSON.stringify(manifest.manifest_version)}; the Chrome Web Store only accepts 3.`);
  }

  // A development build (`yarn build:dev`) renames itself and trusts a local fake Migma.
  for (const field of ['name', 'short_name']) {
    if (typeof manifest[field] === 'string' && manifest[field].includes('(dev)')) {
      errors.push(
        `This is a development build: manifest ${field} is "${manifest[field]}".\n` +
          `    Make the store build with:  ${BUILD_COMMAND}  (not build:dev)`
      );
    }
  }
  const buildConfigPath = join(DIST, 'lib', 'build-config.js');
  if (await exists(buildConfigPath)) {
    const buildConfig = await readFile(buildConfigPath, 'utf8');
    if (/BUILD_MODE\s*=\s*['"]development['"]/.test(buildConfig)) {
      errors.push(
        `${rel(buildConfigPath)} says BUILD_MODE = 'development', so this build trusts a local test provider.\n` +
          `    Make the store build with:  ${BUILD_COMMAND}`
      );
    }
  }

  const matches = manifest.externally_connectable?.matches ?? [];
  const localMatches = matches.filter((pattern) => LOCAL_ORIGIN.test(pattern));
  if (localMatches.length) {
    errors.push(
      `externally_connectable.matches lets local pages message the extension: ${localMatches.join(', ')}.\n` +
        '    A store build may only trust the real provider sites (https://migma.ai/*, https://*.migma.ai/*).\n' +
        `    This usually means a build:dev output. Rebuild with:  ${BUILD_COMMAND}`
    );
  }

  if ('key' in manifest) {
    errors.push(
      'manifest.json has a "key" field. The store sets the extension ID itself and can refuse an upload that carries one.\n' +
        '    Keep "key" only in local development builds (see docs/publishing.md, "Keep a stable extension ID").'
    );
  }
  if ('update_url' in manifest) {
    errors.push('manifest.json has an "update_url" field. Store items update from the store; remove it.');
  }

  const version = manifest.version;
  if (typeof version !== 'string' || !CHROME_VERSION.test(version)) {
    errors.push(
      `manifest version ${JSON.stringify(version)} is not a valid Chrome version.\n` +
        '    Use one to four dot-separated numbers from 0 to 65535 without leading zeros, e.g. "0.3.0".'
    );
  }
  let packageVersion;
  try {
    packageVersion = (await readJson(PACKAGE_JSON)).version;
  } catch (error) {
    errors.push(`could not read ${rel(PACKAGE_JSON)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (packageVersion !== undefined && packageVersion !== version) {
    errors.push(
      `Version mismatch: ${rel(manifestPath)} says ${JSON.stringify(version)}, ` +
        `${rel(PACKAGE_JSON)} says ${JSON.stringify(packageVersion)}.\n` +
        '    Set the same version in extension/public/manifest.json and extension/package.json, then rebuild.'
    );
  }

  const refs = referencedFiles(manifest);
  if (!Object.keys(manifest.icons ?? {}).includes('128')) {
    errors.push('manifest icons has no "128" entry. The Chrome Web Store needs a 128x128 icon.');
  }
  for (const ref of refs) {
    if (!(await exists(join(DIST, ...ref.path.split('/'))))) {
      errors.push(`${ref.where} points to "${ref.path}", which is not in ${rel(DIST)}.`);
    }
  }

  // The store build must default to the hosted relay over TLS, not to a relay on this machine.
  const files = await listFiles(DIST);
  const relayDefaults = [];
  for (const file of files.filter((path) => path.endsWith('.js'))) {
    const source = await readFile(join(DIST, ...file.split('/')), 'utf8');
    for (const match of source.matchAll(/DEFAULT_RELAY_URL\s*=\s*(['"`])([^'"`]+)\1/g)) {
      relayDefaults.push({ file, url: match[2] });
    }
  }
  if (!relayDefaults.length) {
    warnings.push(`Could not find DEFAULT_RELAY_URL in ${rel(DIST)}, so the default relay was not checked. Expected ${STORE_RELAY}.`);
  }
  for (const { file, url } of relayDefaults) {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      // reported below as not wss://
    }
    if (!url.startsWith('wss://') || /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])$/.test(host)) {
      errors.push(
        `The default relay in ${rel(DIST)}/${file} is ${url}.\n` +
          `    Store builds must default to a public relay over TLS (${STORE_RELAY}), deployed before you submit.`
      );
    } else if (url !== STORE_RELAY) {
      warnings.push(`The default relay is ${url}, not ${STORE_RELAY}. Make sure it is deployed and intended.`);
    }
  }

  const sourceMaps = files.filter((path) => path.endsWith('.map'));
  if (sourceMaps.length) {
    warnings.push(`${sourceMaps.length} source map file(s) will ship (${sourceMaps.slice(0, 3).join(', ')}${sourceMaps.length > 3 ? ', …' : ''}).`);
  }

  return { manifest, version, files, errors, warnings };
}

// ---------- packaging ----------

function zipCommandAvailable() {
  const probe = spawnSync('zip', ['-v'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

async function writeZip(version) {
  if (!zipCommandAvailable()) {
    fail([
      'error: the `zip` command is not installed, so the package cannot be written.',
      '',
      '  Install it (Debian/Ubuntu: sudo apt-get install zip, macOS: it ships with the system) and run again.',
    ]);
  }

  await mkdir(RELEASE, { recursive: true });
  const out = join(RELEASE, `tabpass-${version}.zip`);
  // zip adds to an existing archive instead of replacing it, so start clean.
  await rm(out, { force: true });

  // Run inside dist so manifest.json sits at the zip root, as the store requires.
  const result = spawnSync('zip', ['-r', '-X', '-q', out, '.', '-x', ...ZIP_EXCLUDE], { cwd: DIST, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    fail([
      `error: zip failed (exit ${result.status ?? 'none'}).`,
      result.error ? `  ${result.error.message}` : '',
      result.stderr ? `  ${result.stderr.trim()}` : '',
    ].filter(Boolean));
  }

  // Confirm the layout: manifest.json at the root, not inside a dist/ folder.
  const listing = spawnSync('zip', ['-sf', out], { encoding: 'utf8' });
  const entries = (listing.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(Archive contains:|Total \d+ entries)/.test(line));
  if (!entries.includes('manifest.json')) {
    fail([`error: ${rel(out)} has no manifest.json at its root. Delete it and run again.`]);
  }

  const { size } = await stat(out);
  const digest = await sha256(out);
  return { out, size, digest, entries: entries.filter((entry) => !entry.endsWith('/')).length };
}

async function writeGithubOutput(values) {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await appendFile(target, `${lines.join('\n')}\n`);
}

// ---------- main ----------

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const unknown = args.filter((arg) => arg !== '--check');
  if (unknown.length) {
    console.error(`error: unknown option ${unknown.join(' ')}\n\n${USAGE}`);
    process.exit(2);
  }
  const checkOnly = args.includes('--check');

  const { manifest, version, files, errors, warnings } = await checkDist();

  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (errors.length) {
    fail([
      `${rel(DIST)} is not ready for the Chrome Web Store (${errors.length} problem${errors.length === 1 ? '' : 's'}):`,
      '',
      ...errors.map((error) => `  - ${error}`),
      '',
      'Nothing was packaged.',
    ]);
  }

  if (checkOnly) {
    console.log(`ok: ${rel(DIST)} is a store build of ${manifest.name} ${version} (${files.length} files). Nothing written (--check).`);
    await writeGithubOutput({ version });
    return;
  }

  const { out, size, digest, entries } = await writeZip(version);
  console.log(`Packaged ${manifest.name} ${version}`);
  console.log(`  file    ${rel(out)}`);
  console.log(`  files   ${entries}`);
  console.log(`  size    ${formatSize(size)}`);
  console.log(`  sha256  ${digest}`);
  await writeGithubOutput({ version, zip: rel(out).split(sep).join('/'), size, sha256: digest });
}

main().catch((error) => {
  console.error(`error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
