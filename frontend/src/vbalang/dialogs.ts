import { actions, el, makeModal } from '../ui/modal';

const NAMES: [number, string][] = [
  [1, 'OK'],
  [2, 'Cancel'],
  [3, 'Abort'],
  [4, 'Retry'],
  [5, 'Ignore'],
  [6, 'Yes'],
  [7, 'No'],
];

function layout(style: number): number[] {
  switch (style & 7) {
    case 1:
      return [1, 2];
    case 2:
      return [3, 4, 5];
    case 3:
      return [6, 7, 2];
    case 4:
      return [6, 7];
    case 5:
      return [4, 2];
    default:
      return [1];
  }
}

export function msgBox(prompt: string, buttons: number, title: string): Promise<number> {
  const ids = layout(buttons);
  const def = Math.min(ids.length - 1, (buttons >> 8) & 3);
  const cancelId = ids.includes(2) ? 2 : ids.includes(7) ? 7 : ids.includes(5) ? 5 : ids[0];
  return new Promise((resolve) => {
    let answer = cancelId;
    const modal = makeModal(title || 'FormCel', {
      onClose: () => {
        window.setTimeout(() => modal.el.remove(), 0);
        resolve(answer);
      },
    });
    const text = el('p', 'fc-auto-hint');
    text.style.whiteSpace = 'pre-wrap';
    text.textContent = prompt;
    const row = el('div', 'fc-csv-actions');
    const made: HTMLButtonElement[] = [];
    for (const id of ids) {
      const b = el('button', id === ids[def] ? 'fc-btn fc-btn-primary' : 'fc-btn', NAMES.find((n) => n[0] === id)?.[1] ?? 'OK');
      b.type = 'button';
      b.addEventListener('click', () => {
        answer = id;
        modal.close();
      });
      made.push(b);
      row.appendChild(b);
    }
    modal.body.append(text, row);
    modal.open(made[def]);
  });
}

export function inputBox(prompt: string, title: string, def: string): Promise<string | null> {
  return new Promise((resolve) => {
    let answer: string | null = null;
    const modal = makeModal(title || 'Input', {
      onClose: () => {
        window.setTimeout(() => modal.el.remove(), 0);
        resolve(answer);
      },
    });
    const text = el('p', 'fc-auto-hint');
    text.style.whiteSpace = 'pre-wrap';
    text.textContent = prompt;
    const input = el('input', 'fc-input');
    input.type = 'text';
    input.value = def;
    input.setAttribute('aria-label', prompt || 'Input');
    const accept = () => {
      answer = input.value;
      modal.close();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        accept();
      }
    });
    modal.body.append(text, input, actions('OK', accept, () => modal.close()));
    modal.open(input);
    input.select();
  });
}
