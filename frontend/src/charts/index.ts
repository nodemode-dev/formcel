import type { EngineClient } from '../engine';
import type { Range } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { registerCommand } from '../ui/commands';
import { recommend, readMatrix, rangeLabel } from './data';
import { ChartEditor } from './editor';
import { ObjectLayer } from './layer';
import { blankChart, CHART_TYPES, type ChartSpec, type ChartType, type FloatObject } from './types';

export interface ChartsHost {
  book(): number;
  sheetNames(): string[];
  active(): boolean;
  load(): Promise<FloatObject[][]>;
  save(sheet: number, list: FloatObject[]): void;
}

const MAX_PICTURE = 6 * 1024 * 1024;

export class Charts {
  readonly layer: ObjectLayer;
  private readonly editor: ChartEditor;
  private readonly file: HTMLInputElement;

  constructor(private readonly grid: Grid, private readonly eng: EngineClient, private readonly host: ChartsHost) {
    this.layer = new ObjectLayer(grid, eng, host);
    this.editor = new ChartEditor({ eng, book: () => host.book(), sheet: () => grid.sheetIndex, sheetNames: () => host.sheetNames() }, () => grid.focus());
    this.layer.onEdit = (o) => void this.edit(o);
    this.file = document.createElement('input');
    this.file.type = 'file';
    this.file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp';
    this.file.hidden = true;
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (f) void this.picture(f);
    });
    document.body.appendChild(this.file);
    this.commands();
    document.addEventListener('fc-ai-chart', (e) => {
      const d = (e as CustomEvent<{ type: string; range: string; title: string; byRows: boolean }>).detail;
      if (!this.host.active()) return;
      const type = (CHART_TYPES.some((t) => t.id === d.type) ? d.type : 'column') as ChartType;
      const o = this.layer.viewOrigin();
      this.layer.add({ kind: 'chart', x: o.x, y: o.y, w: 480, h: 300, chart: { ...blankChart(type, d.range.replace(/^.*!/, '')), title: d.title, byRows: d.byRows } });
    });
  }

  private commands(): void {
    const cmd = (id: string, title: string, description: string, run: () => void | Promise<void>) => registerCommand({ id, title, description, changes: false, run });
    cmd('insert.chart', 'Insert chart', 'Make a chart from the selected cells, or the data around the active cell, and float it over the sheet. Pick the type, titles, axes, legend and labels in the editor. Drag it to move it, drag its handles to resize it, press Delete to remove it.', () => this.insertChart());
    cmd('insert.picture', 'Insert picture', 'Choose an image file and float it over the sheet. Drag it to move it, drag its handles to resize it.', () => this.file.click());
    cmd('insert.shape-rect', 'Insert rectangle', 'Float a rectangle over the sheet. Double-click it to type text in it.', () => this.shape('rect'));
    cmd('insert.shape-ellipse', 'Insert ellipse', 'Float an ellipse over the sheet. Double-click it to type text in it.', () => this.shape('ellipse'));
    cmd('insert.shape-arrow', 'Insert arrow', 'Float an arrow over the sheet.', () => this.shape('arrow'));
    cmd('insert.textbox', 'Insert text box', 'Float a text box over the sheet. Double-click it to edit the text.', () => this.textbox());
  }

  private async target(): Promise<Range | null> {
    const s = this.grid.selection();
    if (s.r0 !== s.r1 || s.c0 !== s.c1) return s;
    const [r, c] = this.grid.activeCell();
    const { area } = await this.eng.region(this.host.book(), this.grid.sheetIndex, r, c);
    return { r0: area[0], c0: area[1], r1: area[2], c1: area[3] };
  }

  private async insertChart(): Promise<void> {
    if (!this.host.active()) return;
    const r = await this.target();
    const range = r ? rangeLabel(r) : '';
    let type = blankChart('column', range).type;
    if (r) {
      const m = await readMatrix(this.eng, this.host.book(), this.grid.sheetIndex, r);
      type = recommend(m)[0] ?? 'column';
    }
    const spec = blankChart(type, range);
    const got = await this.editor.open(spec, 'Insert chart');
    if (!got) return;
    const o = this.layer.viewOrigin();
    this.layer.add({ kind: 'chart', x: o.x, y: o.y, w: 480, h: 300, chart: got });
  }

  private async edit(o: FloatObject): Promise<void> {
    if (!o.chart) return;
    const got = await this.editor.open(o.chart, 'Chart editor');
    if (got) this.layer.update({ ...o, chart: got as ChartSpec });
  }

  private shape(shape: 'rect' | 'ellipse' | 'arrow'): void {
    if (!this.host.active()) return;
    const o = this.layer.viewOrigin();
    this.layer.add({ kind: 'shape', x: o.x, y: o.y, w: shape === 'arrow' ? 160 : 140, h: shape === 'arrow' ? 60 : 90, shape: { shape, fill: '#4e79a7', stroke: '#2f4b6e', text: '' } });
  }

  private textbox(): void {
    if (!this.host.active()) return;
    const o = this.layer.viewOrigin();
    this.layer.add({ kind: 'text', x: o.x, y: o.y, w: 180, h: 50, text: { text: 'Text', size: 14, color: '' } });
  }

  private async picture(f: File): Promise<void> {
    if (!this.host.active() || !f.type.startsWith('image/')) return;
    if (f.size > MAX_PICTURE) {
      alert('That picture is larger than 6 MB. Choose a smaller one.');
      return;
    }
    const src = await new Promise<string>((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result));
      rd.onerror = () => reject(rd.error);
      rd.readAsDataURL(f);
    });
    const size = await new Promise<[number, number]>((resolve) => {
      const img = new Image();
      img.onload = () => resolve([img.naturalWidth || 200, img.naturalHeight || 150]);
      img.onerror = () => resolve([200, 150]);
      img.src = src;
    });
    const k = Math.min(1, 420 / size[0], 320 / size[1]);
    const o = this.layer.viewOrigin();
    this.layer.add({ kind: 'picture', x: o.x, y: o.y, w: Math.round(size[0] * k), h: Math.round(size[1] * k), picture: { src, name: f.name } });
  }
}
