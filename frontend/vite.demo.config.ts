import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const DEMO_PORT = 5297;
const SHARED = 'sales';
const PAGES: Record<string, { out: string; title: string }> = {
  sales: { out: '../demo', title: 'FormCel demo: A year of bike sales' },
  whatif: { out: '../demos/whatif', title: 'FormCel demo: Loan and savings what-if' },
  lab: { out: '../demos/lab', title: 'FormCel demo: Lab measurements' },
};
const WASM = process.env.FORMCEL_DEMO_WASM ?? fileURLToPath(new URL('./public/engine/formcel.wasm', import.meta.url));
const shim = (file: string): string => fileURLToPath(new URL(`../demo/src/shim/${file}`, import.meta.url));

const symbol = (cp: number): boolean => (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x1f000 && cp <= 0x1faff);
const unit = (n: number): string => `\\u${n.toString(16).toUpperCase().padStart(4, '0')}`;
const escape = (code: string, all = false): string => {
  let out = '';
  for (const ch of code) {
    const cp = ch.codePointAt(0) ?? 0;
    out += !(all ? cp > 0x7e : symbol(cp)) ? ch : cp > 0xffff ? unit(0xd800 + ((cp - 0x10000) >> 10)) + unit(0xdc00 + ((cp - 0x10000) & 0x3ff)) : unit(cp);
  }
  return out;
};

const inlineWorkers = (): Plugin => ({
  name: 'formcel-demo-workers',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.ts$/.test(id) || id.includes('node_modules')) return null;
    if (id.endsWith('/src/automation/tsAssist.ts')) {
      return `import { sharedWorker } from ${JSON.stringify(shim('workers.ts'))};\nimport 'virtual:formcel-demo-ts-worker';\n${code.replace("new Worker(new URL('./tsWorker.ts', import.meta.url), { type: 'module' })", "sharedWorker('ts-worker')")}`;
    }
    const found = /new Worker\(new URL\('(\.\/[\w.-]+\.ts)', import\.meta\.url\), \{ type: 'module' \}\)/g;
    if (!found.test(code)) return null;
    found.lastIndex = 0;
    const imports: string[] = [];
    const engine = id.endsWith('/src/engine/index.ts');
    if (engine) imports.push(`import { withWasm } from ${JSON.stringify(shim('workers.ts'))};`);
    const out = code.replace(found, (_all, file: string) => {
      const v = `InlineWorker${imports.length}`;
      imports.push(`import ${v} from '${file}?worker&inline';`);
      return engine ? `withWasm(new ${v}())` : `new ${v}()`;
    });
    return { code: `${imports.join('\n')}\n${out}`, map: null };
  },
});

const tsWorker = (mode: string): Plugin => ({
  name: 'formcel-demo-ts-worker',
  enforce: 'pre',
  resolveId(id) {
    return id === 'virtual:formcel-demo-ts-worker' ? '\0formcel-demo-ts-worker' : null;
  },
  load(id) {
    if (id !== '\0formcel-demo-ts-worker') return null;
    return `import url from ${JSON.stringify(`${fileURLToPath(new URL('./src/automation/tsWorker.ts', import.meta.url))}?worker&url`)};\nvoid url;`;
  },
  generateBundle(_options, bundle) {
    for (const [name, file] of Object.entries(bundle)) {
      if (!/tsWorker[^/]*\.js$/.test(name) || file.type !== 'asset') continue;
      delete bundle[name];
      if (mode !== SHARED) continue;
      const source = typeof file.source === 'string' ? file.source : new TextDecoder().decode(file.source);
      this.emitFile({ type: 'asset', fileName: 'assets/ts-worker.js', source: `(window.FC_DEMO_WORKERS=window.FC_DEMO_WORKERS||{})["ts-worker"]=${escape(JSON.stringify(source), true)};\n` });
    }
  },
});

const wasmFromPage = (): Plugin => ({
  name: 'formcel-demo-wasm',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/engine/worker.ts')) return null;
    const call = "WebAssembly.instantiateStreaming(fetch('/engine/formcel.wasm'), {})";
    if (!code.includes(call)) this.error('src/engine/worker.ts no longer loads /engine/formcel.wasm the way the demo expects.');
    const take = "const fcWasm = new Promise<ArrayBuffer>((done) => { const take = (e: MessageEvent): void => { if (!e.data || !(e.data.fcWasm instanceof ArrayBuffer)) return; e.stopImmediatePropagation(); self.removeEventListener('message', take); done(e.data.fcWasm); }; self.addEventListener('message', take); });";
    return { code: `${take}\n${code.replace(call, 'fcWasm.then((b) => WebAssembly.instantiate(b, {}))')}`, map: null };
  },
});

const sharedEngine = (mode: string): Plugin => ({
  name: 'formcel-demo-shared-engine',
  generateBundle() {
    if (mode !== SHARED) return;
    let bytes: Buffer;
    try {
      bytes = readFileSync(WASM);
    } catch {
      this.error(`No window engine at ${WASM}. Run engine/build_wasm first, or set FORMCEL_DEMO_WASM to a built formcel_wasm.wasm.`);
    }
    this.emitFile({ type: 'asset', fileName: 'assets/engine.js', source: `window.FC_DEMO_WASM="${bytes.toString('base64')}";\n` });
  },
});

const quietFonts = (): Plugin => ({
  name: 'formcel-demo-fonts',
  enforce: 'pre',
  transform(code, id) {
    if (/\/src\/grid\/full-fonts\/[\w-]+\.css$/.test(id)) return { code: '', map: null };
    if (!/\/@fontsource\/[\w-]+\/[\w-]+\.css$/.test(id)) return null;
    return { code: code.replace(/,\s*url\([^)]+\.woff\) format\('woff'\)/g, ''), map: null };
  },
});

const sharedPath = (mode: string): string => (mode === SHARED ? './assets/' : `${posix.relative(PAGES[mode].out, PAGES[SHARED].out)}/assets/`);

const sharedBundle = (mode: string): Plugin => ({
  name: 'formcel-demo-shared-bundle',
  enforce: 'post',
  generateBundle(_options, bundle) {
    if (mode === SHARED) return;
    for (const [name, file] of Object.entries(bundle)) {
      if (name === 'index.html') continue;
      if (name === 'assets/demo.js' && file.type === 'chunk') {
        let built = '';
        try {
          built = readFileSync(fileURLToPath(new URL(`${PAGES[SHARED].out}/assets/demo.js`, import.meta.url)), 'utf8');
        } catch { built = ''; }
        if (built !== file.code) this.error(`demo/assets/demo.js is missing or older than this build. Run npm run demo, which builds the ${SHARED} page first.`);
      }
      delete bundle[name];
    }
  },
});

const demoPage = (mode: string): Plugin => {
  const shared = sharedPath(mode);
  return {
    name: 'formcel-demo-page',
    enforce: 'pre',
    transform(html, id) {
      if (!id.endsWith('/frontend/index.html')) return null;
      return html
        .replace('<script type="module" src="/src/main.ts"></script>', `<script defer src="${shared}workbooks.js"></script>\n  <script defer src="${shared}engine.js"></script>\n  <script type="module" src="../demo/src/main.ts"></script>`)
        .replace(/\s*<link rel="(?:icon|apple-touch-icon|preload|manifest)"[^>]*>/g, '')
        .replace(/<html([^>]*)>/, `<html$1 data-demo="building" data-demo-id="${mode}" data-demo-shared="${shared}">`)
        .replace('</head>', '  <style>html[data-demo="building"] body > * { opacity: 0 !important; pointer-events: none !important; }html[data-demo="building"]::before { content: "Starting FormCel"; position: fixed; left: 0; right: 0; top: calc(50% - 30px); font: 13px -apple-system, "Segoe UI", system-ui, sans-serif; color: #a4a4a4; text-align: center; } html[data-demo="building"]::after { content: ""; position: fixed; left: calc(50% - 90px); top: calc(50% - 2px); width: 180px; height: 3px; border-radius: 2px; background: linear-gradient(90deg, #f97316, #fdba74) 0 0 / 60px 3px no-repeat #222127; animation: demo-start 1.4s ease-in-out infinite alternate; } @keyframes demo-start { to { background-position: 120px 0; } }</style>\n</head>')
        .replace(/<title>[^<]*<\/title>/, `<title>${PAGES[mode].title}</title>`);
    },
  };
};

const escapeSymbols = (): Plugin => ({
  name: 'formcel-demo-escape-symbols',
  enforce: 'post',
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) if (file.type === 'chunk') file.code = escape(file.code);
  },
});

const classicScript = (mode: string): Plugin => ({
  name: 'formcel-demo-classic-script',
  enforce: 'post',
  transformIndexHtml(html) {
    const tag = /<script type="module" crossorigin src="([^"]+)"><\/script>\s*/;
    const found = html.match(tag);
    if (!found) return html;
    const shared = sharedPath(mode);
    return html.replace(tag, '').replace('</body>', `<script defer src="${found[1]}"></script>\n</body>`).replace(/ crossorigin(?=[ >])/g, '').replace(/(src|href)="\.\/assets\/(demo\.(?:js|css))"/g, `$1="${shared}$2"`);
  },
});

export default defineConfig(({ mode }) => {
  const id = PAGES[mode] ? mode : SHARED;
  const page = PAGES[id];
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    publicDir: false,
    worker: { format: 'iife', plugins: () => [wasmFromPage()] },
    plugins: [inlineWorkers(), tsWorker(id), quietFonts(), demoPage(id), classicScript(id), escapeSymbols(), sharedBundle(id), sharedEngine(id)],
    server: { host: false, port: DEMO_PORT, strictPort: true, fs: { allow: ['..'] } },
    preview: { host: false, port: DEMO_PORT + 1, strictPort: true },
    build: {
      outDir: fileURLToPath(new URL(page.out, import.meta.url)),
      emptyOutDir: false,
      target: 'es2022',
      sourcemap: false,
      cssCodeSplit: false,
      assetsInlineLimit: 0,
      modulePreload: false,
      chunkSizeWarningLimit: 20000,
      rollupOptions: {
        output: {
          format: 'iife' as const,
          inlineDynamicImports: true,
          entryFileNames: 'assets/demo.js',
          assetFileNames: (info: { names?: string[] }) => (info.names?.some((n) => n.endsWith('.css')) ? 'assets/demo.css' : 'assets/[name][extname]'),
        },
      },
    },
  };
});
