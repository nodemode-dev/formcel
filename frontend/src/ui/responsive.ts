import type { Ribbon } from './ribbon';
import { setClass } from './rb-dom';

const NARROW = '(max-width: 899px)';
const PHONE = '(max-width: 599px)';

export function installResponsive(root: HTMLElement, ribbon: Ribbon): void {
  const mq = { narrow: matchMedia(NARROW), phone: matchMedia(PHONE) };
  let auto = false;
  const apply = (): void => {
    const phone = mq.phone.matches;
    setClass(root, 'is-narrow', mq.narrow.matches || phone);
    setClass(root, 'is-phone', phone);
    if (phone && !ribbon.simplified) { ribbon.setSimplified(true, false); auto = true; }
    else if (!phone && auto) { ribbon.setSimplified(false, false); auto = false; }
  };
  for (const m of Object.values(mq)) m.addEventListener('change', apply);
  apply();
}
