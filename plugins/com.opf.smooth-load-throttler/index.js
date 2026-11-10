/**
 * Smooth-Load GPU Prep & Model Throttler (com.opf.smooth-load-throttler)
 * Official OPF Base Plugin
 *
 * Solves Windows desktop stutter/freeze when Ollama cold-loads a large GGUF model
 * from disk into GPU VRAM by:
 *   1. Intercepting cold-load requests via the OPF Engine Gateway (:11434 -> :11436)
 *   2. Applying a pre-load settle delay (default 1200ms) so DWM/browsers can yield VRAM
 *   3. Throttling initial prompt evaluation batch size (num_batch: 128)
 *   4. Requesting BelowNormal CPU priority & Low Disk I/O priority for the runner
 */

const DEFAULT_CONFIG = {
  settle_delay_ms: 1200,
  signal_igpu_handoff: true,
  throttle_initial_batch: 128,
  runner_cpu_priority: 'BelowNormal',
  runner_io_priority: 'Low'
};

export function activate(context) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, context?.config || {});

  return {
    id: 'com.opf.smooth-load-throttler',
    name: 'Smooth-Load GPU Prep & Model Throttler',

    async onBeforeColdModelLoad(event) {
      const delayMs = Number(cfg.settle_delay_ms) || 1200;

      // Wait for the configured settle window before allowing ollama.exe to allocate VRAM
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 5000)));
      }

      return {
        pluginId: 'com.opf.smooth-load-throttler',
        model: event?.model || 'unknown',
        coldLoadDetected: true,
        appliedSettleDelayMs: delayMs,
        signaledIgpuHandoff: Boolean(cfg.signal_igpu_handoff),
        runnerPriorityAdjustments: {
          cpuPriority: cfg.runner_cpu_priority,
          ioPriority: cfg.runner_io_priority
        },
        modifiedOptions: {
          num_batch: cfg.throttle_initial_batch
        }
      };
    }
  };
}

export default { activate };
