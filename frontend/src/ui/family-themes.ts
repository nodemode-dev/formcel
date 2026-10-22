const STORE = 'nodemode_ui_settings';

const VARS = ['--bg-primary', '--bg-secondary', '--bg-tertiary', '--border-color', '--border-light', '--text-primary', '--text-secondary', '--text-muted', '--canvas-bg', '--grid-color'];

export const FAMILY_LIGHT = new Set(['light', 'sand', 'nineties', 'duck', 'pro-light-grey', 'pro-light', 'classic', 'adwaita-light', 'soft-light']);

export const FAMILY_THEMES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['studio', 'Studio Dark', ['#111111', '#17151b', '#222127', '#2a2a2a', '#34333a', '#f7f7f7', '#a4a4a4', '#717072', '#1c1b1d', '#5e5e60', '#191919']],
  ['nodemode-dark', 'NodeMode Dark', ['#0a0a0a', '#121218', '#1a1a24', '#2a2a35', '#3a3a48', '#e8e8ee', '#a8a8b8', '#6a6a7a', '#0a0a0a', 'rgba(255,255,255,0.04)']],
  ['light', 'Light', ['#ecebe6', '#f7f6f1', '#e2e0d8', '#d1cdc1', '#beb9aa', '#26241d', '#4c4a40', '#8b887a', '#e7e5dd', 'rgba(70,60,30,0.10)', '#f4f3ed']],
  ['github-dark', 'GitHub Dark', ['#0d1117', '#161b22', '#21262d', '#30363d', '#3d444d', '#e6edf3', '#9198a1', '#656c76', '#0d1117', 'rgba(230,237,243,0.05)']],
  ['midnight', 'Midnight Blue', ['#0b1020', '#101830', '#182242', '#25325c', '#324274', '#e4e9f7', '#9fabd0', '#63709a', '#0b1020', 'rgba(160,180,255,0.06)']],
  ['forest', 'Forest', ['#0c130e', '#121c15', '#1a281e', '#2a4030', '#375441', '#e4efe7', '#a4bdac', '#6a8674', '#0c130e', 'rgba(180,230,190,0.05)']],
  ['ember', 'Ember', ['#140d0a', '#1d1310', '#2a1c16', '#452e22', '#5a3d2e', '#f2e8e2', '#c7ab9c', '#8f7263', '#140d0a', 'rgba(255,200,160,0.05)']],
  ['violet', 'Violet Haze', ['#100b1c', '#171129', '#221a3c', '#382c5e', '#493b78', '#ece6f9', '#b3a6d8', '#7a6da3', '#100b1c', 'rgba(210,190,255,0.06)']],
  ['slate', 'Slate', ['#101418', '#171d23', '#212a32', '#32404c', '#415260', '#e7edf2', '#a3b2bf', '#6b7a87', '#101418', 'rgba(200,220,240,0.05)']],
  ['mono', 'Mono Ink', ['#0e0e0e', '#161616', '#202020', '#333333', '#454545', '#f0f0f0', '#ababab', '#6e6e6e', '#0e0e0e', 'rgba(255,255,255,0.05)']],
  ['sand', 'Sand (light)', ['#efe8da', '#f8f3e9', '#e6dcc8', '#d4c7ab', '#c2b28e', '#2a2418', '#59503c', '#8d8168', '#eae2d1', 'rgba(80,60,10,0.10)', '#f5efe2']],
  ['ocean', 'Deep Ocean', ['#06131c', '#0a1c29', '#10293c', '#1d425e', '#285578', '#e2eef7', '#96b6cc', '#5b7d94', '#06131c', 'rgba(150,210,255,0.06)']],
  ['rose', 'Rose Noir', ['#170b10', '#211117', '#301a22', '#4d2b38', '#653a49', '#f5e7ec', '#cfa5b3', '#966b7b', '#170b10', 'rgba(255,190,215,0.05)']],
  ['terminal', 'Terminal Green', ['#050d05', '#0a140a', '#102010', '#1f3d1f', '#2b522b', '#d8f5d8', '#8fce8f', '#568a56', '#050d05', 'rgba(120,255,120,0.06)']],
  ['contrast', 'High Contrast', ['#000000', '#0a0a0a', '#161616', '#555555', '#777777', '#ffffff', '#d8d8d8', '#9a9a9a', '#000000', 'rgba(255,255,255,0.10)']],
  ['nineties', '90s', ['#c0c0c0', '#d4d0c8', '#b4b0a8', '#808080', '#ffffff', '#000000', '#202020', '#585858', '#008080', 'rgba(0,0,0,0.12)', '#d4d0c8']],
  ['duck', 'Duck', ['#e9e4f7', '#f4f1fc', '#d9d2ef', '#c7bde6', '#b3a6dc', '#2b2540', '#4f4770', '#7a7299', '#e2dcf2', 'rgba(90,70,150,0.10)', '#f4f1fc']],
  ['pro-dark', 'Pro Dark', ['#1f1f1f', '#2b2b2b', '#363636', '#4a4a4a', '#818181', '#ececec', '#bdbdbd', '#a0a0a0', '#181818', 'rgba(255,255,255,0.05)']],
  ['pro-medium-grey', 'Pro Medium Gray', ['#3a3a3a', '#454545', '#505050', '#666666', '#a0a0a0', '#f4f4f4', '#d6d6d6', '#c3c3c3', '#2e2e2e', 'rgba(255,255,255,0.06)']],
  ['pro-light-grey', 'Pro Light Gray', ['#b9b9b9', '#c9c9c9', '#aeaeae', '#8c8c8c', '#5a5a5a', '#121212', '#2a2a2a', '#414141', '#a4a4a4', 'rgba(0,0,0,0.10)']],
  ['pro-light', 'Pro Light', ['#e3e3e3', '#f2f2f2', '#d6d6d6', '#b5b5b5', '#767676', '#1a1a1a', '#383838', '#545454', '#d0d0d0', 'rgba(0,0,0,0.08)']],
  ['classic', 'Classic', ['#d1d4d9', '#e1e4e8', '#c2c6cc', '#9ea4ad', '#666c76', '#14171c', '#2c323a', '#4a515b', '#c0c4ca', 'rgba(0,0,0,0.09)']],
  ['solarized-dark', 'Solarized Dark', ['#002b36', '#073642', '#0d4452', '#1b5563', '#768e97', '#fdf6e3', '#bcc6c6', '#9bb0b3', '#00212b', 'rgba(147,161,161,0.08)']],
  ['adwaita-light', 'Adwaita Light', ['#ebebeb', '#fafafa', '#dedde0', '#c0bfbc', '#77767b', '#241f31', '#3d3846', '#5e5c64', '#f6f5f4', 'rgba(0,0,0,0.07)']],
  ['adwaita-dark', 'Adwaita Dark', ['#242424', '#303030', '#3a3a3a', '#4a4a4a', '#858585', '#ffffff', '#deddda', '#b4b3b0', '#1e1e1e', 'rgba(255,255,255,0.05)']],
  ['breeze-dark', 'Breeze Dark', ['#232629', '#31363b', '#3b4045', '#4d5359', '#828c94', '#eff0f1', '#c5cacd', '#a4adb3', '#1b1e20', 'rgba(239,240,241,0.06)']],
  ['soft-light', 'Soft Light', ['#e8ebef', '#f4f6f8', '#dce0e6', '#c3c9d2', '#777d89', '#2b323c', '#454d59', '#5b6370', '#dfe3e8', 'rgba(43,50,60,0.08)']],
  ['soft-dark', 'Soft Dark', ['#22262b', '#2b3036', '#353b43', '#454c56', '#7c8693', '#e1e6ec', '#b9c1cb', '#9ca6b2', '#1b1e22', 'rgba(225,230,236,0.06)']],
];

function shared(): Record<string, unknown> {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Record<string, unknown> | null;
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {};
  }
}

export function familyThemeId(): string {
  const s = shared();
  const id = (s.appearance === 3 || s.appearance === 2) && typeof s.theme === 'string' ? s.theme : 'studio';
  return FAMILY_THEMES.some(([k]) => k === id) ? id : 'studio';
}

export function setFamilyTheme(id: string): void {
  const entry = FAMILY_THEMES.find(([k]) => k === id);
  if (!entry) return;
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...shared(), theme: id, appearance: 3 }));
  } catch {
    return;
  }
  const p = entry[2];
  const root = document.documentElement;
  VARS.forEach((name, i) => root.style.setProperty(name, p[i]));
  root.style.setProperty('--bg-node', p[10] ?? p[1]);
  root.style.background = p[0];
  root.style.colorScheme = FAMILY_LIGHT.has(id) ? 'light' : 'dark';
  root.setAttribute('data-theme', FAMILY_LIGHT.has(id) ? 'light' : 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p[0]);
}
