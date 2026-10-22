import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  logLevel: 'error',
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL('../backend/app/services', import.meta.url)),
    emptyOutDir: false,
    minify: true,
    target: 'node20',
    ssr: 'src/vbalang/headless.ts',
    rollupOptions: { output: { entryFileNames: 'vba_runner.mjs', format: 'es', codeSplitting: false } },
  },
});
