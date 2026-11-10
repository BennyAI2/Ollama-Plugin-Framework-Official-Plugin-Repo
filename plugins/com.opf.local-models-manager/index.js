/**
 * OPF Official Plugin: Local Models Library (com.opf.local-models-manager)
 * Uses the standardized OPF Design System classes (.opf-page, .opf-card, .opf-table, .opf-btn, .opf-badge)
 * provided by the OPF Host so typography, spacing, and alignment match native Ollama 1:1.
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
        ? '<tr><td colspan="5" class="opf-table-empty">' + (pluginState.loading ? 'Loading local models from Ollama (/api/tags)...' : 'No local models found in Ollama.') + '</td></tr>'
        : pluginState.models.map((m) => {
            const isUpdating = pluginState.updatingModel === m.name;
            const isConfirmingRemove = pluginState.confirmRemoveModel === m.name;
            const updateBtnDisabled = !m.hasUpdate || isUpdating;

            return `
              <tr>
                <td>
                  <div class="opf-table-primary">${m.name}</div>
                  <div class="opf-table-sub">${m.sizeFormatted}${m.paramSize ? ' &bull; ' + m.paramSize : ''} &bull; ${m.quantization}</div>
                </td>
                <td>${m.datePulled}</td>
                <td class="opf-mono">${m.currentVersion}</td>
                <td>
                  <div class="opf-mono" style="color:${m.hasUpdate ? '#fcd34d' : '#86efac'};">${m.latestVersion}</div>
                  <div class="opf-table-status" style="color:${m.hasUpdate ? '#f59e0b' : '#4ade80'};">
                    ${m.hasUpdate ? 'Update Available' : 'Up to Date'}
                  </div>
                </td>
                <td class="opf-table-actions">
                  <button data-update-model="${m.name}" ${updateBtnDisabled ? 'disabled' : ''} class="opf-btn ${updateBtnDisabled ? 'opf-btn-disabled' : 'opf-btn-primary'}">
                    ${isUpdating ? 'Updating...' : 'Update'}
                  </button>
                  ${isConfirmingRemove
                    ? `<button data-confirm-remove="${m.name}" class="opf-btn opf-btn-danger-solid">Confirm</button>
                       <button data-cancel-remove="${m.name}" class="opf-btn opf-btn-secondary">Cancel</button>`
                    : `<button data-remove-model="${m.name}" class="opf-btn opf-btn-danger">Remove</button>`
                  }
                </td>
              </tr>`;
          }).join('');

      container.innerHTML = `
        <div id="opf-models-header" class="opf-header">
          <h1 class="opf-header-title" style="padding-left:${sidebarOpen ? '24px' : '64px'};">Models</h1>
        </div>
        <div class="opf-scroll">
          <div class="opf-container-wide">
            <div class="opf-card">
              <div class="opf-card-row" style="margin-bottom:14px;">
                <div>
                  <div class="opf-card-title">Local Available Models (${pluginState.models.length})</div>
                  <div class="opf-card-desc" style="margin-top:4px;">Installed models on your system with Date Pulled, Current Update Version, Latest Update Version, Update, and Remove.</div>
                </div>
                <div class="opf-btn-group">
                  <button id="opf-lmm-check-updates" class="opf-btn opf-btn-secondary">${pluginState.checkingRemote ? 'Checking...' : 'Check for Updates'}</button>
                  <button id="opf-lmm-refresh" class="opf-btn opf-btn-primary">Refresh</button>
                </div>
              </div>
              ${pluginState.error ? `<div class="opf-alert opf-alert-danger">${pluginState.error}</div>` : ''}
              ${pluginState.updatingModel ? `<div class="opf-alert opf-alert-info">Updating <b>${pluginState.updatingModel}</b>: ${pluginState.updateStatusText}</div>` : ''}
              <div class="opf-table-wrap">
                <table class="opf-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Date Pulled</th>
                      <th>Current Version</th>
                      <th>Latest Version</th>
                      <th style="text-align:right;">Actions</th>
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
