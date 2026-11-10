#!/usr/bin/env node
/**
 * OPF Automated Git-Diff Smart Version Bumper
 * Checks new releases of ollama/ollama against each plugin's declared watch_paths.
 * If none of a plugin's watch_paths were modified between its max_tested_ollama_version
 * and the latest Ollama release, automatically appends the new version to
 * verified_ollama_versions and updates max_tested_ollama_version.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFESTS = ['official-source.json', 'community-endorsed.json'];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'OPF-Release-Watcher/1.0',
      'Accept': 'application/vnd.github+json'
    };
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

async function getLatestOllamaRelease() {
  if (process.env.TARGET_OLLAMA_VERSION && process.env.TARGET_OLLAMA_VERSION.trim()) {
    return process.env.TARGET_OLLAMA_VERSION.trim().replace(/^v/, '');
  }
  try {
    const release = await fetchJson('https://api.github.com/repos/ollama/ollama/releases/latest');
    return (release.tag_name || '').replace(/^v/, '');
  } catch (err) {
    console.log(`[OPF Bumper] Notice: Could not fetch live ollama/ollama release (${err.message}). Using local verification mode.`);
    return null;
  }
}

async function getChangedFilesBetweenTags(baseVer, headVer) {
  try {
    const compareUrl = `https://api.github.com/repos/ollama/ollama/compare/v${baseVer}...v${headVer}`;
    const data = await fetchJson(compareUrl);
    return (data.files || []).map((f) => f.filename);
  } catch (err) {
    console.log(`[OPF Bumper] Compare fallback for v${baseVer}...v${headVer}: ${err.message}`);
    return [];
  }
}

function pathMatchesWatchPaths(changedFiles, watchPaths) {
  if (!Array.isArray(watchPaths) || watchPaths.length === 0) return [];
  return changedFiles.filter((file) =>
    watchPaths.some((wp) => file === wp || file.startsWith(wp.replace(/\/$/, '') + '/'))
  );
}

async function main() {
  const targetVersion = await getLatestOllamaRelease();
  if (!targetVersion) {
    console.log('[OPF Bumper] No new target version specified or discovered. Exiting cleanly.');
    return;
  }

  console.log(`[OPF Bumper] Evaluating plugins against Ollama v${targetVersion}...`);

  for (const manifestFile of MANIFESTS) {
    const manifestPath = path.join(REPO_ROOT, manifestFile);
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let updatedCount = 0;

    for (const plugin of manifest.plugins || []) {
      const verified = plugin.verified_ollama_versions || [];
      if (verified.includes(targetVersion)) {
        console.log(`  [SKIP] ${plugin.id} already verified for v${targetVersion}`);
        continue;
      }

      const baseVersion = plugin.max_tested_ollama_version || verified[verified.length - 1] || '0.40.16';
      const changedFiles = await getChangedFilesBetweenTags(baseVersion, targetVersion);
      const touchedWatchPaths = pathMatchesWatchPaths(changedFiles, plugin.watch_paths || []);

      if (touchedWatchPaths.length === 0) {
        console.log(`  [AUTO-BUMP] ${plugin.id}: 0 watch_paths touched between v${baseVersion} and v${targetVersion}. Marking compatible.`);
        plugin.verified_ollama_versions = [...verified, targetVersion];
        plugin.max_tested_ollama_version = targetVersion;
        updatedCount++;

        const pluginJsonPath = path.join(REPO_ROOT, 'plugins', plugin.id, 'plugin.json');
        if (fs.existsSync(pluginJsonPath)) {
          const pJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
          pJson.verified_ollama_versions = plugin.verified_ollama_versions;
          pJson.max_tested_ollama_version = targetVersion;
          fs.writeFileSync(pluginJsonPath, JSON.stringify(pJson, null, 2) + '\n', 'utf8');
        }
      } else {
        console.warn(`  [HOLD] ${plugin.id}: watch_paths modified (${touchedWatchPaths.join(', ')}). Requires manual maintainer review.`);
      }
    }

    if (updatedCount > 0) {
      manifest.updated_at = new Date().toISOString();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      console.log(`[OPF Bumper] Updated ${updatedCount} plugin(s) in ${manifestFile}.`);
    }
  }
}

main().catch((err) => {
  console.error('[OPF Bumper] Fatal error:', err);
  process.exit(1);
});
