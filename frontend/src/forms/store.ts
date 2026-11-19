export type FieldKind = 'text' | 'number' | 'date';

export interface FormField {
  name: string;
  label: string;
  kind: FieldKind;
}

export interface DataFormDef {
  id: string;
  name: string;
  path: string;
  table: string;
  key: string;
  fields: FormField[];
  onLoad: string;
  onSave: string;
}

export interface FormsHost {
  id(): string;
  setting<T>(key: string): T | undefined;
  setSetting(key: string, value: unknown): void;
}

export function kindOf(sqlType: string, name: string): FieldKind {
  const t = sqlType.toUpperCase();
  if (/DATE|TIME/.test(t) || /(^|_)(date|day)$/i.test(name)) return 'date';
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/.test(t)) return 'number';
  return 'text';
}

export function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class FormStore {
  constructor(private readonly h: FormsHost) {}

  all(): DataFormDef[] {
    const v = this.h.setting<DataFormDef[]>('dataForms');
    return Array.isArray(v) ? v : [];
  }

  find(ref: unknown): DataFormDef | undefined {
    const s = typeof ref === 'string' ? ref.trim() : '';
    const list = this.all();
    if (!s) return list[0];
    return list.find((f) => f.id === s) ?? list.find((f) => f.name.toLowerCase() === s.toLowerCase());
  }

  put(def: DataFormDef): void {
    const list = this.all().filter((f) => f.id !== def.id);
    this.h.setSetting('dataForms', [...list, def]);
  }

  remove(id: string): boolean {
    const list = this.all();
    const next = list.filter((f) => f.id !== id);
    if (next.length === list.length) return false;
    this.h.setSetting('dataForms', next);
    return true;
  }
}
