#!/usr/bin/env node
/**
 * OPF Official Ollama Library Catalog Syncer
 * Fetches live model metadata, filters (local/cloud, tools, thinking, vision, embedding, decision),
 * parameter tags, context windows, and download sizes directly from https://ollama.com
 * and writes catalog/ollama-library.json for CORS-free consumption by OPF plugins.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'catalog');
const OUT_FILE = path.join(OUT_DIR, 'ollama-library.json');

function fetchUrl(url, extraHeaders = {}, maxRedirects = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; OPF-Library-Sync/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          ...extraHeaders
        },
        timeout: 20000
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : 'https://ollama.com' + res.headers.location;
          res.resume();
          return resolve(fetchUrl(next, extraHeaders, maxRedirects - 1));
        }
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out: ' + url));
    });
    req.on('error', reject);
  });
}

function decodeHtml(str) {
  return String(str || '')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return decodeHtml(String(html || '').replace(/<[^>]+>/g, ' '));
}

function parseAbbrevNumber(text) {
  const clean = String(text || '').replace(/,/g, '').trim();
  const m = clean.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = (m[2] || '').toUpperCase();
  if (unit === 'K') return Math.round(val * 1e3);
  if (unit === 'M') return Math.round(val * 1e6);
  if (unit === 'B') return Math.round(val * 1e9);
  return Math.round(val);
}

function parseSizeToGB(text) {
  if (!text) return null;
  const matches = [...String(text).matchAll(/(\d+(?:\.\d+)?)\s*(TB|GB|MB)/gi)];
  if (matches.length === 0) return null;
  const values = matches.map((m) => {
    const n = parseFloat(m[1]);
    const u = m[2].toUpperCase();
    if (u === 'TB') return n * 1024;
    if (u === 'GB') return n;
    return n / 1024;
  });
  return {
    minGB: Math.min(...values),
    maxGB: Math.max(...values),
    text: matches.map((m) => `${m[1]}${m[2].toUpperCase()}`).join(' - ')
  };
}

function parseParamHintToGB(paramLabel) {
  if (!paramLabel) return null;
  const s = String(paramLabel).toLowerCase().trim();
  // e.g. e2b, e4b, 8x7b, 65b, 600m, 0.8b
  let m = s.match(/^(\d+)x(\d+(?:\.\d+)?)b$/);
  if (m) {
    const approxB = parseFloat(m[1]) * parseFloat(m[2]) * 0.65;
    return Number((approxB * 0.62).toFixed(1));
  }
  m = s.match(/^e?(\d+(?:\.\d+)?)(b|m)$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = m[2];
  const billions = unit === 'b' ? num : num / 1000;
  // Typical Q4_K_M quantization footprint is ~0.62-0.70 GB per billion params
  const gb = Math.max(0.2, billions * 0.65);
  return Number(gb.toFixed(1));
}

function parseSearchPageCards(html) {
  const results = [];
  const cardRe = /<a href="\/library\/([a-zA-Z0-9._-]+)" class="group [^"]*">([\s\S]*?)<\/a>/g;
  let match;
  while ((match = cardRe.exec(html)) !== null) {
    const slug = match[1];
    const inner = match[2];

    const relTimeMatch = inner.match(/<span[^>]*title="Updated ([^"]+)"[^>]*>([^<]+)<\/span>/);
    const updatedTitle = relTimeMatch ? decodeHtml(relTimeMatch[1]) : '';
    const updatedRel = relTimeMatch ? decodeHtml(relTimeMatch[2]) : '';

    const descMatch = inner.match(/<p class="[^"]*line-clamp-2[^"]*">([\s\S]*?)<\/p>/);
    const description = descMatch ? stripTags(descMatch[1]) : '';

    // Badges row (capability pills + cloud pill)
    const badges = [];
    const badgeSectionMatch = inner.match(/<div class="order-last[^"]*">([\s\S]*?)<\/div>/);
    if (badgeSectionMatch) {
      const spanRe = /<span[^>]*>([^<]+)<\/span>/g;
      let bm;
      while ((bm = spanRe.exec(badgeSectionMatch[1])) !== null) {
        const b = decodeHtml(bm[1]).toLowerCase();
        if (b && !badges.includes(b)) badges.push(b);
      }
    }

    const isCloud = badges.includes('cloud');
    const capabilities = badges.filter((b) => b !== 'cloud');

    // Bottom stats row (downloads, tags, context window, param size pills)
    const dlMatch = inner.match(/title="([\d,]+)\s+downloads"[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    const pullsText = dlMatch ? decodeHtml(dlMatch[2]) : '';
    const pullsCount = dlMatch ? parseInt(dlMatch[1].replace(/,/g, ''), 10) || 0 : 0;

    const tagsMatch = inner.match(/<span[^>]*>(\d+)\s+tags?<\/span>/i);
    const tagCount = tagsMatch ? parseInt(tagsMatch[1], 10) : (isCloud ? 1 : 0);

    const ctxMatch = inner.match(/title="Context window"[\s\S]*?<span[^>]*>([^<]+)<\/span>/);
    const contextWindow = ctxMatch ? decodeHtml(ctxMatch[1]) : '';

    const paramSizes = [];
    const paramRe = /bg-\[#ddf4ff\][^>]*>([^<]+)<\/span>/g;
    let pm;
    while ((pm = paramRe.exec(inner)) !== null) {
      const p = decodeHtml(pm[1]);
      if (p && !paramSizes.includes(p)) paramSizes.push(p);
    }

    const hasLocal = paramSizes.length > 0 || tagCount > (isCloud ? 1 : 0) || !isCloud;
    let updatedIso = null;
    if (updatedTitle) {
      const d = new Date(updatedTitle);
      if (!isNaN(d.getTime())) updatedIso = d.toISOString();
    }

    results.push({
      id: slug,
      name: slug,
      description,
      updatedRel,
      updatedTitle,
      updatedIso,
      capabilities,
      isCloud,
      isLocal: hasLocal,
      pullsText,
      pullsCount,
      tagCount,
      contextWindow,
      contextTokens: parseAbbrevNumber(contextWindow),
      paramSizes
    });
  }
  return results;
}

function parseModelTagsHtml(slug, html) {
  const tags = [];
  const seen = new Set();
  // Mobile tag blocks contain reliable single-line metadata: digest • size • context • input • updated
  const rowRe = /<a\b[^>]*href="\/library\/([^":]+:[^"]+)"[^>]*class="md:hidden[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const fullTag = decodeHtml(m[1]);
    if (seen.has(fullTag)) continue;
    seen.add(fullTag);

    const block = m[2];
    const shortTag = fullTag.includes(':') ? fullTag.split(':').slice(1).join(':') : 'latest';
    const isLatestBadge = />latest<\/span>/i.test(block);
    const isCloudTag = shortTag === 'cloud' || shortTag.endsWith('-cloud');

    const plainText = stripTags(block);
    const sizeInfo = isCloudTag ? null : parseSizeToGB(plainText);
    const ctxMatch = plainText.match(/(\d+(?:\.\d+)?[KM])\s+context window/i);
    const contextWindow = ctxMatch ? ctxMatch[1].toUpperCase() : '';

    tags.push({
      tag: fullTag,
      shortTag,
      isLatest: isLatestBadge,
      isCloud: isCloudTag,
      sizeGB: sizeInfo ? Number(sizeInfo.maxGB.toFixed(2)) : 0,
      minSizeGB: sizeInfo ? Number(sizeInfo.minGB.toFixed(2)) : 0,
      sizeText: isCloudTag ? 'Cloud' : (sizeInfo ? sizeInfo.text : ''),
      contextWindow
    });
  }

  // Fallback parse desktop anchors if mobile blocks omitted something
  if (tags.length === 0) {
    const deskRe = new RegExp(`href="/library/(${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:[^"]+)"`, 'g');
    let dm;
    while ((dm = deskRe.exec(html)) !== null) {
      const fullTag = decodeHtml(dm[1]);
      if (seen.has(fullTag)) continue;
      seen.add(fullTag);
      const shortTag = fullTag.split(':').slice(1).join(':');
      const isCloudTag = shortTag === 'cloud' || shortTag.endsWith('-cloud');
      tags.push({
        tag: fullTag,
        shortTag,
        isLatest: shortTag === 'latest',
        isCloud: isCloudTag,
        sizeGB: 0,
        minSizeGB: 0,
        sizeText: isCloudTag ? 'Cloud' : '',
        contextWindow: ''
      });
    }
  }

  // Keep concise list: prioritize latest badge, :latest tag, parameter tags, and :cloud tag
  const chosen = [];
  const chosenSet = new Set();
  const addTag = (t) => {
    if (!t || chosenSet.has(t.tag)) return;
    chosenSet.add(t.tag);
    chosen.push(t);
  };

  addTag(tags.find((t) => t.isLatest));
  addTag(tags.find((t) => t.shortTag === 'latest'));
  // Standard clean param tags without long quant suffixes first
  tags
    .filter((t) => !t.isCloud && /^[a-z0-9.]+$/i.test(t.shortTag))
    .slice(0, 8)
    .forEach(addTag);
  // Any remaining tags up to 10
  tags.filter((t) => !t.isCloud).slice(0, Math.max(0, 10 - chosen.length)).forEach(addTag);
  // Include cloud tag if present
  addTag(tags.find((t) => t.isCloud));

  return chosen;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapWithConcurrency(items, concurrency, workerFn) {
  const results = new Array(items.length);
  let idx = 0;
  let errorCount = 0;
  async function runner() {
    while (idx < items.length) {
      const cur = idx++;
      try {
        results[cur] = await workerFn(items[cur], cur);
      } catch (err) {
        errorCount++;
        if (errorCount <= 5) console.warn(`  [WARN] worker ${cur} (${items[cur] && items[cur].id}): ${err.message}`);
        results[cur] = null;
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runner());
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log('[OPF Catalog Sync] Fetching models from https://ollama.com/search ...');
  const modelMap = new Map();

  // Crawl pages sorted by popular and newest/default so we capture full library with popularity rank
  const crawlQueries = [
    { label: 'popular', buildUrl: (p) => (p === 1 ? 'https://ollama.com/search?o=popular' : `https://ollama.com/search?o=popular&page=${p}`) },
    { label: 'default', buildUrl: (p) => (p === 1 ? 'https://ollama.com/search' : `https://ollama.com/search?page=${p}`) }
  ];

  for (const mode of crawlQueries) {
    for (let page = 1; page <= 25; page++) {
      const url = mode.buildUrl(page);
      const res = await fetchUrl(url, page > 1 ? { 'HX-Request': 'true' } : {});
      if (res.status !== 200) break;
      const cards = parseSearchPageCards(res.body);
      if (cards.length === 0) break;

      let addedOnPage = 0;
      cards.forEach((c, i) => {
        const rank = mode.label === 'popular' ? (page - 1) * 20 + i + 1 : 9999;
        const existing = modelMap.get(c.id);
        if (!existing) {
          c.popularRank = rank;
          modelMap.set(c.id, c);
          addedOnPage++;
        } else {
          existing.popularRank = Math.min(existing.popularRank || 9999, rank);
          if (!existing.pullsCount && c.pullsCount) {
            existing.pullsCount = c.pullsCount;
            existing.pullsText = c.pullsText;
          }
          if (!existing.description && c.description) existing.description = c.description;
          c.capabilities.forEach((cap) => {
            if (!existing.capabilities.includes(cap)) existing.capabilities.push(cap);
          });
          c.paramSizes.forEach((ps) => {
            if (!existing.paramSizes.includes(ps)) existing.paramSizes.push(ps);
          });
          existing.isCloud = existing.isCloud || c.isCloud;
          existing.isLocal = existing.isLocal || c.isLocal;
        }
      });
      console.log(`  [${mode.label}] page ${page}: ${cards.length} models (${addedOnPage} new, total ${modelMap.size})`);
      if (!/data-has-more="true"/i.test(res.body) && cards.length < 20) break;
    }
  }

  // Merge cloud API tags for exact cloud capabilities & byte sizes where available
  try {
    const apiTagsRes = await fetchUrl('https://ollama.com/api/tags');
    if (apiTagsRes.status === 200) {
      const apiJson = JSON.parse(apiTagsRes.body);
      for (const am of apiJson.models || []) {
        const baseName = am.name.split(':')[0];
        const existing = modelMap.get(baseName);
        if (existing) {
          existing.isCloud = true;
          if (Array.isArray(am.capabilities)) {
            am.capabilities.forEach((cap) => {
              if (cap !== 'completion' && !existing.capabilities.includes(cap)) {
                existing.capabilities.push(cap);
              }
            });
          }
          if (am.size > 0 && !existing.apiSizeGB) {
            existing.apiSizeGB = Number((am.size / (1024 * 1024 * 1024)).toFixed(1));
          }
        }
      }
    }
  } catch (err) {
    console.warn('[OPF Catalog Sync] Notice fetching /api/tags:', err.message);
  }

  const allModels = Array.from(modelMap.values());
  console.log(`[OPF Catalog Sync] Fetching exact tag sizes for ${allModels.length} models...`);

  let completed = 0;
  let statusNon200 = 0;
  await mapWithConcurrency(allModels, 6, async (model) => {
    let r = await fetchUrl(`https://ollama.com/library/${encodeURIComponent(model.id)}/tags`);
    if (r.status === 429 || r.status >= 500) {
      await sleep(1200);
      r = await fetchUrl(`https://ollama.com/library/${encodeURIComponent(model.id)}/tags`);
    }
    if (r.status !== 200) {
      statusNon200++;
      if (statusNon200 <= 5) console.warn(`  [WARN] ${model.id}/tags HTTP ${r.status}`);
    }
    if (r.status === 200) {
      const tags = parseModelTagsHtml(model.id, r.body);
      if (tags.length > 0) {
        model.tags = tags;
        model.hasLocal = tags.some((t) => !t.isCloud);
        model.hasCloud = model.isCloud || tags.some((t) => t.isCloud);
        model.isLocal = model.hasLocal;
        model.isCloud = model.hasCloud;
        const primaryLocal = tags.find((t) => !t.isCloud && t.isLatest) || tags.find((t) => !t.isCloud && t.sizeGB > 0) || tags[0];
        model.defaultTag = primaryLocal ? primaryLocal.tag : model.id;
        model.defaultSizeGB = primaryLocal && primaryLocal.sizeGB > 0 ? primaryLocal.sizeGB : (model.apiSizeGB || 0);
        model.defaultSizeText = primaryLocal ? (primaryLocal.sizeText || (model.defaultSizeGB ? `${model.defaultSizeGB} GB` : 'Cloud')) : 'Cloud';
        if (!model.contextWindow && primaryLocal && primaryLocal.contextWindow) {
          model.contextWindow = primaryLocal.contextWindow;
          model.contextTokens = parseAbbrevNumber(primaryLocal.contextWindow);
        }
      }
    }
    if (!model.tags || model.tags.length === 0) {
      const fallbackGB = model.paramSizes[0] ? parseParamHintToGB(model.paramSizes[0]) : (model.apiSizeGB || 0);
      const isCloudOnly = model.isCloud && (!model.paramSizes || model.paramSizes.length === 0);
      model.isLocal = !isCloudOnly;
      model.defaultTag = isCloudOnly ? `${model.id}:cloud` : `${model.id}:latest`;
      model.defaultSizeGB = isCloudOnly ? 0 : (fallbackGB || 0);
      model.defaultSizeText = isCloudOnly ? 'Cloud' : (fallbackGB ? `~${fallbackGB} GB` : 'Unknown');
      model.tags = [
        {
          tag: model.defaultTag,
          shortTag: isCloudOnly ? 'cloud' : 'latest',
          isLatest: !isCloudOnly,
          isCloud: isCloudOnly,
          sizeGB: model.defaultSizeGB,
          minSizeGB: model.defaultSizeGB,
          sizeText: model.defaultSizeText,
          contextWindow: model.contextWindow || ''
        }
      ];
    }
    completed++;
    if (completed % 40 === 0 || completed === allModels.length) {
      console.log(`  Processed ${completed}/${allModels.length} model tag pages...`);
    }
  });

  // Sort default catalog by popularity
  allModels.sort((a, b) => (a.popularRank || 9999) - (b.popularRank || 9999) || b.pullsCount - a.pullsCount);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    schema_version: 1,
    source: 'https://ollama.com/search',
    synced_at: new Date().toISOString(),
    model_count: allModels.length,
    models: allModels
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`[OPF Catalog Sync] Wrote ${allModels.length} models to ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024).toFixed(1)} KB).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[OPF Catalog Sync] Fatal error:', err);
    process.exit(1);
  });
