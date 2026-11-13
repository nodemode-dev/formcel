import './links.css';

const PAGES: ReadonlyArray<{ id: string; label: string; path: string }> = [
  { id: 'sales', label: 'Sales', path: 'demo/index.html' },
  { id: 'whatif', label: 'What-if', path: 'demos/whatif/index.html' },
  { id: 'lab', label: 'Lab', path: 'demos/lab/index.html' },
];

export function mountLinks(current: string): void {
  const bar = document.querySelector<HTMLElement>('.fc-statusbar');
  if (!bar || bar.querySelector('.dz-links')) return;
  const up = current === 'sales' ? '../' : '../../';
  const nav = document.createElement('nav');
  nav.className = 'dz-links';
  nav.setAttribute('aria-label', 'FormCel demos');
  const head = document.createElement('span');
  head.textContent = 'Demos';
  nav.append(head);
  for (const p of PAGES) {
    const a = document.createElement('a');
    a.href = `${up}${p.path}`;
    a.textContent = p.label;
    if (p.id === current) a.setAttribute('aria-current', 'page');
    nav.append(a);
  }
  const grow = bar.querySelector('.fc-st-grow');
  if (grow) grow.after(nav);
  else bar.append(nav);
}
