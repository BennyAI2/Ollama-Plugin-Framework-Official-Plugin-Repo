# Ollama Plugin Framework (OPF) — Official Plugin Source Repository

Official and Community-Endorsed plugin registry for the **Ollama Plugin Framework (OPF)**.

OPF ships with **Zero Default Bloat** (0 pre-installed plugins) and uses a **Synology Package Center** source architecture combined with a **Bukkit/Spigot-style Plugin Compatibility Update Gate**.

---

## 📦 Live Source Manifest URLs

Add these sources inside the Ollama Desktop **`Plugins -> Sources`** tab (registered by default in OPF):

| Source Tier | Manifest URL |
| :--- | :--- |
| **OPF Official Plugins** (`opf-official`) | `https://raw.githubusercontent.com/BennyAI2/Ollama-Plugin-Framework-Official-Plugin-Repo/main/official-source.json` |
| **OPF Endorsed Community** (`opf-endorsed`) | `https://raw.githubusercontent.com/BennyAI2/Ollama-Plugin-Framework-Official-Plugin-Repo/main/community-endorsed.json` |

---

## 🧩 Available Plugins

### 1. Local Models Manager & Updater (`com.opf.local-models-manager`)
- **Tier**: `official`
- **Category**: Model Management
- **Capabilities**:
  - Displays locally available Ollama models (`/api/tags`) with **Date Pulled**, **Current Update Version** (digest), and **Latest Update Version**.
  - **Update Button**: Active & clickable when a model update is available (streams `/api/pull` progress live); greyed out (`disabled`) when the model is already up to date.
  - **Remove Button**: Removes a local model via `DELETE /api/delete` with inline confirmation.

### 2. Smooth-Load GPU Prep & Model Throttler (`com.opf.smooth-load-throttler`)
- **Tier**: `official`
- **Category**: Engine & GPU Optimization
- **Capabilities**:
  - Hooks into OPF's Programmable Engine Intercept Gateway (`127.0.0.1:11434 -> 11436`) on cold model loads (`onBeforeColdModelLoad`).
  - Inserts a configurable `1200ms` pre-allocation settle window so Windows desktop applications can smoothly migrate off dedicated GPU memory onto CPU/iGPU before Ollama allocates VRAM.
  - Injects gradual warm-up batch sizing (`num_batch: 128`) and low-priority I/O flags so loading 14B–70B models never freezes the Windows desktop or spikes fans.

### 2. Model Library & Manifest Explorer (`com.opf.model-library-viewer`)
- **Tier**: `official`
- **Category**: Model Management
- **Capabilities**:
  - Inspects installed Ollama models (`/api/tags`), quantization levels, parameter counts, digest hashes, and active VRAM residency (`/api/ps`).

### 3. Ollama Live Server & Runner Diagnostics (`com.opf.server-terminal-logs`)
- **Tier**: `official`
- **Category**: Diagnostics
- **Capabilities**:
  - Streams live OPF Engine Gateway intercept telemetry, cold-load settle timings, and runner status directly inside the Plugins panel.

### 4. Local VRAM & Quantization Fit Analyzer (`org.community.local-vram-analyzer`)
- **Tier**: `endorsed`
- **Category**: Utilities
- **Capabilities**:
  - Calculates ideal GGUF quantization (`Q4_K_M`, `Q5_K_M`, `Q8_0`) and KV-cache context window fit for your GPU VRAM budget.
  - Demonstrates OPF's **Bukkit-style Update Gate**: currently verified through Ollama `v0.40.16` (blocks auto-updating to `v0.40.17` until updated, disabled, or force-overridden).

---

## 🛡️ Bukkit-Style Compatibility Gate & Automated CI

1. **Git-Diff Smart Version Bumper ([`.github/workflows/ollama-release-watcher.yml`](.github/workflows/ollama-release-watcher.yml))**:
   - Runs every 6 hours to check new releases of `ollama/ollama`.
   - Compares changed files in `ollama/ollama` against each plugin's declared `watch_paths` (e.g., `api/types.go`, `server/routes.go`, `llm/memory.go`).
   - Automatically bumps `verified_ollama_versions` and `max_tested_ollama_version` when a plugin's watched paths are untouched.

2. **Dual Frontier AI & Static AST Security Auditor ([`.github/workflows/plugin-security-audit.yml`](.github/workflows/plugin-security-audit.yml))**:
   - Audits every PR and commit via [`scripts/ai-security-auditor.js`](scripts/ai-security-auditor.js).
   - Enforces the **OPF Privacy Airlock** (blocks any access to `~/.ollama/id_ed25519`, SSH keys, undeclared network hosts, or `child_process` / `eval`).
   - Verifies that every plugin entry in `official-source.json` and `community-endorsed.json` matches the exact **SHA-256** hash of its `index.js` bundle.
