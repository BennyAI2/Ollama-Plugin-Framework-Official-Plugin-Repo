/**
 * Live Ollama Server Terminal View (com.opf.server-terminal-logs)
 * Official OPF Base Plugin
 */

export function activate() {
  return {
    id: 'com.opf.server-terminal-logs',
    parseRunnerTelemetry(logLine) {
      const match = String(logLine || '').match(/eval rate:\s+([\d.]+)\s+tokens\/s/i);
      return {
        raw: logLine,
        tokensPerSec: match ? Number(match[1]) : null
      };
    }
  };
}

export default { activate };
