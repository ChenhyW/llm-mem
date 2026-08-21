#!/usr/bin/env node

const { execSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const path = require('path');
const os = require('os');

const INSTALLED_PATH = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'ChenhyW-llm-mem');
const CACHE_BASE_PATH = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'ChenhyW', 'llm-mem');

function getCurrentBranch() {
  try {
    if (!existsSync(path.join(INSTALLED_PATH, '.git'))) {
      return null;
    }
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: INSTALLED_PATH,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

function getGitignoreExcludes(basePath) {
  const gitignorePath = path.join(basePath, '.gitignore');
  if (!existsSync(gitignorePath)) return '';

  const syncManagedFiles = new Set();
  // Patterns the sync script handles with its own dedicated rsync rules
  // further down, or that would over-exclude by matching too broadly at
  // the root-Directory rsync step.  Do NOT turn these into --exclude flags
  // for the root sync: e.g. `.gitignore`'s bare `plugin/` would make rsync
  // skip the entire plugin/ tree at the top-level sync, leaving
  // plugin/skills/ and plugin/ui/ absent in the installed marketplace
  // copy (they are synced explicitly by the per-subdir rsync below).
  const rootRsyncMustNotExclude = new Set([
    'plugin',
    'plugin/',
  ]);

  const lines = readFileSync(gitignorePath, 'utf-8').split('\n');
  return lines
    .map(line => line.trim())
    .filter(line =>
      line &&
      !line.startsWith('#') &&
      !line.startsWith('!') &&
      !syncManagedFiles.has(line) &&
      !rootRsyncMustNotExclude.has(line)
    )
    .map(pattern => `--exclude=${JSON.stringify(pattern)}`)
    .join(' ');
}

const branch = getCurrentBranch();
const isForce = process.argv.includes('--force');

if (branch && branch !== 'main' && !isForce) {
  console.log('');
  console.log('\x1b[33m%s\x1b[0m', `WARNING: Installed plugin is on beta branch: ${branch}`);
  console.log('\x1b[33m%s\x1b[0m', 'Running rsync would overwrite beta code.');
  console.log('');
  console.log('Options:');
  console.log('  1. Use the llm-mem UI on the configured worker port to update beta');
  console.log('  2. Switch to stable in UI first, then run sync');
  console.log('  3. Force rsync: npm run sync-marketplace:force');
  console.log('');
  process.exit(1);
}

function getPluginVersion() {
  try {
    const pluginJsonPath = path.join(__dirname, '..', 'plugin', '.claude-plugin', 'plugin.json');
    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    return pluginJson.version;
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', 'Failed to read plugin version:', error.message);
    process.exit(1);
  }
}

console.log('Syncing to marketplace...');
try {
  const rootDir = path.join(__dirname, '..');
  const gitignoreExcludes = getGitignoreExcludes(rootDir);

  execSync(
    `rsync -av --delete --exclude=.git --exclude=bun.lock --exclude=package-lock.json --exclude=scripts/package.json --exclude=scripts/node_modules --exclude=/workers ${gitignoreExcludes} ./ ~/.claude/plugins/marketplaces/ChenhyW-llm-mem/`,
    { stdio: 'inherit' }
  );

  console.log('Running bun install in marketplace...');
  execSync(
    'cd ~/.claude/plugins/marketplaces/ChenhyW-llm-mem/ && bun install',
    { stdio: 'inherit' }
  );

  const version = getPluginVersion();
  const CACHE_VERSION_PATH = path.join(CACHE_BASE_PATH, version);

  const pluginDir = path.join(rootDir, 'plugin');
  const pluginGitignoreExcludes = getGitignoreExcludes(pluginDir);

  console.log(`Syncing to cache folder (version ${version})...`);
  execSync(
    `rsync -av --delete --exclude=.git ${pluginGitignoreExcludes} plugin/ "${CACHE_VERSION_PATH}/"`,
    { stdio: 'inherit' }
  );

  // Sync plugin/ui/ and plugin/modes/ into cache so the in-plugin worker
  // (whose getPackageRoot resolves to the plugin/ dir) can locate them.
  // rsync above copies plugin/ *contents* to the cache root, so these
  // subdirs otherwise land at cache/1.0.0/{ui,modes}/ instead of
  // cache/1.0.0/plugin/{ui,modes}/.
  for (const sub of ['ui', 'modes']) {
    const src = path.join(pluginDir, sub);
    const dst = path.join(CACHE_VERSION_PATH, 'plugin', sub);
    if (existsSync(src)) {
      execSync(
        `rsync -av --delete "${src}/" "${dst}/"`,
        { stdio: 'inherit' }
      );
      console.log(`Synced plugin/${sub}/ into cache for in-plugin worker`);
    }
  }

  console.log(`Running bun install in cache folder (version ${version})...`);
  execSync(`bun install`, { cwd: CACHE_VERSION_PATH, stdio: 'inherit' });

  // Ensure the plugin/scripts folder mirrors the full scripts/ directory.
  // combined hooks.json resolves scripts via $_R/plugin/scripts, so all
  // runtime scripts (mcp-server.cjs, worker-service.cjs, bun-runner.js, …)
  // must live there. Top-level scripts/ holds the complete set, but it is
  // not rsync'd when only plugin/ is synced into cache.
  const scriptsSrc = path.join(rootDir, 'scripts');
  const scriptsDst = path.join(CACHE_VERSION_PATH, 'plugin', 'scripts');
  execSync(
    `rsync -av --exclude=package.json --exclude=node_modules "${scriptsSrc}/" "${scriptsDst}/"`,
    { stdio: 'inherit' }
  );

  console.log('\x1b[32m%s\x1b[0m', 'Sync complete!');

} catch (error) {
  console.error('\x1b[31m%s\x1b[0m', 'Sync failed:', error.message);
  process.exit(1);
}
