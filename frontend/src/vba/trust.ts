import { prefs, updatePrefs, type MacroPolicy } from '../ui/prefs';

export type MacroLevel = 'notify' | 'silent' | 'signed' | 'all';

export interface Trust {
  level: MacroLevel;
  documents: Record<string, string>;
}

const KEY = 'formcel.prefs';
const FROM_POLICY: Record<MacroPolicy, MacroLevel> = { disable: 'silent', notify: 'notify', signed: 'signed', enable: 'all' };
const TO_POLICY: Record<MacroLevel, MacroPolicy> = { silent: 'disable', notify: 'notify', signed: 'signed', all: 'enable' };

export const LEVEL_TEXT: Record<MacroLevel, [string, string]> = {
  silent: ['Disable VBA macros without notification', 'Macros in a workbook are never run and no message appears.'],
  notify: ['Disable VBA macros with notification', 'Macros are blocked and a message bar offers Enable Content for each workbook.'],
  signed: ['Disable VBA macros except digitally signed macros', 'FormCel cannot verify signatures yet, so this blocks every macro and shows the message bar without Enable Content.'],
  all: ['Enable VBA macros (not recommended; potentially dangerous code can run)', 'Every macro in every workbook runs without asking.'],
};

function blob(): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadTrust(): Trust {
  const m = blob().macroSecurity as Partial<Trust> | undefined;
  const level = FROM_POLICY[prefs().macroPolicy];
  const documents: Record<string, string> = {};
  if (m?.documents && typeof m.documents === 'object') for (const [k, v] of Object.entries(m.documents)) if (typeof v === 'string') documents[k] = v;
  return { level, documents };
}

export function saveTrust(t: Trust): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...blob(), macroSecurity: t }));
  } catch {
    return;
  }
}

export function isTrusted(id: string, signature: string): boolean {
  return loadTrust().documents[id] === signature;
}

export function trust(id: string, signature: string): void {
  const t = loadTrust();
  t.documents[id] = signature;
  saveTrust(t);
}

export function forget(id: string): void {
  const t = loadTrust();
  delete t.documents[id];
  saveTrust(t);
}

export function setLevel(level: MacroLevel): void {
  updatePrefs({ macroPolicy: TO_POLICY[level] });
}
