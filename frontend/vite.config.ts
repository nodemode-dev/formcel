import { defineConfig } from 'vite';

const FRONTEND_PORT = Number(process.env.FORMCEL_WEB_PORT ?? 5199);
const PREVIEW_PORT = 5299;
const BACKEND_PORT = Number(process.env.FORMCEL_PORT ?? 8199);
const engine = { target: `http://127.0.0.1:${BACKEND_PORT}`, changeOrigin: true, ws: true };

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: FRONTEND_PORT,
    host: false,
    strictPort: true,
    proxy: { '/api': engine, '/mcp': engine },
    fs: { allow: ['.', '../docs'] },
  },
  preview: {
    port: PREVIEW_PORT,
    host: false,
    strictPort: true,
    proxy: { '/api': engine, '/mcp': engine },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});
