/** Graphics quality. Default low for browser/Pages; ?quality=high restores full path. */
export type QualityMode = 'low' | 'high';

function readQuality(): QualityMode {
  try {
    const q = new URLSearchParams(window.location.search).get('quality');
    if (q === 'high' || q === 'ultra') return 'high';
    if (q === 'low') return 'low';
  } catch {
    /* ignore */
  }
  return 'low';
}

export const QUALITY: QualityMode = readQuality();
export const LOW_SPEC = QUALITY === 'low';
