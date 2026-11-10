/**
 * Local GGUF Layer & VRAM Inspector (org.community.local-vram-analyzer)
 * Endorsed Community Plugin (AI + Moderator Audited)
 */

export function activate() {
  return {
    id: 'org.community.local-vram-analyzer',
    calculateKvCacheMb({ layers = 48, kvHeads = 8, headDim = 128, contextLength = 32768, fp16 = true }) {
      const bytesPerElem = fp16 ? 2 : 1;
      const totalBytes = 2 * layers * kvHeads * headDim * contextLength * bytesPerElem;
      return Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
    }
  };
}

export default { activate };
