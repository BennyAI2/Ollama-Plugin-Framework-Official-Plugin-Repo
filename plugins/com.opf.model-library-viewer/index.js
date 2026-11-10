/**
 * Direct Ollama Model Library Explorer (com.opf.model-library-viewer)
 * Official OPF Base Plugin
 */

export function activate() {
  const featuredCatalog = [
    { name: 'gemma4:26b', parameters: '26B', quant: 'Q4_K_M', estVramGb: 16.5 },
    { name: 'qwen2.5-coder:14b', parameters: '14B', quant: 'Q4_K_M', estVramGb: 9.2 },
    { name: 'deepseek-r1:14b', parameters: '14B', quant: 'Q4_K_M', estVramGb: 9.4 },
    { name: 'llama3.3:70b', parameters: '70B', quant: 'Q4_K_M', estVramGb: 42.0 }
  ];

  return {
    id: 'com.opf.model-library-viewer',
    getFeaturedModels() {
      return featuredCatalog;
    },
    estimateVramFit(modelEntry, availableVramGb) {
      if (!modelEntry) return { fitsInVram: false };
      return {
        model: modelEntry.name,
        estVramGb: modelEntry.estVramGb,
        fitsInVram: availableVramGb >= modelEntry.estVramGb,
        recommendation: availableVramGb >= modelEntry.estVramGb
          ? '100% GPU Offload'
          : 'Partial CPU/GPU Split Required'
      };
    }
  };
}

export default { activate };
