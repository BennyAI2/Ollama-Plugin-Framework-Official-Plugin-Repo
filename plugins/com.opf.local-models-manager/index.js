/**
 * OPF Official Plugin: Local Models Library (com.opf.local-models-manager)
 * Dynamically downloaded and executed from the OPF Official Plugin Repo when installed.
 * Registers a "Models" navigation item in the left-hand sidebar via window.OPF.registerSidebarPage().
 * Uses 100% pure ASCII + explicit inline styles so it never depends on purged Tailwind classes.
 */

(function() {
  const PLUGIN_ID = 'com.opf.local-models-manager';

  function formatBytes(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return gb.toFixed(2) + ' GB';
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(1) + ' MB';
  }

  function formatDatePulled(isoStr) {
    if (!isoStr) return 'Unknown';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function shortDigest(digest) {
    if (!digest) return 'sha256:local';
    const clean = digest.replace(/^sha256:/, '');
    return 'sha256:' + clean.slice(0, 12);
  }

  const pluginState = {
    loading: false,
    checkingRemote: false,
    error: null,
    models: [],
    remoteDigests: {},
    updatingModel: null,
    updateStatusText: '',
    confirmRemoveModel: null
  };

  async function ollamaFetch(endpoint, options) {
    try {
      const res = await fetch(endpoint, options);
      if (res.ok) return res;
    } catch (e) {}
    return fetch('http://127.0.0.1:11434' + endpoint, options);
  }

  async function checkLatestRemoteDigest(modelName, localDigest) {
    try {
      const parts = modelName.split(':');
      const repo = parts[0].includes('/') ? parts[0] : 'library/' + parts[0];
      const tag = parts[1] || 'latest';
      const url = 'https://registry.ollama.ai/v2/' + repo + '/manifests/' + tag;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/vnd.docker.distribution.manifest.v2+json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.config && data.config.digest) {
          return shortDigest(data.config.digest);
        }
      }
    } catch (e) {}
    return shortDigest(localDigest);
  }

  function mountModelsPage(container) {
    if (!container) return;

    async function loadModels(checkRemote) {
      pluginState.loading = true;
      pluginState.error = null;
      render();
      try {
        const res = await ollamaFetch('/api/tags', { method: 'GET' });
        if (!res.ok) throw new Error('Ollama API returned HTTP ' + res.status);
        const data = await res.json();
        const rawModels = data.models || [];

        if (checkRemote) {
          pluginState.checkingRemote = true;
          render();
          for (const m of rawModels) {
            pluginState.remoteDigests[m.name] = await checkLatestRemoteDigest(m.name, m.digest);
          }
          pluginState.checkingRemote = false;
        }

        pluginState.models = rawModels.map((m) => {
          const curVer = shortDigest(m.digest);
          const latestVer = pluginState.remoteDigests[m.name] || curVer;
          return {
            name: m.name,
            sizeBytes: m.size || 0,
            sizeFormatted: formatBytes(m.size || 0),
            datePulled: formatDatePulled(m.modified_at),
            currentVersion: curVer,
            latestVersion: latestVer,
            hasUpdate: curVer !== latestVer,
            quantization: (m.details && m.details.quantization_level) || 'GGUF',
            paramSize: (m.details && m.details.parameter_size) || ''
          };
        });
      } catch (err) {
        pluginState.error = err.message || 'Could not reach local Ollama server on 127.0.0.1:11434';
      } finally {
        pluginState.loading = false;
        pluginState.checkingRemote = false;
        render();
      }
    }

    async function triggerUpdateModel(modelName) {
      pluginState.updatingModel = modelName;
      pluginState.updateStatusText = 'Connecting to Ollama registry for ' + modelName + '...';
      render();
      try {
        const res = await ollamaFetch('/api/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName, stream: true })
        });
        if (!res.ok) throw new Error('Pull failed with HTTP ' + res.status);

        if (res.body && res.body.getReader) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(Boolean);
            for (const line of lines) {
              try {
                const msg = JSON.parse(line);
                if (msg.total && msg.completed) {
                  const pct = Math.round((msg.completed / msg.total) * 100);
                  pluginState.updateStatusText = (msg.status || 'Downloading') + ' (' + pct + '%)';
                } else if (msg.status) {
                  pluginState.updateStatusText = msg.status;
                }
                render();
              } catch (e) {}
            }
          }
        }
        delete pluginState.remoteDigests[modelName];
        pluginState.updatingModel = null;
        pluginState.updateStatusText = '';
        await loadModels(false);
      } catch (err) {
        pluginState.updatingModel = null;
        pluginState.updateStatusText = '';
        pluginState.error = 'Update failed for ' + modelName + ': ' + err.message;
        render();
      }
    }

    async function triggerRemoveModel(modelName) {
      try {
        const res = await ollamaFetch('/api/delete', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName })
        });
        if (!res.ok) throw new Error('Delete failed with HTTP ' + res.status);
        pluginState.confirmRemoveModel = null;
        await loadModels(false);
      } catch (err) {
        pluginState.error = 'Failed to remove ' + modelName + ': ' + err.message;
        pluginState.confirmRemoveModel = null;
        render();
      }
    }

    function render() {
      const sidebarOpen = !!document.querySelector('nav');
      const rowsHtml = pluginState.models.length === 0
        ? '<tr><td colspan="5" style="padding:32px;text-align:center;color:#a1a1a1;font-size:12px;">' + (pluginState.loading ? 'Loading local models from Ollama (/api/tags)...' : 'No local models found in Ollama.') + '</td></tr>'
        : pluginState.models.map((m) => {
            const isUpdating = pluginState.updatingModel === m.name;
            const isConfirmingRemove = pluginState.confirmRemoveModel === m.name;
            const updateBtnDisabled = !m.hasUpdate || isUpdating;
            const updateBtnStyle = updateBtnDisabled
              ? 'background:#2e2e2e;color:#6b6b6b;cursor:not-allowed;'
              : 'background:#ffffff;color:#0a0a0a;cursor:pointer;';

            return `
              <tr style="border-top:1px solid #2e2e2e;">
                <td style="padding:12px 14px;">
                  <div style="font-weight:500;color:#ffffff;font-size:13px;">${m.name}</div>
                  <div style="color:#8a8a8a;font-size:11px;margin-top:2px;">${m.sizeFormatted}${m.paramSize ? ' &bull; ' + m.paramSize : ''} &bull; ${m.quantization}</div>
                </td>
                <td style="padding:12px 14px;color:#d4d4d4;font-size:12px;">${m.datePulled}</td>
                <td style="padding:12px 14px;font-family:monospace;font-size:11px;color:#a3a3a3;">${m.currentVersion}</td>
                <td style="padding:12px 14px;">
                  <div style="font-family:monospace;font-size:11px;color:${m.hasUpdate ? '#fcd34d' : '#86efac'};">${m.latestVersion}</div>
                  <div style="font-size:11px;margin-top:2px;color:${m.hasUpdate ? '#f59e0b' : '#4ade80'};">
                    ${m.hasUpdate ? 'Update Available' : 'Up to Date'}
                  </div>
                </td>
                <td style="padding:12px 14px;text-align:right;white-space:nowrap;">
                  <button data-update-model="${m.name}" ${updateBtnDisabled ? 'disabled' : ''} style="${updateBtnStyle}border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:500;margin-right:6px;">
                    ${isUpdating ? 'Updating...' : 'Update'}
                  </button>
                  ${isConfirmingRemove
                    ? `<button data-confirm-remove="${m.name}" style="background:#dc2626;color:#fff;border:none;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;margin-right:4px;">Confirm</button>
                       <button data-cancel-remove="${m.name}" style="background:#3a3a3a;color:#ccc;border:none;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;">Cancel</button>`
                    : `<button data-remove-model="${m.name}" style="background:#3b1c1c;color:#fca5a5;border:1px solid #7f1d1d;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:500;cursor:pointer;">Remove</button>`
                  }
                </td>
              </tr>`;
          }).join('');

      container.innerHTML = `
        <div id="opf-models-header" class="h-13 z-10 flex w-full flex-none items-center justify-between bg-white dark:bg-neutral-900 select-none" style="padding-right:24px;">
          <h1 class="${sidebarOpen ? 'pl-6' : 'pl-16'} transition-[padding-left] duration-300 font-rounded text-md font-medium dark:text-white">Models</h1>
        </div>
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <div class="mx-auto max-w-3xl space-y-4">
            <div class="rounded-xl p-4" style="background:#262626;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;">
                <div>
                  <div class="text-sm font-medium text-white">Local Available Models (${pluginState.models.length})</div>
                  <div class="text-xs text-neutral-400" style="margin-top:2px;">Installed models on your system with Date Pulled, Current Update Version, Latest Update Version, Update, and Remove.</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
                  <button id="opf-lmm-check-updates" style="background:#383838;color:#e5e5e5;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:500;cursor:pointer;">${pluginState.checkingRemote ? 'Checking...' : 'Check for Updates'}</button>
                  <button id="opf-lmm-refresh" style="background:#ffffff;color:#0a0a0a;border:none;border-radius:8px;padding:6px 14px;font-size:12px;font-weight:500;cursor:pointer;">Refresh</button>
                </div>
              </div>
              ${pluginState.error ? `<div style="background:#451a1a;border:1px solid #7f1d1d;color:#fca5a5;padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:12px;">${pluginState.error}</div>` : ''}
              ${pluginState.updatingModel ? `<div style="background:#172554;border:1px solid #1e3a8a;color:#93c5fd;padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:12px;">Updating <b>${pluginState.updatingModel}</b>: ${pluginState.updateStatusText}</div>` : ''}
              <div style="overflow-x:auto;border:1px solid #333333;border-radius:10px;background:#171717;">
                <table style="width:100%;border-collapse:collapse;text-align:left;">
                  <thead>
                    <tr style="background:#1f1f1f;color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">
                      <th style="padding:10px 14px;">Model</th>
                      <th style="padding:10px 14px;">Date Pulled</th>
                      <th style="padding:10px 14px;">Current Version</th>
                      <th style="padding:10px 14px;">Latest Version</th>
                      <th style="padding:10px 14px;text-align:right;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>${rowsHtml}</tbody>
                </table>
              </div>
            </div>
          </div>
        </div>`;

      const hdr = container.querySelector('#opf-models-header');
      if (hdr) {
        hdr.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'BUTTON' && window.drag) window.drag(); });
        hdr.addEventListener('dblclick', () => { if (window.doubleClick) window.doubleClick(); });
      }

      const refreshBtn = container.querySelector('#opf-lmm-refresh');
      if (refreshBtn) refreshBtn.addEventListener('click', () => loadModels(false));

      const checkBtn = container.querySelector('#opf-lmm-check-updates');
      if (checkBtn) checkBtn.addEventListener('click', () => loadModels(true));

      container.querySelectorAll('[data-update-model]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.getAttribute('data-update-model');
          if (name) triggerUpdateModel(name);
        });
      });

      container.querySelectorAll('[data-remove-model]').forEach((btn) => {
        btn.addEventListener('click', () => {
          pluginState.confirmRemoveModel = btn.getAttribute('data-remove-model');
          render();
        });
      });

      container.querySelectorAll('[data-cancel-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          pluginState.confirmRemoveModel = null;
          render();
        });
      });

      container.querySelectorAll('[data-confirm-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const name = btn.getAttribute('data-confirm-remove');
          if (name) triggerRemoveModel(name);
        });
      });
    }

    loadModels(false);
  }

  if (typeof window !== 'undefined' && window.OPF && typeof window.OPF.registerSidebarPage === 'function') {
    window.OPF.registerSidebarPage({
      id: 'models',
      pluginId: PLUGIN_ID,
      title: 'Models',
      iconSvg: '<svg class="h-5 w-5 stroke-current flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" /></svg>',
      render: mountModelsPage
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { mountModelsPage };
  }
})();
