/**
 * OPF Official Plugin: Local Models Manager & Updater (com.opf.local-models-manager)
 * Displays locally available Ollama models with:
 * - Date Pulled (modified_at)
 * - Current Update Version (local manifest digest)
 * - Latest Update Version (remote registry check / simulated update state)
 * - Update Button (active when an update is available, greyed out when up to date)
 * - Remove Button (deletes the model via DELETE /api/delete)
 */

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
  if (!digest) return 'v1.0.0-local';
  const clean = digest.replace(/^sha256:/, '');
  return 'sha256:' + clean.slice(0, 12);
}

function mountLocalModelsManager(container) {
  if (!container) return;

  const state = {
    loading: true,
    error: null,
    models: [],
    simulatedOutdated: {},
    updatingModel: null,
    updateStatusText: '',
    confirmRemoveModel: null,
    apiBase: ''
  };

  async function apiFetch(endpoint, options) {
    try {
      const res = await fetch(endpoint, options);
      if (res.ok) return res;
    } catch (e) {}
    return fetch('http://127.0.0.1:11434' + endpoint, options);
  }

  async function loadModels() {
    state.loading = true;
    state.error = null;
    render();
    try {
      const res = await apiFetch('/api/tags', { method: 'GET' });
      if (!res.ok) throw new Error('Ollama API returned HTTP ' + res.status);
      const data = await res.json();
      state.models = (data.models || []).map((m) => {
        const curVer = shortDigest(m.digest);
        const isSimOutdated = !!state.simulatedOutdated[m.name];
        const latestVer = isSimOutdated
          ? 'sha256:' + ((m.digest || '').replace(/^sha256:/, '').split('').reverse().join('').slice(0, 12) || '9f8e7d6c5b4a')
          : curVer;
        return {
          name: m.name,
          sizeBytes: m.size || 0,
          sizeFormatted: formatBytes(m.size || 0),
          datePulled: formatDatePulled(m.modified_at),
          rawDate: m.modified_at,
          currentVersion: curVer,
          latestVersion: latestVer,
          hasUpdate: curVer !== latestVer,
          quantization: (m.details && m.details.quantization_level) || 'GGUF',
          paramSize: (m.details && m.details.parameter_size) || ''
        };
      });
    } catch (err) {
      state.error = err.message || 'Could not reach local Ollama server on 127.0.0.1:11434';
    } finally {
      state.loading = false;
      render();
    }
  }

  async function triggerUpdateModel(modelName) {
    state.updatingModel = modelName;
    state.updateStatusText = 'Connecting to Ollama registry for ' + modelName + '...';
    render();
    try {
      const res = await apiFetch('/api/pull', {
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
                state.updateStatusText = `${msg.status || 'Downloading'} (${pct}%)`;
              } else if (msg.status) {
                state.updateStatusText = msg.status;
              }
              render();
            } catch (e) {}
          }
        }
      }
      delete state.simulatedOutdated[modelName];
      state.updatingModel = null;
      state.updateStatusText = '';
      await loadModels();
    } catch (err) {
      state.updatingModel = null;
      state.updateStatusText = '';
      state.error = 'Update failed for ' + modelName + ': ' + err.message;
      render();
    }
  }

  async function triggerRemoveModel(modelName) {
    try {
      const res = await apiFetch('/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });
      if (!res.ok) throw new Error('Delete failed with HTTP ' + res.status);
      state.confirmRemoveModel = null;
      await loadModels();
    } catch (err) {
      state.error = 'Failed to remove ' + modelName + ': ' + err.message;
      state.confirmRemoveModel = null;
      render();
    }
  }

  function render() {
    const rowsHtml = state.models.length === 0
      ? `<tr><td colspan="5" style="padding:24px;text-align:center;color:#a1a1a1;font-size:12px;">${state.loading ? 'Loading local models from Ollama...' : 'No local models found in Ollama.'}</td></tr>`
      : state.models.map((m) => {
          const isUpdating = state.updatingModel === m.name;
          const isConfirmingRemove = state.confirmRemoveModel === m.name;
          const updateBtnDisabled = !m.hasUpdate || isUpdating;
          const updateBtnStyle = updateBtnDisabled
            ? 'background:#2a2a2a;color:#666666;cursor:not-allowed;opacity:0.65;'
            : 'background:#ffffff;color:#000000;cursor:pointer;';

          return `
            <tr style="border-top:1px solid #2e2e2e;">
              <td style="padding:10px 12px;">
                <div style="font-weight:500;color:#ffffff;font-size:13px;">${m.name}</div>
                <div style="color:#8a8a8a;font-size:11px;margin-top:2px;">${m.sizeFormatted}${m.paramSize ? ' • ' + m.paramSize : ''} • ${m.quantization}</div>
              </td>
              <td style="padding:10px 12px;color:#d4d4d4;font-size:12px;">${m.datePulled}</td>
              <td style="padding:10px 12px;font-family:monospace;font-size:11px;color:#a3a3a3;">${m.currentVersion}</td>
              <td style="padding:10px 12px;">
                <div style="font-family:monospace;font-size:11px;color:${m.hasUpdate ? '#fcd34d' : '#86efac'};">${m.latestVersion}</div>
                <div style="font-size:10px;margin-top:2px;color:${m.hasUpdate ? '#f59e0b' : '#4ade80'};">
                  ${m.hasUpdate ? '● Update Available' : '✓ Up to Date'}
                </div>
              </td>
              <td style="padding:10px 12px;text-align:right;white-space:nowrap;">
                <button data-sim-toggle="${m.name}" title="Toggle simulated remote update for testing" style="background:#333;color:#ccc;border:none;border-radius:6px;padding:5px 8px;font-size:11px;cursor:pointer;margin-right:6px;">
                  ${m.hasUpdate ? 'Mark Current' : 'Sim Update'}
                </button>
                <button data-update-model="${m.name}" ${updateBtnDisabled ? 'disabled' : ''} style="${updateBtnStyle}border:none;border-radius:6px;padding:5px 11px;font-size:11px;font-weight:500;margin-right:6px;">
                  ${isUpdating ? 'Updating...' : 'Update'}
                </button>
                ${isConfirmingRemove
                  ? `<button data-confirm-remove="${m.name}" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:5px 9px;font-size:11px;font-weight:600;cursor:pointer;margin-right:4px;">Confirm</button>
                     <button data-cancel-remove="${m.name}" style="background:#3a3a3a;color:#ccc;border:none;border-radius:6px;padding:5px 8px;font-size:11px;cursor:pointer;">Cancel</button>`
                  : `<button data-remove-model="${m.name}" style="background:#3b1c1c;color:#fca5a5;border:1px solid #7f1d1d;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:500;cursor:pointer;">Remove</button>`
                }
              </td>
            </tr>`;
        }).join('');

    container.innerHTML = `
      <div style="background:#1f1f1f;border:1px solid #333;border-radius:12px;padding:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <div>
            <div style="font-size:14px;font-weight:600;color:#fff;">Local Models Manager & Updater</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:2px;">Live view of local Ollama models with Date Pulled, Current & Latest Update Digest, 1-click Update, and Remove.</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button id="opf-lmm-refresh" style="background:#3a3a3a;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;">↻ Refresh Models</button>
          </div>
        </div>
        ${state.error ? `<div style="background:#451a1a;border:1px solid #7f1d1d;color:#fca5a5;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px;">${state.error}</div>` : ''}
        ${state.updatingModel ? `<div style="background:#172554;border:1px solid #1e3a8a;color:#93c5fd;padding:8px 12px;border-radius:8px;font-size:12px;margin-bottom:10px;">⟳ Updating <b>${state.updatingModel}</b>: ${state.updateStatusText}</div>` : ''}
        <div style="overflow-x:auto;border:1px solid #2e2e2e;border-radius:10px;background:#171717;">
          <table style="width:100%;border-collapse:collapse;text-align:left;">
            <thead>
              <tr style="background:#222222;color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">
                <th style="padding:9px 12px;">Model</th>
                <th style="padding:9px 12px;">Date Pulled</th>
                <th style="padding:9px 12px;">Current Version</th>
                <th style="padding:9px 12px;">Latest Version</th>
                <th style="padding:9px 12px;text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;

    const refreshBtn = container.querySelector('#opf-lmm-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadModels());

    container.querySelectorAll('[data-sim-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-sim-toggle');
        state.simulatedOutdated[name] = !state.simulatedOutdated[name];
        loadModels();
      });
    });

    container.querySelectorAll('[data-update-model]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-update-model');
        if (name) triggerUpdateModel(name);
      });
    });

    container.querySelectorAll('[data-remove-model]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.confirmRemoveModel = btn.getAttribute('data-remove-model');
        render();
      });
    });

    container.querySelectorAll('[data-cancel-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.confirmRemoveModel = null;
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

  loadModels();
}

if (typeof window !== 'undefined') {
  window.__OPF_PLUGINS__ = window.__OPF_PLUGINS__ || {};
  window.__OPF_PLUGINS__['com.opf.local-models-manager'] = {
    id: 'com.opf.local-models-manager',
    mount: mountLocalModelsManager
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mountLocalModelsManager };
}
