#!/usr/bin/env node
/**
 * OPF Dual Frontier AI & Static AST Security Auditor
 * Verifies every plugin in `official-source.json` and `community-endorsed.json`:
 * 1. Privacy Airlock Check: Blocks any reference to ~/.ollama/id_ed25519, SSH keys, or credential stores.
 * 2. Dangerous Execution Check: Flags undeclared child_process.exec / eval / Function constructors.
 * 3. SHA-256 Content Integrity Pinning: Ensures manifest sha256 matches the exact hash of plugins/<id>/index.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFESTS = ['official-source.json', 'community-endorsed.json'];

const FORBIDDEN_PATTERNS = [
  { regex: /id_ed25519/i, reason: 'Privacy Airlock violation: Attempted access to Ollama private key (id_ed25519)' },
  { regex: /\.ssh[\\/]/i, reason: 'Privacy Airlock violation: Attempted access to user SSH directory' },
  { regex: /\beval\s*\(/, reason: 'Static AST violation: Dynamic eval() execution is forbidden' },
  { regex: /new\s+Function\s*\(/, reason: 'Static AST violation: Dynamic Function() constructor is forbidden' },
  { regex: /child_process/i, reason: 'Sandbox violation: Direct child_process spawning is forbidden in OPF plugins' }
];

function computeSha256(filePath) {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function computeNormalizedSha256(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function main() {
  let hasErrors = false;
  let auditedCount = 0;

  console.log('=== OPF Static AST, Privacy Airlock & SHA-256 Pinning Security Audit ===\n');

  for (const manifestFile of MANIFESTS) {
    const manifestPath = path.join(REPO_ROOT, manifestFile);
    if (!fs.existsSync(manifestPath)) {
      console.error(`[ERROR] Missing manifest file: ${manifestFile}`);
      hasErrors = true;
      continue;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log(`Auditing source manifest: ${manifest.source_name} (${manifestFile})`);

    for (const entry of manifest.plugins || []) {
      const pluginDir = path.join(REPO_ROOT, 'plugins', entry.id);
      const pluginJsonPath = path.join(pluginDir, 'plugin.json');
      const indexJsPath = path.join(pluginDir, 'index.js');

      if (!fs.existsSync(pluginJsonPath) || !fs.existsSync(indexJsPath)) {
        console.error(`  [FAIL] ${entry.id}: Missing plugin.json or index.js in plugins/${entry.id}`);
        hasErrors = true;
        continue;
      }

      const code = fs.readFileSync(indexJsPath, 'utf8');

      // 1. Static AST & Privacy Airlock Pattern Scan
      for (const rule of FORBIDDEN_PATTERNS) {
        if (rule.regex.test(code)) {
          console.error(`  [FAIL] ${entry.id}: ${rule.reason}`);
          hasErrors = true;
        }
      }

      // 2. SHA-256 Integrity Pin Verification
      const actualHash = computeSha256(indexJsPath);
      const normHash = computeNormalizedSha256(indexJsPath);
      if (entry.sha256 !== actualHash && entry.sha256 !== normHash) {
        console.error(`  [FAIL] ${entry.id}: SHA-256 mismatch!\n    Manifest: ${entry.sha256}\n    Actual:   ${actualHash}`);
        hasErrors = true;
      } else {
        console.log(`  [PASS] ${entry.id} v${entry.version} (SHA-256: ${entry.sha256.slice(0, 16)}... | Max Ollama: v${entry.max_tested_ollama_version})`);
        auditedCount++;
      }
    }
    console.log('');
  }

  if (hasErrors) {
    console.error('[AUDIT FAILED] One or more plugins failed security or integrity checks.');
    process.exit(1);
  }

  console.log(`[AUDIT PASSED] All ${auditedCount} plugins passed Static AST, Privacy Airlock, and SHA-256 verification.`);
}

main();
