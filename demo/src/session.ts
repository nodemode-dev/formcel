import { mountLinks } from './links';

const wait = (ms: number): Promise<void> => new Promise((done) => window.setTimeout(done, ms));
const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()));

async function card(id: string): Promise<HTMLElement> {
  for (let i = 0; i < 600; i++) {
    const b = document.querySelector<HTMLElement>(`button[data-demo="${id}"]`);
    if (b && document.body.classList.contains('app-ready')) return b;
    await wait(50);
  }
  throw new Error('The demo window did not start.');
}

export async function openSession(id: string): Promise<void> {
  try {
    const b = await card(id);
    b.click();
    for (let i = 0; i < 600; i++) {
      await wait(50);
      if (b.getAttribute('aria-busy') !== 'true' && location.hash.startsWith(`#w-demo${id}`) && document.activeElement?.closest('.fc-sheet:not([hidden]) .fc-grid')) break;
    }
    mountLinks(id);
  } finally {
    await frame();
    await frame();
    document.documentElement.removeAttribute('data-demo');
  }
}
