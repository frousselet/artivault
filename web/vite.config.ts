import { defineConfig } from 'vite';

// In development the SPA runs on :5173 and proxies backend paths to the Node
// server on :8787, so everything is same-origin as in production.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/artifact': 'http://127.0.0.1:8787',
      '/mcp': 'http://127.0.0.1:8787',
      '/oauth': 'http://127.0.0.1:8787',
      '/.well-known': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
