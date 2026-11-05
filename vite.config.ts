import { defineConfig } from 'vite';

function devEndpoint(): { host: string; port: number } {
  const raw = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5188';
  try {
    const url = new URL(raw);
    return { host: url.hostname || '127.0.0.1', port: Number(url.port || 5188) };
  } catch {
    return { host: '127.0.0.1', port: 5188 };
  }
}

const dev = devEndpoint();

export default defineConfig({
  base: '/monkeytest/',
  server: {
    host: dev.host,
    port: dev.port,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4188,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
