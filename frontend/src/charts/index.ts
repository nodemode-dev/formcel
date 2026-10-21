import type { EngineClient } from '../engine';
import type { Range } from '../grid/a1';
import type { Grid } from '../grid/grid';
import { registerCommand } from '../ui/commands';
import { Timeline } from '../ui/timeline';
import type { PivotDef } from '../ui/pivot';
import { Decor } from './decor';
import { recommend, readMatrix, rangeLabel, parseRangeText } from './data';
import { askAlt, askSparkline } from './dialogs';
import { ChartEditor } from './editor';
import { ObjectLayer } from './layer';
import { pivotChartData } from './pivotchart';
import { blankChart, CHART_TYPES, newId, type ChartSpec, type ChartType, type FloatObject } from './types';

export interface ChartsHost {
  book(): number;
  sheetNames(): string[];
  active(): boolean;
  load(): Promise<FloatObject[][]>;
  save(sheet: number, list: FloatObject[]): void;
  pivots?(): PivotDef[];
  pivotHere?(): string | null;
  pivotItems?(name: string, field: string): Promise<string[]>;
  pivotFilter?(name: string, field: string, items: string[]): Promise<void>;
  say?(text: string): void;
}

const MAX_PICTURE = 6 * 1024 * 1024;

export class Charts {
  readonly layer: ObjectLayer;
  readonly decor: Decor;
  private readonly editor: ChartEditor;
  private readonly file: HTMLInputElement;
  private readonly cellFile: HTMLInputElement;
  private readonly timeline: Timeline;

  constructor(private readonly grid: Grid, private readonly eng: EngineClient, private readonly host: ChartsHost) {
    this.layer = new ObjectLayer(grid, eng, host);
    this.timeline = new Timeline({ grid, eng, book: () => host.book() });
    this.decor = new Decor(grid, eng, this.layer, () => host.book(), () => host.sheetNames());
    this.layer.onAlt = (o) => void this.alt(o);
    this.cellFile = document.createElement('input');
    this.cellFile.type = 'file';
    this.cellFile.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp';
    this.cellFile.hidden = true;
    this.cellFile.addEventListener('change', () => {
      const f = this.cellFile.files?.[0];
      this.cellFile.value = '';
      if (f) void this.cellPicture(f);
    });
    document.body.appendChild(this.cellFile);
    this.editor = new ChartEditor({
      eng,
      book: () => host.book(),
      sheet: () => grid.sheetIndex,
      sheetNames: () => host.sheetNames(),
      pivotData: async (name) => {
        const def = host.pivots?.().find((p) => p.name === name);
        return def ? pivotChartData(eng, host.book(), def) : null;
      },
    }, () => grid.focus());
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
    cmd('insert.chart-recommended', 'Recommended charts', 'Rank chart types for the selected cells, or the data around the active cell, with a small preview of each, as Excel does. Click a preview to see it large, then press OK to float it over the sheet.', () => this.insertChart('Recommended charts'));
    cmd('insert.pivot-chart', 'PivotChart', 'Make a chart from the PivotTable under the active cell, or the only PivotTable in the workbook. It redraws whenever the PivotTable changes, and the PivotTable filters appear as buttons on the chart.', () => this.insertPivotChart());
    cmd('insert.picture', 'Insert picture', 'Choose an image file and float it over the sheet. Drag it to move it, drag its handles to resize it.', () => this.file.click());
    cmd('insert.shape-rect', 'Insert rectangle', 'Float a rectangle over the sheet. Double-click it to type text in it.', () => this.shape('rect'));
    cmd('insert.shape-ellipse', 'Insert ellipse', 'Float an ellipse over the sheet. Double-click it to type text in it.', () => this.shape('ellipse'));
    cmd('insert.shape-arrow', 'Insert arrow', 'Float an arrow over the sheet.', () => this.shape('arrow'));
    cmd('insert.textbox', 'Insert text box', 'Float a text box over the sheet. Double-click it to edit the text.', () => this.textbox());
    cmd('insert.cell-picture', 'Insert picture in cell', 'Choose an image file and place it inside the active cell. It stays in the cell, moves with it when rows and columns are inserted or deleted, and is saved with the workbook.', () => this.cellFile.click());
    cmd('insert.sparkline', 'Insert sparklines', 'Draw a line, column or win/loss sparkline in each cell of a location range from a data range, with markers for the high, low, first, last and negative points and axis options.', () => this.sparkline());
    cmd('insert.sparkline-clear', 'Clear sparklines', 'Remove the sparklines in the selected cells.', () => this.clearSparklines());
    cmd('view.timeline', 'Timeline view', 'Lay out the rows of the selected range as cards on a time axis by their start and end dates, grouped by a column, with day, week, month, quarter and year zoom. Choose a card to go to its row.', () => {
      if (this.host.active()) void this.timeline.open();
    });
    cmd('insert.alt-text', 'Alt text for the selected object', 'Describe the selected chart, picture, shape or text box for people who use a screen reader, or mark it decorative.', () => {
      const o = this.layer.selectedObject();
      if (o) void this.alt(o);
    });
  }

  private async alt(o: FloatObject): Promise<void> {
    const label = o.kind === 'chart' ? 'chart' : o.kind === 'picture' ? `picture ${o.picture?.name ?? ''}` : o.kind === 'shape' ? 'shape' : 'text box';
    const got = await askAlt(`Describe this ${label.trim()}.`, o.alt ?? '', !!o.decorative);
    if (got) this.layer.setAlt(o.id, got.alt, got.decorative);
    this.grid.focus();
  }

  private cellBox(r: number, c: number): { x: number; y: number; w: number; h: number } {
    const rows = this.grid.rows;
    const cols = this.grid.cols;
    return { x: cols.offsetOf(c), y: rows.offsetOf(r), w: cols.size(c), h: rows.size(r) };
  }

  private rangeBox(r0: number, c0: number, r1: number, c1: number): { x: number; y: number; w: number; h: number } {
    const rows = this.grid.rows;
    const cols = this.grid.cols;
    return { x: cols.offsetOf(c0), y: rows.offsetOf(r0), w: Math.max(1, cols.offsetOf(c1 + 1) - cols.offsetOf(c0)), h: Math.max(1, rows.offsetOf(r1 + 1) - rows.offsetOf(r0)) };
  }

  private stale(cells: Set<string>): string[] {
    const gone: string[] = [];
    const list = this.layer.list();
    const doomed = new Set<string>();
    for (const o of list) {
      if (o.kind !== 'spark' && !(o.kind === 'picture' && o.inCell)) continue;
      const [r, c] = o.anchor ? [o.anchor.r0, o.anchor.c0] : [this.grid.rows.indexAt(o.y), this.grid.cols.indexAt(o.x)];
      if (!cells.has(`${r},${c}`)) continue;
      gone.push(o.id);
      if (o.spark?.dataId) doomed.add(o.spark.dataId);
    }
    for (const id of doomed) {
      const still = list.some((o) => o.kind === 'spark' && o.spark?.dataId === id && !gone.includes(o.id));
      if (!still) gone.push(id);
    }
    return gone;
  }

  private async sparkline(): Promise<void> {
    if (!this.host.active()) return;
    const sel = await this.target();
    const tall = sel ? sel.r1 > sel.r0 : false;
    const defaults = {
      data: sel ? rangeLabel(sel) : '',
      location: sel ? (tall ? rangeLabel({ r0: sel.r0, c0: sel.c1 + 1, r1: sel.r1, c1: sel.c1 + 1 }) : rangeLabel({ r0: sel.r0, c0: sel.c1 + 1, r1: sel.r0, c1: sel.c1 + 1 })) : '',
    };
    const got = await askSparkline(defaults);
    if (!got) {
      this.grid.focus();
      return;
    }
    const data = parseRangeText(got.data);
    const place = parseRangeText(got.location);
    if (!data || !place || place.sheet) {
      alert('Type the data as a range such as A2:E6, and the location as cells on this sheet such as F2:F6.');
      return;
    }
    const d = data.range;
    const loc = place.range;
    const cells: [number, number][] = [];
    for (let r = loc.r0; r <= loc.r1; r++) for (let c = loc.c0; c <= loc.c1; c++) cells.push([r, c]);
    const rowsN = d.r1 - d.r0 + 1;
    const colsN = d.c1 - d.c0 + 1;
    let slices: { r0: number; c0: number; r1: number; c1: number }[];
    if (cells.length === 1) slices = [d];
    else if (rowsN === cells.length) slices = cells.map((_, i) => ({ r0: d.r0 + i, c0: d.c0, r1: d.r0 + i, c1: d.c1 }));
    else if (colsN === cells.length) slices = cells.map((_, i) => ({ r0: d.r0, c0: d.c0 + i, r1: d.r1, c1: d.c0 + i }));
    else {
      alert(`The location has ${cells.length} cells, but the data has ${rowsN} rows and ${colsN} columns. Make the location match one of them.`);
      return;
    }
    if (cells.length > 500) {
      alert('Create at most 500 sparklines at once.');
      return;
    }
    const add: FloatObject[] = [];
    cells.forEach(([r, c], i) => {
      const s = slices[i];
      const spark: FloatObject = { id: newId(), kind: 'spark', ...this.cellBox(r, c), spark: { ...got.spec } };
      if (data.sheet) spark.spark!.data = `'${data.sheet.replace(/'/g, "''")}'!${rangeLabel(s)}`;
      else {
        const range: FloatObject = { id: newId(), kind: 'range', ...this.rangeBox(s.r0, s.c0, s.r1, s.c1) };
        spark.spark!.dataId = range.id;
        add.push(range);
      }
      add.push(spark);
    });
    this.layer.edit(this.stale(new Set(cells.map(([r, c]) => `${r},${c}`))), add);
    this.grid.focus();
  }

  private clearSparklines(): void {
    if (!this.host.active()) return;
    const s = this.grid.selection();
    const cells = new Set<string>();
    for (let r = s.r0; r <= Math.min(s.r1, s.r0 + 2000); r++) for (let c = s.c0; c <= Math.min(s.c1, s.c0 + 200); c++) cells.add(`${r},${c}`);
    const gone = this.stale(cells);
    if (gone.length) this.layer.edit(gone, []);
  }

  private async cellPicture(f: File): Promise<void> {
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
    const [r, c] = this.grid.activeCell();
    const pic: FloatObject = { id: newId(), kind: 'picture', inCell: true, ...this.cellBox(r, c), picture: { src, name: f.name } };
    this.layer.edit(this.stale(new Set([`${r},${c}`])), [pic]);
    this.grid.focus();
  }

  private async target(): Promise<Range | null> {
    const s = this.grid.selection();
    if (s.r0 !== s.r1 || s.c0 !== s.c1) return s;
    const [r, c] = this.grid.activeCell();
    const { area } = await this.eng.region(this.host.book(), this.grid.sheetIndex, r, c);
    return { r0: area[0], c0: area[1], r1: area[2], c1: area[3] };
  }

  private async insertPivotChart(): Promise<void> {
    if (!this.host.active()) return;
    const name = this.host.pivotHere?.() ?? null;
    if (!name) {
      this.host.say?.('Select a cell inside a PivotTable first, or create a PivotTable.');
      return;
    }
    const spec: ChartSpec = { ...blankChart('column', ''), pivot: name };
    const got = await this.editor.open(spec, 'Insert PivotChart');
    if (!got) return;
    const o = this.layer.viewOrigin();
    this.layer.add({ kind: 'chart', x: o.x, y: o.y, w: 520, h: 330, chart: got });
  }

  private async insertChart(title = 'Insert chart'): Promise<void> {
    if (!this.host.active()) return;
    const r = await this.target();
    const range = r ? rangeLabel(r) : '';
    let type = blankChart('column', range).type;
    if (r) {
      const m = await readMatrix(this.eng, this.host.book(), this.grid.sheetIndex, r);
      type = recommend(m)[0] ?? 'column';
    }
    const spec = blankChart(type, range);
    const got = await this.editor.open(spec, title);
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
