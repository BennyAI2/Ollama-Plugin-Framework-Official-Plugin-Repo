/**
 * OPF Official Plugin: Ollama Library Explorer (com.opf.ollama-library-explorer)
 * In-app viewer for the online Ollama model library with Local/Cloud & capability filters,
 * model size attributes, live local hardware compatibility scoring, inline % pull progress,
 * and already-pulled replacement buttons.
 */

(function() {
  const PLUGIN_ID = 'com.opf.ollama-library-explorer';
  const CATALOG_URL = 'https://raw.githubusercontent.com/BennyAI2/Ollama-Plugin-Framework-Official-Plugin-Repo/main/catalog/ollama-library.json';
  const CATALOG_CACHE_KEY = '__opf_ollama_library_catalog_v1';

  const CAPABILITY_FILTERS = [
    { id: 'tools', label: 'Tools' },
    { id: 'thinking', label: 'Thinking' },
    { id: 'vision', label: 'Vision' },
    { id: 'embedding', label: 'Embedding' },
    { id: 'decision', label: 'Decision' },
    { id: 'audio', label: 'Audio' }
  ];

  const SIZE_FILTERS = [
    { id: '', label: 'Any Size' },
    { id: '8', label: 'Up to 8 GB' },
    { id: '16', label: 'Up to 16 GB' },
    { id: '32', label: 'Up to 32 GB' },
    { id: '64', label: 'Up to 64 GB' },
    { id: 'over64', label: 'Over 64 GB' }
  ];

  const SORT_OPTIONS = [
    { id: 'popular', label: 'Sort: Popular' },
    { id: 'compat', label: 'Sort: Best Hardware Fit' },
    { id: 'size_asc', label: 'Sort: Smallest Size' },
    { id: 'context', label: 'Sort: Context Window' },
    { id: 'newest', label: 'Sort: Newest' },
    { id: 'name', label: 'Sort: Name (A-Z)' }
  ];

  const state = {
    loading: false,
    error: null,
    notice: '',
    syncedAt: '',
    models: [],
    localModels: {},
    localFamilyCounts: {},
    runningModels: [],
    selectedTagByModel: {},
    pulling: {},
    hardware: {
      detected: false,
      devices: [],
      vramGB: 0,
      gpuName: 'Detecting...',
      backend: '',
      ramGB: 0,
      ramCapped: false,
      effectiveRamGB: 16,
      cores: 0
    },
    filters: {
      query: '',
      where: 'any',
      capabilities: [],
      maxSize: '',
      sort: 'popular',
      limit: 60
    }
  };

  function injectPluginStyles() {
    if (document.getElementById('opf-lib-styles')) return;
    const style = document.createElement('style');
    style.id = 'opf-lib-styles';
    const rawCss = `
      .opf-lib-hw-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; background: #1f1f1f; border: 1px solid #333333; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; }
      .opf-lib-hw-left { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 12px; color: #d4d4d4; line-height: 18px; }
      .opf-lib-hw-dot { width: 8px; height: 8px; border-radius: 9999px; background: #4ade80; flex-shrink: 0; }
      .opf-lib-hw-dot-warn { background: #fbbf24; }
      .opf-lib-filters-panel { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .opf-lib-filter-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
      .opf-lib-search-wrap { flex: 1; min-width: 220px; position: relative; }
      .opf-lib-seg { display: inline-flex; align-items: center; background: #171717; border: 1px solid #333333; border-radius: 8px; padding: 3px; gap: 2px; }
      .opf-lib-seg-btn { padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500; color: #a3a3a3; background: transparent; border: none; cursor: pointer; line-height: 16px; transition: background 0.15s, color 0.15s; }
      .opf-lib-seg-btn:hover { color: #ffffff; }
      .opf-lib-seg-active { background: #333333; color: #ffffff; }
      .opf-lib-cap-group { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
      .opf-lib-cap-pill { display: inline-flex; align-items: center; gap: 5px; padding: 5px 11px; border-radius: 9999px; font-size: 12px; font-weight: 500; line-height: 16px; border: 1px solid #383838; background: #1c1c1c; color: #a3a3a3; cursor: pointer; transition: all 0.15s; }
      .opf-lib-cap-pill:hover { border-color: #525252; color: #f5f5f5; }
      .opf-lib-cap-pill-on { background: #ffffff; color: #0a0a0a; border-color: #ffffff; }
      .opf-lib-select-sm { background: #171717; border: 1px solid #383838; border-radius: 8px; padding: 6px 10px; font-size: 12px; color: #e5e5e5; line-height: 16px; outline: none; cursor: pointer; }
      .opf-lib-tag-select { background: #1f1f1f; border: 1px solid #383838; border-radius: 6px; padding: 3px 8px; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #e5e5e5; line-height: 16px; outline: none; cursor: pointer; max-width: 190px; }
      .opf-lib-tag-select:focus { border-color: #737373; }
      .opf-lib-model-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
      .opf-lib-badge-cap { background: #1e293b; color: #93c5fd; border: 1px solid #1e3a8a; }
      .opf-lib-badge-cloud { background: #0c2d3e; color: #38bdf8; border: 1px solid #155e75; }
      .opf-lib-badge-local { background: #262626; color: #d4d4d4; border: 1px solid #3f3f46; }
      .opf-lib-badge-pulled { background: #143326; color: #6ee7b7; border: 1px solid #166534; }
      .opf-lib-desc { font-size: 12px; color: #a3a3a3; line-height: 17px; margin-top: 4px; max-width: 440px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .opf-lib-meta-line { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 6px; font-size: 11px; color: #737373; line-height: 16px; }
      .opf-lib-score-wrap { display: flex; flex-direction: column; gap: 4px; min-width: 132px; }
      .opf-lib-score-top { display: flex; align-items: center; gap: 6px; }
      .opf-lib-score-pill { display: inline-flex; align-items: center; justify-content: center; padding: 2px 7px; border-radius: 6px; font-size: 11px; font-weight: 600; line-height: 15px; font-variant-numeric: tabular-nums; }
      .opf-lib-score-label { font-size: 11px; font-weight: 500; line-height: 15px; }
      .opf-lib-score-track { width: 100%; height: 4px; border-radius: 9999px; background: #2a2a2a; overflow: hidden; }
      .opf-lib-score-fill { height: 100%; border-radius: 9999px; transition: width 0.2s; }
      .opf-lib-score-sub { font-size: 11px; color: #737373; line-height: 15px; }
      .opf-lib-progress-box { position: relative; display: inline-flex; align-items: center; justify-content: space-between; gap: 6px; min-width: 122px; height: 30px; padding: 0 8px 0 10px; border-radius: 8px; background: #1c2432; border: 1px solid #2563eb; overflow: hidden; vertical-align: middle; }
      .opf-lib-progress-fill { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(59, 130, 246, 0.35); transition: width 0.15s linear; pointer-events: none; }
      .opf-lib-progress-text { position: relative; z-index: 1; font-size: 12px; font-weight: 600; color: #93c5fd; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .opf-lib-cancel-btn { position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 4px; border: none; background: rgba(255,255,255,0.08); color: #cbd5e1; font-size: 13px; line-height: 1; cursor: pointer; padding: 0; }
      .opf-lib-cancel-btn:hover { background: rgba(239,68,68,0.35); color: #ffffff; }
      .opf-lib-btn-pulled { background: #122920; color: #6ee7b7; border: 1px solid #166534; padding: 7px 14px; }
      .opf-lib-btn-pulled:hover { background: #16362a; border-color: #22c55e; }
      .opf-lib-footer-bar { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; padding-top: 12px; border-top: 1px solid #2a2a2a; font-size: 12px; color: #a3a3a3; }
    `;
    style.textContent = rawCss.replace(/(\.opf-lib-[a-z0-9_-]+)/g, '$1:not(#\\#):not(#\\#):not(#\\#):not(#\\#)');
    document.head.appendChild(style);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function makeSafeId(str) {
    return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  async function ollamaFetch(endpoint, options) {
    try {
      const res = await fetch(endpoint, options);
      if (res.ok || res.status < 500) return res;
    } catch (e) {}
    return fetch('http://127.0.0.1:11434' + endpoint, options);
  }

  function parseVramStringToGB(vramVal) {
    if (typeof vramVal === 'number' && !isNaN(vramVal)) {
      return vramVal > 100000 ? vramVal / (1024 * 1024 * 1024) : vramVal;
    }
    const m = String(vramVal || '').trim().match(/^(\d+(?:\.\d+)?)\s*(TiB|TB|GiB|GB|MiB|MB)$/i);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const u = m[2].toLowerCase();
    if (u === 'tib' || u === 'tb') return n * 1024;
    if (u === 'gib' || u === 'gb') return n;
    return n / 1024;
  }

  function cleanWebGlRenderer(raw) {
    if (!raw) return '';
    let s = String(raw);
    const angleMatch = s.match(/ANGLE\s*\([^,]+,\s*([^,(]+?)(?:\s*\(|Direct3D|OpenGL|Vulkan|,)/i);
    if (angleMatch && angleMatch[1]) s = angleMatch[1];
    return s.replace(/\s+/g, ' ').trim();
  }

  async function detectLocalHardware() {
    const hw = {
      detected: true,
      devices: [],
      vramGB: 0,
      gpuName: '',
      backend: '',
      ramGB: typeof navigator !== 'undefined' && navigator.deviceMemory ? Number(navigator.deviceMemory) : 0,
      ramCapped: typeof navigator !== 'undefined' && Number(navigator.deviceMemory) === 8,
      effectiveRamGB: typeof navigator !== 'undefined' && navigator.deviceMemory
        ? (Number(navigator.deviceMemory) >= 8 ? 16 : Number(navigator.deviceMemory))
        : 16,
      cores: typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? Number(navigator.hardwareConcurrency) : 0
    };

    try {
      const res = await fetch('/api/v1/inference-compute');
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.inferenceComputes) ? data.inferenceComputes : [];
        hw.devices = list;
        let vramSum = 0;
        const libs = [];
        list.forEach((d) => {
          const gb = parseVramStringToGB(d.vram);
          if (gb > 0) vramSum += gb;
          if (d.library && !libs.includes(d.library)) libs.push(d.library);
          if (!hw.gpuName && d.name) hw.gpuName = d.name;
        });
        hw.vramGB = Number(vramSum.toFixed(1));
        hw.backend = libs.join(' / ');
      }
    } catch (e) {}

    // Enrich friendly GPU marketing name from WebGL / WebGPU if Ollama only reported e.g. "CUDA0"
    let friendlyGpu = '';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          friendlyGpu = cleanWebGlRenderer(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        }
      }
    } catch (e) {}

    if (!friendlyGpu && typeof navigator !== 'undefined' && navigator.gpu && navigator.gpu.requestAdapter) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter && adapter.info) {
          friendlyGpu = adapter.info.description || adapter.info.device || adapter.info.architecture || '';
        }
      } catch (e) {}
    }

    if (friendlyGpu && (!hw.gpuName || /^CUDA\d+$|^ROCm\d+$|^GPU\d+$/i.test(hw.gpuName))) {
      hw.gpuName = hw.backend ? friendlyGpu + ' (' + hw.backend + ')' : friendlyGpu;
    } else if (!hw.gpuName) {
      hw.gpuName = hw.vramGB > 0 ? (hw.backend || 'Local GPU') : 'CPU Inference Only';
    } else if (hw.backend && !hw.gpuName.includes(hw.backend)) {
      hw.gpuName = hw.gpuName + ' (' + hw.backend + ')';
    }

    state.hardware = hw;
  }

  function getActiveTagForModel(model) {
    const tags = Array.isArray(model.tags) && model.tags.length > 0
      ? model.tags
      : [{ tag: model.defaultTag || (model.id + ':latest'), shortTag: 'latest', isCloud: !!model.isCloud, sizeGB: model.defaultSizeGB || 0, sizeText: model.defaultSizeText || '' }];

    const savedTag = state.selectedTagByModel[model.id];
    if (savedTag) {
      const matched = tags.find((t) => t.tag === savedTag);
      if (matched) return matched;
    }

    const sizeBucket = state.filters.maxSize;
    if (sizeBucket) {
      const matchingBySize = findTagMatchingSizeBucket(tags, sizeBucket);
      if (matchingBySize) return matchingBySize;
    }

    if (state.filters.where === 'cloud') {
      const cloudTag = tags.find((t) => t.isCloud);
      if (cloudTag) return cloudTag;
    }

    // Prefer a locally pulled variant matching the active locality filter
    for (let i = 0; i < tags.length; i++) {
      if (state.filters.where === 'local' && tags[i].isCloud) continue;
      if (isTagPulled(model, tags[i])) return tags[i];
    }

    if (state.filters.where === 'local') {
      const localTag = tags.find((t) => !t.isCloud && t.isLatest) || tags.find((t) => !t.isCloud);
      if (localTag) return localTag;
    }

    return tags.find((t) => t.tag === model.defaultTag) || tags[0];
  }

  function findTagMatchingSizeBucket(tags, bucket) {
    const localTags = tags.filter((t) => !t.isCloud && t.sizeGB > 0);
    if (!bucket) return localTags[0] || tags[0];
    if (bucket === 'over64') return localTags.find((t) => t.sizeGB > 64) || null;
    const limit = parseFloat(bucket);
    return localTags.find((t) => t.sizeGB <= limit) || null;
  }

  function isTagPulled(model, tagObj) {
    if (!tagObj || !tagObj.tag) return false;
    const key = tagObj.tag.toLowerCase();
    if (state.localModels[key]) return true;
    // Handle :latest alias equivalence (e.g. ollama stores gemma4:latest or gemma4:e4b)
    if (tagObj.isLatest && state.localModels[(model.id + ':latest').toLowerCase()]) return true;
    if (tagObj.shortTag === 'latest') {
      const flaggedLatest = (model.tags || []).find((t) => t.isLatest && t.tag !== tagObj.tag);
      if (flaggedLatest && state.localModels[flaggedLatest.tag.toLowerCase()]) return true;
    }
    return false;
  }

  function getPulledLocalInfo(model, tagObj) {
    if (!tagObj || !tagObj.tag) return null;
    const exact = state.localModels[tagObj.tag.toLowerCase()];
    if (exact) return exact;
    if (tagObj.isLatest) return state.localModels[(model.id + ':latest').toLowerCase()] || null;
    return null;
  }

  function computeCompatibility(model, tagObj) {
    const hw = state.hardware;
    if (tagObj && tagObj.isCloud) {
      return {
        score: 100,
        label: 'Cloud Ready',
        tier: 'cloud',
        color: '#38bdf8',
        bg: '#0c273a',
        detail: 'Runs via Ollama Cloud (0 GB VRAM)'
      };
    }

    const rawMaxGB = tagObj && tagObj.sizeGB > 0 ? tagObj.sizeGB : (model.defaultSizeGB || 0);
    const rawMinGB = tagObj && tagObj.minSizeGB > 0 ? tagObj.minSizeGB : rawMaxGB;
    const sizeGB = rawMinGB > 0 && rawMinGB < rawMaxGB
      ? Number((rawMinGB * 0.7 + rawMaxGB * 0.3).toFixed(2))
      : rawMaxGB;
    if (!sizeGB || sizeGB <= 0) {
      return {
        score: -1,
        label: 'Size Unknown',
        tier: 'unknown',
        color: '#a3a3a3',
        bg: '#262626',
        detail: 'Tag size metadata unavailable'
      };
    }

    // Weight footprint + ~18% KV cache & runtime context overhead
    const neededGB = Number((sizeGB * 1.18 + 0.5).toFixed(1));

    if (hw.vramGB > 0) {
      const ratio = neededGB / hw.vramGB;
      if (ratio <= 0.72) {
        return {
          score: Math.min(99, Math.round(99 - ratio * 10)),
          label: 'Optimal Fit',
          tier: 'optimal',
          color: '#4ade80',
          bg: '#112e1d',
          detail: 'Needs ~' + neededGB + ' GB / ' + hw.vramGB + ' GiB VRAM'
        };
      }
      if (ratio <= 0.95) {
        return {
          score: Math.round(81 + ((0.95 - ratio) / 0.23) * 10),
          label: 'Full GPU Fit',
          tier: 'great',
          color: '#4ade80',
          bg: '#112e1d',
          detail: 'Needs ~' + neededGB + ' GB / ' + hw.vramGB + ' GiB VRAM'
        };
      }
      if (ratio <= 1.10) {
        return {
          score: Math.round(68 + ((1.10 - ratio) / 0.15) * 12),
          label: 'Tight VRAM',
          tier: 'tight',
          color: '#a3e635',
          bg: '#212e11',
          detail: 'Needs ~' + neededGB + ' GB / ' + hw.vramGB + ' GiB VRAM'
        };
      }
      const hybridBudget = hw.vramGB + hw.effectiveRamGB * 0.75;
      if (neededGB <= hybridBudget) {
        const spillRatio = (neededGB - hw.vramGB) / Math.max(1, hw.effectiveRamGB * 0.75);
        return {
          score: Math.max(40, Math.round(65 - spillRatio * 25)),
          label: 'GPU + RAM Split',
          tier: 'hybrid',
          color: '#fbbf24',
          bg: '#33240c',
          detail: 'Exceeds ' + hw.vramGB + ' GiB VRAM; partial CPU offload'
        };
      }
      return {
        score: Math.max(10, Math.round(36 - Math.min(26, (neededGB - hybridBudget) * 0.5))),
        label: 'Exceeds HW',
        tier: 'heavy',
        color: '#f87171',
        bg: '#3b1515',
        detail: 'Needs ~' + neededGB + ' GB (heavy memory pressure)'
      };
    }

    // CPU-only / Unified RAM fallback when no dedicated GPU VRAM reported
    const ramBudget = hw.effectiveRamGB || 16;
    if (neededGB <= ramBudget * 0.45) {
      return {
        score: 70,
        label: 'CPU Fit',
        tier: 'hybrid',
        color: '#fbbf24',
        bg: '#33240c',
        detail: 'Needs ~' + neededGB + ' GB RAM (no GPU VRAM detected)'
      };
    }
    if (neededGB <= ramBudget * 0.80) {
      return {
        score: 48,
        label: 'Tight RAM',
        tier: 'hybrid',
        color: '#fbbf24',
        bg: '#33240c',
        detail: 'Needs ~' + neededGB + ' GB / ~' + ramBudget + ' GB RAM'
      };
    }
    return {
      score: 16,
      label: 'Exceeds RAM',
      tier: 'heavy',
      color: '#f87171',
      bg: '#3b1515',
      detail: 'Needs ~' + neededGB + ' GB (exceeds system RAM)'
    };
  }

  async function refreshLocalState() {
    const map = {};
    const fam = {};
    try {
      const res = await ollamaFetch('/api/tags', { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        (data.models || []).forEach((m) => {
          const full = (m.name || m.model || '').toLowerCase();
          if (!full) return;
          map[full] = m;
          const base = full.split(':')[0];
          fam[base] = (fam[base] || 0) + 1;
        });
      }
    } catch (e) {}
    state.localModels = map;
    state.localFamilyCounts = fam;

    try {
      const psRes = await ollamaFetch('/api/ps', { method: 'GET' });
      if (psRes.ok) {
        const psData = await psRes.json();
        state.runningModels = Array.isArray(psData.models) ? psData.models : [];
      }
    } catch (e) {}
  }

  function mergeLiveCloudModels(modelsList, liveCloudList) {
    if (!Array.isArray(liveCloudList) || liveCloudList.length === 0) return modelsList;
    const byId = {};
    modelsList.forEach((m) => { byId[m.id] = m; });

    liveCloudList.forEach((cm) => {
      const fullTag = cm.model || cm.name || '';
      if (!fullTag) return;
      const baseName = fullTag.split(':')[0];
      const caps = Array.isArray(cm.capabilities) ? cm.capabilities.filter((c) => c !== 'completion') : [];
      const target = byId[baseName];
      if (target) {
        target.isCloud = true;
        caps.forEach((c) => {
          if (!target.capabilities.includes(c)) target.capabilities.push(c);
        });
        if (!Array.isArray(target.tags)) target.tags = [];
        const cloudTagName = fullTag.includes(':') ? fullTag : (baseName + ':cloud');
        if (!target.tags.some((t) => t.isCloud)) {
          target.tags.push({
            tag: cloudTagName,
            shortTag: 'cloud',
            isLatest: false,
            isCloud: true,
            sizeGB: 0,
            minSizeGB: 0,
            sizeText: 'Cloud',
            contextWindow: target.contextWindow || ''
          });
        }
      } else {
        const created = {
          id: baseName,
          name: baseName,
          description: 'Live model listed on Ollama Cloud registry.',
          updatedRel: 'live',
          updatedIso: cm.modified_at || null,
          capabilities: caps,
          isCloud: true,
          isLocal: false,
          pullsText: '',
          pullsCount: 0,
          tagCount: 1,
          contextWindow: '',
          contextTokens: 0,
          paramSizes: [],
          popularRank: 150,
          defaultTag: fullTag.includes(':') ? fullTag : (baseName + ':cloud'),
          defaultSizeGB: 0,
          defaultSizeText: 'Cloud',
          tags: [
            {
              tag: fullTag.includes(':') ? fullTag : (baseName + ':cloud'),
              shortTag: 'cloud',
              isLatest: false,
              isCloud: true,
              sizeGB: 0,
              minSizeGB: 0,
              sizeText: 'Cloud',
              contextWindow: ''
            }
          ]
        };
        byId[baseName] = created;
        modelsList.push(created);
      }
    });
    return modelsList;
  }

  async function loadCatalog(forceRemote) {
    state.loading = true;
    state.error = null;
    let catalogLoaded = false;

    if (!forceRemote) {
      try {
        const cachedRaw = localStorage.getItem(CATALOG_CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (Array.isArray(cached.models) && cached.models.length > 0) {
            state.models = cached.models;
            state.syncedAt = cached.synced_at || '';
            catalogLoaded = true;
          }
        }
      } catch (e) {}
    }

    try {
      const res = await fetch(CATALOG_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('Catalog HTTP ' + res.status);
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        state.models = data.models;
        state.syncedAt = data.synced_at || '';
        localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(data));
        catalogLoaded = true;
      }
    } catch (err) {
      if (!catalogLoaded) {
        state.error = 'Failed to fetch online model catalog: ' + err.message;
      }
    }

    try {
      const cloudRes = await fetch('/api/v1/models/cloud');
      if (cloudRes.ok) {
        const cloudData = await cloudRes.json();
        state.models = mergeLiveCloudModels(state.models.slice(), cloudData.models || []);
      }
    } catch (e) {}

    state.loading = false;
  }

  function getFilteredAndSortedModels() {
    const q = state.filters.query.trim().toLowerCase();
    const where = state.filters.where;
    const reqCaps = state.filters.capabilities;
    const maxSize = state.filters.maxSize;
    const sortBy = state.filters.sort;

    const filtered = state.models.filter((m) => {
      if (where === 'local' && !m.isLocal) return false;
      if (where === 'cloud' && !m.isCloud) return false;

      if (reqCaps.length > 0) {
        const mCaps = Array.isArray(m.capabilities) ? m.capabilities : [];
        for (let i = 0; i < reqCaps.length; i++) {
          if (!mCaps.includes(reqCaps[i])) return false;
        }
      }

      if (maxSize) {
        if (!m.isLocal) return false;
        const matchedTag = findTagMatchingSizeBucket(m.tags || [], maxSize);
        if (!matchedTag) return false;
      }

      if (q) {
        const nameMatch = (m.name || '').toLowerCase().includes(q);
        const descMatch = (m.description || '').toLowerCase().includes(q);
        const capMatch = (m.capabilities || []).some((c) => c.toLowerCase().includes(q));
        const tagMatch = (m.tags || []).some((t) => t.tag.toLowerCase().includes(q));
        if (!nameMatch && !descMatch && !capMatch && !tagMatch) return false;
      }

      return true;
    });

    const scored = filtered.map((m) => {
      const activeTag = getActiveTagForModel(m);
      const compat = computeCompatibility(m, activeTag);
      const pulled = isTagPulled(m, activeTag);
      return { model: m, activeTag, compat, pulled };
    });

    scored.sort((a, b) => {
      if (sortBy === 'compat') {
        const sa = a.compat.score;
        const sb = b.compat.score;
        if (sb !== sa) return sb - sa;
      } else if (sortBy === 'size_asc') {
        const za = a.activeTag.isCloud ? 9999 : (a.activeTag.sizeGB || 9998);
        const zb = b.activeTag.isCloud ? 9999 : (b.activeTag.sizeGB || 9998);
        if (za !== zb) return za - zb;
      } else if (sortBy === 'context') {
        const ca = a.model.contextTokens || 0;
        const cb = b.model.contextTokens || 0;
        if (cb !== ca) return cb - ca;
      } else if (sortBy === 'newest') {
        const da = a.model.updatedIso ? Date.parse(a.model.updatedIso) : 0;
        const db = b.model.updatedIso ? Date.parse(b.model.updatedIso) : 0;
        if (db !== da) return db - da;
      } else if (sortBy === 'name') {
        return a.model.name.localeCompare(b.model.name);
      }
      return (a.model.popularRank || 9999) - (b.model.popularRank || 9999) || (b.model.pullsCount || 0) - (a.model.pullsCount || 0);
    });

    return scored;
  }

  function renderActionCellHtml(model, tagObj) {
    const tagName = tagObj.tag;
    const pullingInfo = state.pulling[tagName];

    if (pullingInfo) {
      const pct = Math.max(0, Math.min(100, pullingInfo.pct || 0));
      const titleTip = escapeHtml((pullingInfo.status || 'Downloading') + ' (' + pct + '%)');
      return `
        <div class="opf-lib-progress-box" title="${titleTip}">
          <div class="opf-lib-progress-fill" style="width:${pct}%;"></div>
          <span class="opf-lib-progress-text">Pulling ${pct}%</span>
          <button type="button" data-lib-cancel="${escapeHtml(tagName)}" class="opf-lib-cancel-btn" title="Cancel pull">&times;</button>
        </div>`;
    }

    if (isTagPulled(model, tagObj)) {
      return `<button type="button" data-lib-pulled="${escapeHtml(tagName)}" class="opf-btn opf-lib-btn-pulled" title="Already pulled locally">&#10003; Pulled</button>`;
    }

    return `<button type="button" data-lib-pull="${escapeHtml(tagName)}" class="opf-btn opf-btn-primary">Pull</button>`;
  }

  function mountLibraryPage(container) {
    if (!container) return;
    injectPluginStyles();

    function updateActionCellDom(tagName) {
      const cell = container.querySelector('#opf-lib-act-' + makeSafeId(tagName));
      if (!cell) return;
      const modelSlug = tagName.split(':')[0];
      const model = state.models.find((m) => m.id === modelSlug);
      if (!model) return;
      const tagObj = getActiveTagForModel(model);
      if (tagObj.tag !== tagName) return;
      cell.innerHTML = renderActionCellHtml(model, tagObj);
      bindActionButtons(cell);
    }

    async function initiatePull(tagName) {
      if (state.pulling[tagName]) return;
      const controller = new AbortController();
      const layerProgress = {};
      state.pulling[tagName] = {
        status: 'Pulling manifest...',
        pct: 0,
        controller
      };
      state.error = null;
      updateActionCellDom(tagName);

      try {
        const res = await ollamaFetch('/api/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tagName, stream: true }),
          signal: controller.signal
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);

        if (res.body && res.body.getReader) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split('\n');
            buffer = parts.pop() || '';
            for (let i = 0; i < parts.length; i++) {
              const line = parts[i].trim();
              if (!line) continue;
              try {
                const msg = JSON.parse(line);
                if (msg.error) throw new Error(msg.error);
                if (msg.digest && msg.total > 0) {
                  layerProgress[msg.digest] = {
                    total: msg.total,
                    completed: Math.min(msg.total, msg.completed || 0)
                  };
                  let sumTotal = 0;
                  let sumCompleted = 0;
                  Object.keys(layerProgress).forEach((k) => {
                    sumTotal += layerProgress[k].total;
                    sumCompleted += layerProgress[k].completed;
                  });
                  if (sumTotal > 0) {
                    const computed = Math.min(99, Math.round((sumCompleted / sumTotal) * 100));
                    state.pulling[tagName].pct = Math.max(state.pulling[tagName].pct, computed);
                  }
                } else if (msg.total > 0 && msg.completed >= 0) {
                  const computed = Math.min(99, Math.round((msg.completed / msg.total) * 100));
                  state.pulling[tagName].pct = Math.max(state.pulling[tagName].pct, computed);
                }
                if (msg.status) {
                  state.pulling[tagName].status = msg.status;
                  if (msg.status === 'success') state.pulling[tagName].pct = 100;
                }
                updateActionCellDom(tagName);
              } catch (parseErr) {
                if (parseErr && parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
              }
            }
          }
        }

        if (state.pulling[tagName]) {
          state.pulling[tagName].pct = 100;
          state.pulling[tagName].status = 'success';
          updateActionCellDom(tagName);
        }
        await refreshLocalState();
        delete state.pulling[tagName];
        state.notice = 'Successfully pulled ' + tagName + '.';
        renderTableOnly();
      } catch (err) {
        delete state.pulling[tagName];
        if (err && err.name === 'AbortError') {
          state.notice = 'Cancelled pull for ' + tagName + '.';
        } else {
          state.error = 'Pull failed for ' + tagName + ': ' + (err ? err.message : 'Unknown error');
        }
        renderTableOnly();
      }
    }

    function cancelPull(tagName) {
      const p = state.pulling[tagName];
      if (p && p.controller) p.controller.abort();
    }

    function handlePulledClick(tagName) {
      const modelsSidebarBtn = document.getElementById('opf-dyn-nav-models');
      if (modelsSidebarBtn) {
        modelsSidebarBtn.click();
        return;
      }
      const slug = tagName.split(':')[0];
      const model = state.models.find((m) => m.id === slug);
      const localObj = model ? getPulledLocalInfo(model, { tag: tagName, isLatest: true }) : state.localModels[tagName.toLowerCase()];
      const sizeStr = localObj && localObj.size ? ((localObj.size / (1024 * 1024 * 1024)).toFixed(2) + ' GB') : 'installed';
      state.notice = tagName + ' is already pulled locally (' + sizeStr + ').';
      renderAlertsOnly();
    }

    function bindActionButtons(scope) {
      scope.querySelectorAll('[data-lib-pull]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-lib-pull');
          if (target) initiatePull(target);
        });
      });
      scope.querySelectorAll('[data-lib-cancel]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-lib-cancel');
          if (target) cancelPull(target);
        });
      });
      scope.querySelectorAll('[data-lib-pulled]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const target = btn.getAttribute('data-lib-pulled');
          if (target) handlePulledClick(target);
        });
      });
    }

    function renderAlertsOnly() {
      const alertBox = container.querySelector('#opf-lib-alerts');
      if (!alertBox) return;
      let html = '';
      if (state.error) html += `<div class="opf-alert opf-alert-danger">${escapeHtml(state.error)}</div>`;
      if (state.notice) html += `<div class="opf-alert opf-alert-info">${escapeHtml(state.notice)}</div>`;
      alertBox.innerHTML = html;
    }

    function renderTableOnly() {
      renderAlertsOnly();
      const tbody = container.querySelector('#opf-lib-tbody');
      const footer = container.querySelector('#opf-lib-footer');
      const summary = container.querySelector('#opf-lib-count');
      if (!tbody) return;

      const entries = getFilteredAndSortedModels();
      if (summary) summary.textContent = '(' + entries.length + ')';

      const capLimit = state.filters.query.trim() ? entries.length : state.filters.limit;
      const visible = entries.slice(0, capLimit);

      if (visible.length === 0) {
        const msg = state.loading
          ? 'Loading online Ollama library catalog...'
          : 'No models match the active filters. Try clearing capabilities or switching Where to Any.';
        tbody.innerHTML = `<tr><td colspan="4" class="opf-table-empty">${escapeHtml(msg)}</td></tr>`;
      } else {
        tbody.innerHTML = visible.map(({ model, activeTag, compat }) => {
          const safeRowActId = 'opf-lib-act-' + makeSafeId(activeTag.tag);
          const famCount = state.localFamilyCounts[model.id.toLowerCase()] || 0;

          const localityBadge = activeTag.isCloud
            ? '<span class="opf-badge opf-lib-badge-cloud">cloud</span>'
            : (model.isCloud
                ? '<span class="opf-badge opf-lib-badge-local">local &amp; cloud</span>'
                : '<span class="opf-badge opf-lib-badge-local">local</span>');

          const capPills = (model.capabilities || []).map((c) => `<span class="opf-badge opf-lib-badge-cap">${escapeHtml(c)}</span>`).join('');
          const localFamBadge = famCount > 0
            ? `<span class="opf-badge opf-lib-badge-pulled">${famCount} local</span>`
            : '';

          const tagsList = Array.isArray(model.tags) && model.tags.length > 0 ? model.tags : [activeTag];
          const tagSelectorHtml = tagsList.length > 1
            ? `<select data-lib-tag-model="${escapeHtml(model.id)}" class="opf-lib-tag-select">${tagsList.map((t) => `<option value="${escapeHtml(t.tag)}" ${t.tag === activeTag.tag ? 'selected' : ''}>${escapeHtml(t.shortTag)}${t.sizeText ? ' (' + escapeHtml(t.sizeText) + ')' : ''}</option>`).join('')}</select>`
            : `<span class="opf-mono">:${escapeHtml(activeTag.shortTag)}</span>`;

          const sizePrimary = activeTag.isCloud
            ? 'Cloud'
            : (activeTag.sizeText || (activeTag.sizeGB > 0 ? activeTag.sizeGB + ' GB' : 'Unknown'));
          const ctxLabel = activeTag.contextWindow || model.contextWindow;
          const sizeSub = activeTag.isCloud
            ? ('0 B download' + (ctxLabel ? ' &bull; ' + ctxLabel + ' ctx' : ''))
            : ((activeTag.shortTag && activeTag.shortTag !== 'latest' ? activeTag.shortTag : (model.paramSizes[0] || 'default')) + (ctxLabel ? ' &bull; ' + ctxLabel + ' ctx' : ''));

          const scoreBadgeText = compat.score >= 0 ? (compat.score + '%') : 'N/A';
          const scoreFillWidth = compat.score >= 0 ? Math.max(6, Math.min(100, compat.score)) : 0;

          return `
            <tr>
              <td>
                <div class="opf-lib-model-head">
                  <span class="opf-table-primary">${escapeHtml(model.name)}</span>
                  ${localityBadge}
                  ${capPills}
                  ${localFamBadge}
                </div>
                <div class="opf-lib-desc">${escapeHtml(model.description || 'Ollama model registry package.')}</div>
                <div class="opf-lib-meta-line">
                  ${tagSelectorHtml}
                  ${model.pullsText ? `<span>${escapeHtml(model.pullsText)} pulls</span>` : ''}
                  ${model.updatedRel ? `<span>Updated ${escapeHtml(model.updatedRel)}</span>` : ''}
                  ${model.tagCount ? `<span>${model.tagCount} tags</span>` : ''}
                </div>
              </td>
              <td>
                <div class="opf-table-primary">${escapeHtml(sizePrimary)}</div>
                <div class="opf-table-sub">${sizeSub}</div>
              </td>
              <td>
                <div class="opf-lib-score-wrap">
                  <div class="opf-lib-score-top">
                    <span class="opf-lib-score-pill" style="background:${compat.bg};color:${compat.color};">${scoreBadgeText}</span>
                    <span class="opf-lib-score-label" style="color:${compat.color};">${escapeHtml(compat.label)}</span>
                  </div>
                  <div class="opf-lib-score-track">
                    <div class="opf-lib-score-fill" style="width:${scoreFillWidth}%;background:${compat.color};"></div>
                  </div>
                  <div class="opf-lib-score-sub">${escapeHtml(compat.detail)}</div>
                </div>
              </td>
              <td id="${safeRowActId}" class="opf-table-actions">
                ${renderActionCellHtml(model, activeTag)}
              </td>
            </tr>`;
        }).join('');
      }

      if (footer) {
        const remaining = entries.length - visible.length;
        const syncLabel = state.syncedAt ? ('Catalog synced ' + new Date(state.syncedAt).toLocaleDateString()) : 'Live catalog';
        footer.innerHTML = `
          <span>Showing ${visible.length} of ${entries.length} matching models &bull; ${escapeHtml(syncLabel)}</span>
          ${remaining > 0
            ? `<div class="opf-btn-group">
                 <button id="opf-lib-show-more" class="opf-btn opf-btn-secondary">Show +60 More</button>
                 <button id="opf-lib-show-all" class="opf-btn opf-btn-secondary">Show All (${entries.length})</button>
               </div>`
            : ''}
        `;
        const moreBtn = footer.querySelector('#opf-lib-show-more');
        if (moreBtn) moreBtn.addEventListener('click', () => { state.filters.limit += 60; renderTableOnly(); });
        const allBtn = footer.querySelector('#opf-lib-show-all');
        if (allBtn) allBtn.addEventListener('click', () => { state.filters.limit = Math.max(500, entries.length); renderTableOnly(); });
      }

      tbody.querySelectorAll('[data-lib-tag-model]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const mid = sel.getAttribute('data-lib-tag-model');
          state.selectedTagByModel[mid] = sel.value;
          renderTableOnly();
        });
      });

      bindActionButtons(tbody);
    }

    function renderFilterControlsState() {
      container.querySelectorAll('[data-lib-where]').forEach((btn) => {
        const active = btn.getAttribute('data-lib-where') === state.filters.where;
        btn.className = active ? 'opf-lib-seg-btn opf-lib-seg-active' : 'opf-lib-seg-btn';
      });
      container.querySelectorAll('[data-lib-cap]').forEach((btn) => {
        const cap = btn.getAttribute('data-lib-cap');
        const active = state.filters.capabilities.includes(cap);
        btn.className = active ? 'opf-lib-cap-pill opf-lib-cap-pill-on' : 'opf-lib-cap-pill';
      });
      const resetBtn = container.querySelector('#opf-lib-reset');
      if (resetBtn) {
        const hasFilters = !!(state.filters.query || state.filters.where !== 'any' || state.filters.capabilities.length > 0 || state.filters.maxSize);
        resetBtn.style.display = hasFilters ? 'inline-flex' : 'none';
      }
    }

    function renderHardwareBar() {
      const bar = container.querySelector('#opf-lib-hw-bar');
      if (!bar) return;
      const hw = state.hardware;
      const dotClass = hw.vramGB > 0 ? 'opf-lib-hw-dot' : 'opf-lib-hw-dot opf-lib-hw-dot-warn';
      const vramTxt = hw.vramGB > 0 ? (hw.vramGB.toFixed(1) + ' GiB VRAM') : 'No dedicated VRAM detected (CPU fallback)';
      const ramTxt = hw.ramGB > 0 ? (hw.ramCapped ? '8+ GB RAM' : (hw.ramGB + ' GB RAM')) : '';
      const cpuTxt = hw.cores > 0 ? (hw.cores + ' CPU threads') : '';
      const parts = [vramTxt, ramTxt, cpuTxt].filter(Boolean).join(' &bull; ');

      bar.innerHTML = `
        <div class="opf-lib-hw-left">
          <span class="${dotClass}"></span>
          <span><b>Local Hardware:</b> ${escapeHtml(hw.gpuName)} &bull; ${parts}</span>
        </div>
        <span class="opf-badge opf-badge-neutral">${Object.keys(state.localModels).length} Pulled Locally</span>
      `;
    }

    function renderShell() {
      const sidebarOpen = !!document.querySelector('nav');
      container.innerHTML = `
        <div id="opf-library-header" class="opf-header">
          <h1 class="opf-header-title" style="padding-left:${sidebarOpen ? '24px' : '64px'};">Library</h1>
          <div class="opf-header-badges">
            <span class="opf-badge-header">ollama.com Catalog</span>
          </div>
        </div>
        <div class="opf-scroll">
          <div class="opf-container-wide">
            <div class="opf-card">
              <div class="opf-card-row" style="margin-bottom:14px;">
                <div class="opf-card-title">Online Ollama Model Library <span id="opf-lib-count" class="opf-card-version"></span></div>
                <div class="opf-btn-group">
                  <button id="opf-lib-reset" class="opf-btn opf-btn-secondary" style="display:none;">Reset Filters</button>
                  <button id="opf-lib-refresh" class="opf-btn opf-btn-primary">${state.loading ? 'Syncing...' : 'Sync Library'}</button>
                </div>
              </div>

              <div id="opf-lib-hw-bar" class="opf-lib-hw-bar"></div>

              <div class="opf-lib-filters-panel">
                <div class="opf-lib-filter-row">
                  <div class="opf-lib-search-wrap">
                    <input id="opf-lib-search" type="text" value="${escapeHtml(state.filters.query)}" placeholder="Search models by name, tag, or capability (e.g. gemma4, qwen, vision)..." class="opf-input" />
                  </div>
                  <div class="opf-lib-seg" role="group" aria-label="Environment filter">
                    <button type="button" data-lib-where="any" class="opf-lib-seg-btn opf-lib-seg-active">Any</button>
                    <button type="button" data-lib-where="local" class="opf-lib-seg-btn">Local</button>
                    <button type="button" data-lib-where="cloud" class="opf-lib-seg-btn">Cloud</button>
                  </div>
                  <select id="opf-lib-size-filter" class="opf-lib-select-sm" aria-label="Download size filter">
                    ${SIZE_FILTERS.map((s) => `<option value="${s.id}" ${s.id === state.filters.maxSize ? 'selected' : ''}>${s.label}</option>`).join('')}
                  </select>
                  <select id="opf-lib-sort" class="opf-lib-select-sm" aria-label="Sort models">
                    ${SORT_OPTIONS.map((o) => `<option value="${o.id}" ${o.id === state.filters.sort ? 'selected' : ''}>${o.label}</option>`).join('')}
                  </select>
                </div>

                <div class="opf-lib-cap-group">
                  <span style="font-size:12px;color:#8a8a8a;margin-right:4px;">Capabilities:</span>
                  ${CAPABILITY_FILTERS.map((c) => `<button type="button" data-lib-cap="${c.id}" class="opf-lib-cap-pill">${c.label}</button>`).join('')}
                </div>
              </div>

              <div id="opf-lib-alerts"></div>

              <div class="opf-table-wrap">
                <table class="opf-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Size</th>
                      <th>Hardware Fit</th>
                      <th style="text-align:right;">Action</th>
                    </tr>
                  </thead>
                  <tbody id="opf-lib-tbody"></tbody>
                </table>
              </div>
              <div id="opf-lib-footer" class="opf-lib-footer-bar"></div>
            </div>
          </div>
        </div>
      `;

      const hdr = container.querySelector('#opf-library-header');
      if (hdr) {
        hdr.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'BUTTON' && window.drag) window.drag(); });
        hdr.addEventListener('dblclick', () => { if (window.doubleClick) window.doubleClick(); });
      }

      const searchInput = container.querySelector('#opf-lib-search');
      if (searchInput) {
        searchInput.addEventListener('input', () => {
          state.filters.query = searchInput.value;
          renderFilterControlsState();
          renderTableOnly();
        });
      }

      container.querySelectorAll('[data-lib-where]').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.filters.where = btn.getAttribute('data-lib-where') || 'any';
          state.filters.limit = 60;
          renderFilterControlsState();
          renderTableOnly();
        });
      });

      container.querySelectorAll('[data-lib-cap]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cap = btn.getAttribute('data-lib-cap');
          const idx = state.filters.capabilities.indexOf(cap);
          if (idx >= 0) state.filters.capabilities.splice(idx, 1);
          else state.filters.capabilities.push(cap);
          state.filters.limit = 60;
          renderFilterControlsState();
          renderTableOnly();
        });
      });

      const sizeSel = container.querySelector('#opf-lib-size-filter');
      if (sizeSel) {
        sizeSel.addEventListener('change', () => {
          state.filters.maxSize = sizeSel.value;
          state.filters.limit = 60;
          renderFilterControlsState();
          renderTableOnly();
        });
      }

      const sortSel = container.querySelector('#opf-lib-sort');
      if (sortSel) {
        sortSel.addEventListener('change', () => {
          state.filters.sort = sortSel.value;
          renderTableOnly();
        });
      }

      const resetBtn = container.querySelector('#opf-lib-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          state.filters.query = '';
          state.filters.where = 'any';
          state.filters.capabilities = [];
          state.filters.maxSize = '';
          state.filters.limit = 60;
          if (searchInput) searchInput.value = '';
          if (sizeSel) sizeSel.value = '';
          renderFilterControlsState();
          renderTableOnly();
        });
      }

      const refreshBtn = container.querySelector('#opf-lib-refresh');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
          state.notice = '';
          refreshBtn.textContent = 'Syncing...';
          await Promise.all([detectLocalHardware(), refreshLocalState(), loadCatalog(true)]);
          refreshBtn.textContent = 'Sync Library';
          renderHardwareBar();
          renderTableOnly();
        });
      }

      renderHardwareBar();
      renderFilterControlsState();
      renderTableOnly();
    }

    renderShell();
    Promise.all([detectLocalHardware(), refreshLocalState(), loadCatalog(false)]).then(() => {
      const refreshBtn = container.querySelector('#opf-lib-refresh');
      if (refreshBtn) refreshBtn.textContent = 'Sync Library';
      renderHardwareBar();
      renderTableOnly();
    });
  }

  if (typeof window !== 'undefined' && window.OPF && typeof window.OPF.registerSidebarPage === 'function') {
    window.OPF.registerSidebarPage({
      id: 'library',
      pluginId: PLUGIN_ID,
      title: 'Library',
      iconSvg: '<svg class="h-5 w-5 stroke-current flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5a17.92 17.92 0 0 1-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" /></svg>',
      render: mountLibraryPage
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mountLibraryPage, computeCompatibility };
  }
})();
