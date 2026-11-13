type DemoWindow = Window & { FC_DEMO_WASM?: string; FC_DEMO_WORKERS?: Record<string, string> };

const shared = document.documentElement.dataset.demoShared ?? './assets/';
const loaded = new Map<string, Promise<void>>();

export function sharedScript(name: string): Promise<void> {
  let p = loaded.get(name);
  if (!p) {
    p = new Promise((done, fail) => {
      const s = document.createElement('script');
      s.src = `${shared}${name}.js`;
      s.onload = () => done();
      s.onerror = () => fail(new Error(`The demo could not load ${s.src}.`));
      document.head.append(s);
    });
    loaded.set(name, p);
  }
  return p;
}

let wasm: ArrayBuffer | null = null;

function wasmBytes(): ArrayBuffer {
  const text = (window as DemoWindow).FC_DEMO_WASM;
  if (!text) throw new Error('The window engine (engine.js) is missing next to the demo page.');
  if (!wasm) {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    wasm = out.buffer;
  }
  return wasm;
}

export function withWasm(w: Worker): Worker {
  w.postMessage({ fcWasm: wasmBytes().slice(0) });
  return w;
}

const BOOT = 'var q=[];self.onmessage=function(e){if(e.data&&typeof e.data.fcBoot==="string"){self.onmessage=null;(0,eval)(e.data.fcBoot);var w=q;q=null;for(var i=0;i<w.length;i++)self.dispatchEvent(new MessageEvent("message",{data:w[i]}));}else if(q)q.push(e.data);};';

export function sharedWorker(name: string): Worker {
  const w = new Worker(URL.createObjectURL(new Blob([BOOT], { type: 'text/javascript' })));
  void sharedScript(name).then(() => {
    const code = (window as DemoWindow).FC_DEMO_WORKERS?.[name];
    if (code) w.postMessage({ fcBoot: code });
  }, () => undefined);
  return w;
}
