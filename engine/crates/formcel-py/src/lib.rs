use formcel_core::{parse_a1, to_a1, Addr, Changed, Dir, Value, Workbook as CoreBook, MAX_COLS, MAX_ROWS, VERSION};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

#[pyclass(name = "Workbook")]
struct Workbook {
    inner: CoreBook,
}

#[pymethods]
impl Workbook {
    #[new]
    fn new() -> Self {
        Workbook { inner: CoreBook::new() }
    }

    fn sheet_names(&self) -> Vec<String> {
        self.inner.sheet_names()
    }

    fn calc(&mut self, cmd: &str) -> String {
        self.inner.calc_run(cmd).0
    }

    #[pyo3(signature = (sheet = None))]
    fn protection(&self, sheet: Option<usize>) -> Vec<String> {
        self.inner.protection_lines(sheet)
    }

    #[pyo3(signature = (lines, sheet = None))]
    fn load_protection(&mut self, lines: Vec<String>, sheet: Option<usize>) -> bool {
        self.inner.load_protection(sheet, &lines)
    }

    fn set_user(&mut self, name: &str) {
        self.inner.set_user(name);
    }

    fn is_final(&self) -> bool {
        self.inner.is_final()
    }

    #[pyo3(signature = (op, sheet, r0, c0, r1, c1))]
    fn guard(&self, op: &str, sheet: usize, r0: u32, c0: u32, r1: u32, c1: u32) -> PyResult<()> {
        let area = formcel_core::formula::Area { r0, c0, r1, c1 };
        self.inner.guard(op, sheet, area).map_err(pyo3::exceptions::PyPermissionError::new_err)
    }

    fn guard_cells(&self, sheet: usize, cells: Vec<(u32, u32)>) -> PyResult<()> {
        self.inner.guard_cells(sheet, &cells).map_err(pyo3::exceptions::PyPermissionError::new_err)
    }

    fn hides_formula(&self, sheet: usize, row: u32, col: u32) -> bool {
        self.inner.hides_formula(sheet, row, col)
    }

    fn cell_flags(&self, sheet: usize, row: u32, col: u32) -> u8 {
        self.inner.cell_flags(sheet, row, col)
    }

    fn add_sheet(&mut self, name: &str) -> usize {
        self.inner.add_sheet(name)
    }

    #[pyo3(signature = (a1, raw, sheet = 0))]
    fn set(&mut self, a1: &str, raw: &str, sheet: usize) -> PyResult<String> {
        let addr = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.set_input(sheet, addr, raw).map(|v| v.to_string()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn get(&self, a1: &str, sheet: usize) -> PyResult<String> {
        let addr = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.get(sheet, addr).map(|v| v.to_string()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (edits, sheet = 0))]
    fn apply(&mut self, edits: Vec<(String, String)>, sheet: usize) -> PyResult<Vec<(String, String)>> {
        let mut parsed = Vec::with_capacity(edits.len());
        for (a1, raw) in edits {
            parsed.push((parse_a1(&a1).map_err(|e| PyValueError::new_err(e.to_string()))?, raw));
        }
        self.inner.apply(sheet, &parsed).map(pairs).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (cells, sheet = 0))]
    fn load(&mut self, cells: Vec<(u32, u32, String)>, sheet: usize) -> PyResult<usize> {
        let edits: Vec<(Addr, String)> = cells.into_iter().map(|(row, col, raw)| (Addr { row, col }, raw)).collect();
        self.inner.load(sheet, &edits).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (sheet = 0))]
    fn cells(&self, sheet: usize) -> PyResult<Vec<(u32, u32, String)>> {
        let cells = self.inner.inputs(sheet).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(cells.into_iter().map(|(a, t)| (a.row, a.col, t)).collect())
    }

    #[pyo3(signature = (sheet = 0))]
    fn auto_formats(&self, sheet: usize) -> Vec<(u32, u32, String)> {
        self.inner.auto_formats(sheet).into_iter().map(|(a, c)| (a.row, a.col, c)).collect()
    }

    #[pyo3(signature = (sheet = 0))]
    fn results(&self, sheet: usize) -> PyResult<Vec<(u32, u32, char, String)>> {
        let cells = self.inner.results(sheet).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(cells.into_iter().map(|(a, k, t)| (a.row, a.col, k, t)).collect())
    }

    #[pyo3(signature = (sheet = 0))]
    fn typed(&self, sheet: usize) -> PyResult<Vec<(u32, u32, char, String)>> {
        let cells = self.inner.typed(sheet).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(cells.into_iter().map(|(a, k, t)| (a.row, a.col, k, t)).collect())
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn input(&self, a1: &str, sheet: usize) -> PyResult<String> {
        let addr = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.input(sheet, addr))
    }

    #[pyo3(signature = (sheet = 0))]
    fn values(&self, sheet: usize) -> PyResult<Vec<(u32, u32, String)>> {
        let Some(bottom) = self.inner.extent(sheet).map_err(|e| PyValueError::new_err(e.to_string()))? else {
            return Ok(Vec::new());
        };
        let cells = self.inner.read(sheet, Addr { row: 0, col: 0 }, bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(cells.into_iter().map(|(a, v)| (a.row, a.col, v.to_string())).collect())
    }

    #[pyo3(signature = (sheet = 0))]
    fn raw_values(&self, sheet: usize) -> PyResult<Vec<(u32, u32, char, String)>> {
        let Some(bottom) = self.inner.extent(sheet).map_err(|e| PyValueError::new_err(e.to_string()))? else {
            return Ok(Vec::new());
        };
        let cells = self.inner.read_raw(sheet, Addr { row: 0, col: 0 }, bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(cells
            .into_iter()
            .filter(|(_, v)| !matches!(v, Value::Empty))
            .map(|(a, v)| {
                let k = match v {
                    Value::Number(_) => 'n',
                    Value::Bool(_) => 'b',
                    Value::Error(_) => 'e',
                    _ => 't',
                };
                (a.row, a.col, k, v.to_string())
            })
            .collect())
    }

    fn rename_sheet(&mut self, sheet: usize, name: &str) -> PyResult<()> {
        self.inner.rename_sheet(sheet, name).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn define_name(&mut self, name: &str, refers: &str) -> PyResult<()> {
        self.inner.define_name(name, refers).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn names(&self) -> Vec<(String, String)> {
        self.inner.names()
    }

    fn name_tool(&mut self, op: &str, args: &str) -> String {
        self.inner.name_tool_wire(op, args)
    }

    fn set_name_comment(&mut self, name: &str, comment: &str) -> PyResult<()> {
        self.inner.set_name_comment(name, comment).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn name_notes(&self) -> Vec<(String, String)> {
        self.inner.name_notes()
    }

    #[pyo3(signature = (folder, name))]
    fn set_file_name(&mut self, folder: &str, name: &str) {
        self.inner.set_file_name(folder, name);
    }

    fn host_pending(&self) -> Vec<String> {
        self.inner.host_pending()
    }

    fn host_keys(&self) -> Vec<String> {
        self.inner.host_keys()
    }

    #[pyo3(signature = (key, data = None))]
    fn host_set(&mut self, key: &str, data: Option<&str>) -> Vec<(String, String)> {
        pairs(self.inner.host_set(key, data))
    }

    fn host_custom(&mut self, names: Vec<String>) -> Vec<(String, String)> {
        pairs(self.inner.host_custom(&names))
    }

    #[pyo3(signature = (a1, levels = 1, dependents = false, sheet = 0))]
    fn trace(&self, a1: &str, levels: u32, dependents: bool, sheet: usize) -> PyResult<Vec<(usize, u32, u32, u32, u32, usize, u32, u32, u32)>> {
        let at = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let list = if dependents { self.inner.dependent_arrows(sheet, at, levels) } else { self.inner.precedent_arrows(sheet, at, levels) };
        Ok(list.into_iter().map(|a| (a.from_sheet, a.from.r0, a.from.c0, a.from.r1, a.from.c1, a.to_sheet, a.to.row, a.to.col, a.level)).collect())
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn evaluate_steps(&self, a1: &str, sheet: usize) -> PyResult<Vec<(String, String, String)>> {
        let at = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.evaluate_steps(sheet, at).into_iter().map(|[b, c, a]| (b, c, a)).collect())
    }

    #[pyo3(signature = (top, bottom, code, sheet = 0))]
    fn set_format(&mut self, top: &str, bottom: &str, code: &str, sheet: usize) -> PyResult<Vec<(String, String)>> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.set_format(sheet, t, b, code).map(|e| pairs(e.cells)).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn format_code(&self, a1: &str, sheet: usize) -> PyResult<Option<String>> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.format_code(sheet, a))
    }

    #[pyo3(signature = (sheet = 0))]
    fn formats(&self, sheet: usize) -> Vec<(u32, u32, String)> {
        self.inner.formats(sheet).into_iter().map(|(a, c)| (a.row, a.col, c)).collect()
    }

    #[pyo3(signature = (cells, sheet = 0))]
    fn load_formats(&mut self, cells: Vec<(u32, u32, String)>, sheet: usize) -> PyResult<usize> {
        let cells: Vec<(Addr, String)> = cells.into_iter().map(|(row, col, c)| (Addr { row, col }, c)).collect();
        self.inner.load_formats(sheet, &cells).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (top, bottom, patch, sheet = 0))]
    fn set_style(&mut self, top: &str, bottom: &str, patch: &str, sheet: usize) -> PyResult<usize> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.set_styles(sheet, &[(t, b, patch.to_string())]).map(|e| e.styles.len()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn style(&self, a1: &str, sheet: usize) -> PyResult<Option<String>> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.style_text(sheet, a))
    }

    #[pyo3(signature = (sheet = 0))]
    fn styles(&self, sheet: usize) -> Vec<(u32, u32, String)> {
        self.inner.styles(sheet).into_iter().map(|(a, s)| (a.row, a.col, s)).collect()
    }

    #[pyo3(signature = (cells, sheet = 0))]
    fn load_styles(&mut self, cells: Vec<(u32, u32, String)>, sheet: usize) -> PyResult<usize> {
        let cells: Vec<(Addr, String)> = cells.into_iter().map(|(row, col, s)| (Addr { row, col }, s)).collect();
        self.inner.load_styles(sheet, &cells).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (top, bottom, keys, header = false, case = false, sheet = 0))]
    fn sort(&mut self, top: &str, bottom: &str, keys: Vec<(u32, bool)>, header: bool, case: bool, sheet: usize) -> PyResult<usize> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let keys: Vec<formcel_core::sort::SortKey> = keys.into_iter().map(|(col, descending)| formcel_core::sort::SortKey::value(col, descending)).collect();
        let area = formcel_core::formula::Area { r0: t.row, c0: t.col, r1: b.row, c1: b.col };
        self.inner.sort(sheet, area, &keys, header, case).map(|e| e.cells.len()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn region(&self, a1: &str, sheet: usize) -> PyResult<(String, String)> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let r = self.inner.region(sheet, a).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok((to_a1(Addr { row: r.r0, col: r.c0 }), to_a1(Addr { row: r.r1, col: r.c1 })))
    }

    #[pyo3(signature = (top, bottom, mode = "center", sheet = 0))]
    fn merge(&mut self, top: &str, bottom: &str, mode: &str, sheet: usize) -> PyResult<usize> {
        use formcel_core::MergeMode;
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let m = match mode {
            "center" => MergeMode::Center,
            "across" => MergeMode::Across,
            "cells" => MergeMode::Cells,
            "unmerge" => MergeMode::Unmerge,
            _ => return Err(PyValueError::new_err(format!("unknown merge mode {mode}"))),
        };
        self.inner.merge(sheet, t, b, m).map(|_| self.inner.merges(sheet).len()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (sheet = 0))]
    fn merges(&self, sheet: usize) -> Vec<(u32, u32, u32, u32)> {
        self.inner.merges(sheet).into_iter().map(|m| (m.r0, m.c0, m.r1, m.c1)).collect()
    }

    #[pyo3(signature = (areas, sheet = 0))]
    fn load_merges(&mut self, areas: Vec<(u32, u32, u32, u32)>, sheet: usize) -> PyResult<usize> {
        let list: Vec<formcel_core::formula::Area> = areas.into_iter().map(|(r0, c0, r1, c1)| formcel_core::formula::Area { r0, c0, r1, c1 }).collect();
        self.inner.load_merges(sheet, &list).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn theme(&self) -> String {
        self.inner.theme_text()
    }

    fn load_theme(&mut self, text: &str) -> bool {
        self.inner.load_theme(text)
    }

    fn set_theme(&mut self, text: &str) -> PyResult<()> {
        self.inner.set_theme(text).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn cell_styles(&self) -> Vec<String> {
        self.inner.named_lines()
    }

    fn load_cell_styles(&mut self, lines: Vec<String>) {
        self.inner.load_named(&lines)
    }

    #[pyo3(signature = (name, a1, parts = "nafbp", sheet = 0))]
    fn define_style(&mut self, name: &str, a1: &str, parts: &str, sheet: usize) -> PyResult<()> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.define_style(name, sheet, a, parts).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn delete_style(&mut self, name: &str) -> PyResult<()> {
        self.inner.delete_style(name).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (top, bottom, name, sheet = 0))]
    fn apply_style(&mut self, top: &str, bottom: &str, name: &str, sheet: usize) -> PyResult<()> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.apply_style(sheet, t, b, name).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn effective_style(&self, a1: &str, sheet: usize) -> PyResult<String> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.effective_style(sheet, a).text())
    }

    #[pyo3(signature = (sheet = 0))]
    fn links(&self, sheet: usize) -> Vec<(u32, u32, String)> {
        self.inner.links(sheet).into_iter().map(|(a, t)| (a.row, a.col, t)).collect()
    }

    #[pyo3(signature = (cells, sheet = 0))]
    fn load_links(&mut self, cells: Vec<(u32, u32, String)>, sheet: usize) -> PyResult<usize> {
        let cells: Vec<(Addr, String)> = cells.into_iter().map(|(row, col, t)| (Addr { row, col }, t)).collect();
        let n = self.inner.load_links(sheet, &cells).map_err(|e| PyValueError::new_err(e.to_string()));
        self.inner.take_link_changes();
        n
    }

    #[pyo3(signature = (sheet = 0))]
    fn chips(&self, sheet: usize) -> Vec<(u32, u32, String)> {
        self.inner.chips_of(sheet).into_iter().map(|(a, t)| (a.row, a.col, t)).collect()
    }

    #[pyo3(signature = (sheet = 0))]
    fn chip_links(&self, sheet: usize) -> Vec<(u32, u32, String)> {
        self.inner.chip_links(sheet).into_iter().map(|(a, t)| (a.row, a.col, t)).collect()
    }

    #[pyo3(signature = (cells, sheet = 0))]
    fn load_chips(&mut self, cells: Vec<(u32, u32, String)>, sheet: usize) -> PyResult<usize> {
        let cells: Vec<(Addr, String)> = cells.into_iter().map(|(row, col, t)| (Addr { row, col }, t)).collect();
        let n = self.inner.load_chips(sheet, &cells).map_err(|e| PyValueError::new_err(e.to_string()));
        self.inner.take_chip_changes();
        self.inner.take_record_changes();
        n
    }

    #[pyo3(signature = (sheet = None))]
    #[allow(clippy::type_complexity)]
    fn records(&self, sheet: Option<usize>) -> Vec<(String, String, String, String, i64, Vec<(String, String, String)>)> {
        self.inner.records_list(sheet).into_iter().map(|(id, r)| (id, r.kind, r.entity, r.provider, r.at, r.fields)).collect()
    }

    #[allow(clippy::type_complexity)]
    fn load_records(&mut self, items: Vec<(String, String, String, String, i64, Vec<(String, String, String)>)>) -> usize {
        let items: Vec<(String, String, String)> = items
            .into_iter()
            .map(|(id, kind, entity, provider, at, fields)| {
                let r = formcel_core::records::Record { kind: kind.clone(), entity, provider, at, fields };
                (id, kind, r.payload())
            })
            .collect();
        let n = self.inner.load_records(&items);
        self.inner.take_record_changes();
        n
    }

    fn record_payloads(&self) -> Vec<(String, String, String)> {
        self.inner.records_list(None).into_iter().map(|(id, r)| (id, r.kind.clone(), r.payload())).collect()
    }

    fn load_record_payloads(&mut self, items: Vec<(String, String, String)>) -> usize {
        let n = self.inner.load_records(&items);
        self.inner.take_record_changes();
        n
    }

    #[pyo3(signature = (a1, target, display = None, sheet = 0))]
    fn set_link(&mut self, a1: &str, target: &str, display: Option<&str>, sheet: usize) -> PyResult<()> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.set_link(sheet, a, target, display).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn link_at(&self, a1: &str, sheet: usize) -> PyResult<Option<String>> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.link_at(sheet, a))
    }

    #[pyo3(signature = (top, bottom, sheet = 0))]
    fn remove_links(&mut self, top: &str, bottom: &str, sheet: usize) -> PyResult<()> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.inner.remove_links(sheet, t, b).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (sheet = 0))]
    fn rules(&self, sheet: usize) -> Vec<String> {
        self.inner.rule_lines(sheet)
    }

    fn tables(&self) -> Vec<String> {
        self.inner.tables()
    }

    fn table_area(&self, text: &str) -> Option<(usize, u32, u32, u32, u32)> {
        self.inner.table_area_of(text).map(|(s, a)| (s, a.r0, a.c0, a.r1, a.c1))
    }

    fn load_tables(&mut self, lines: Vec<String>) -> usize {
        self.inner.load_tables(&lines)
    }

    #[pyo3(signature = (top, bottom, header = true, sheet = 0))]
    fn create_table(&mut self, top: &str, bottom: &str, header: bool, sheet: usize) -> PyResult<()> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let area = formcel_core::formula::Area { r0: t.row, c0: t.col, r1: b.row, c1: b.col };
        self.inner.create_table(sheet, area, header).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn pivots(&self) -> Vec<String> {
        self.inner.pivots()
    }

    fn load_pivots(&mut self, lines: Vec<String>) -> usize {
        self.inner.load_pivots(&lines)
    }

    fn model_lines(&self) -> Vec<String> {
        self.inner.model_lines()
    }

    fn load_model(&mut self, lines: Vec<String>) -> usize {
        self.inner.load_model(&lines)
    }

    fn model_run(&mut self, cmd: &str) -> String {
        self.inner.model_run(cmd).0
    }

    fn refresh_pivot(&mut self, name: &str) -> PyResult<()> {
        self.inner.refresh_pivot(name).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn create_pivot(&mut self, line: &str) -> PyResult<()> {
        self.inner.create_pivot(line).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn set_pivot(&mut self, name: &str, line: &str) -> PyResult<()> {
        self.inner.set_pivot(name, line).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn remove_pivot(&mut self, name: &str) -> PyResult<()> {
        self.inner.remove_pivot(name).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn set_table(&mut self, name: &str, line: &str) -> PyResult<()> {
        self.inner.set_table(name, line).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn remove_table(&mut self, name: &str) -> PyResult<()> {
        self.inner.remove_table(name).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn plain_formula(&self, a1: &str, sheet: usize) -> PyResult<Option<String>> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.plain_formula(sheet, a))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn file_formula(&self, a1: &str, sheet: usize) -> PyResult<Option<String>> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.file_formula(sheet, a))
    }

    #[pyo3(signature = (sheet = 0))]
    fn validations(&self, sheet: usize) -> Vec<String> {
        self.inner.validations(sheet)
    }

    #[pyo3(signature = (lines, sheet = 0))]
    fn load_validations(&mut self, lines: Vec<String>, sheet: usize) -> PyResult<usize> {
        self.inner.load_validations(sheet, &lines).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (top, bottom, line, sheet = 0))]
    fn set_validation(&mut self, top: &str, bottom: &str, line: &str, sheet: usize) -> PyResult<()> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let area = formcel_core::formula::Area { r0: t.row, c0: t.col, r1: b.row, c1: b.col };
        self.inner.set_validation(sheet, area, line).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, raw, sheet = 0))]
    fn check_input(&self, a1: &str, raw: &str, sheet: usize) -> PyResult<Option<String>> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.check_input(sheet, a, raw).map(|v| v.line()))
    }

    #[pyo3(signature = (a1, sheet = 0))]
    fn list_items(&self, a1: &str, sheet: usize) -> PyResult<Vec<String>> {
        let a = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.list_items(sheet, a))
    }

    #[pyo3(signature = (top, bottom, sheet = 0))]
    fn invalid_in(&self, top: &str, bottom: &str, sheet: usize) -> PyResult<Vec<String>> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self.inner.invalid_in(sheet, t, b).into_iter().map(to_a1).collect())
    }

    #[pyo3(signature = (sheet = 0))]
    fn filter(&self, sheet: usize) -> String {
        self.inner.filter_text(sheet)
    }

    #[pyo3(signature = (text, sheet = 0))]
    fn load_filter(&mut self, text: &str, sheet: usize) -> PyResult<bool> {
        self.inner.load_filter(sheet, text).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (text, sheet = 0))]
    fn set_filter(&mut self, text: &str, sheet: usize) -> PyResult<()> {
        self.inner.set_filter(sheet, text).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (sheet = 0))]
    fn reapply_filter(&mut self, sheet: usize) -> PyResult<()> {
        self.inner.reapply_filter(sheet).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (col, sheet = 0))]
    fn filter_values(&self, col: u32, sheet: usize) -> (Vec<String>, bool, bool) {
        self.inner.filter_values(sheet, col)
    }

    #[pyo3(signature = (lines, sheet = 0))]
    fn load_rules(&mut self, lines: Vec<String>, sheet: usize) -> PyResult<usize> {
        self.inner.load_rules(sheet, &lines).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (lines, sheet = 0))]
    fn set_rules(&mut self, lines: Vec<String>, sheet: usize) -> PyResult<()> {
        self.inner.set_rules(sheet, &lines).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (top, bottom, sheet = 0))]
    fn cf_in(&self, top: &str, bottom: &str, sheet: usize) -> PyResult<Vec<(String, String, String, String)>> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(self
            .inner
            .cf_in(sheet, t, b)
            .into_iter()
            .map(|(a, p)| {
                let bar = p.bar.map(|(f, t, c)| format!("{f:.2},{t:.2},{c:06x}")).unwrap_or_default();
                let icon = p.icon.map(|(s, i)| format!("{s}:{i}")).unwrap_or_default();
                (to_a1(a), p.style.map(|s| s.text()).unwrap_or_default(), bar, icon)
            })
            .collect())
    }

    fn undo(&mut self) -> Option<Vec<(String, String)>> {
        self.inner.undo().map(|e| pairs(e.cells))
    }

    fn redo(&mut self) -> Option<Vec<(String, String)>> {
        self.inner.redo().map(|e| pairs(e.cells))
    }

    #[pyo3(signature = (sheet, rows, at, n, insert = true))]
    fn shift(&mut self, sheet: usize, rows: bool, at: u32, n: u32, insert: bool) -> PyResult<(u32, i64)> {
        let s = if insert { self.inner.insert(sheet, rows, at, n) } else { self.inner.delete(sheet, rows, at, n) };
        s.map(|s| (s.at, s.delta)).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn delete_sheet(&mut self, sheet: usize) -> PyResult<()> {
        self.inner.delete_sheet(sheet).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn move_sheet(&mut self, from: usize, to: usize) -> PyResult<()> {
        self.inner.move_sheet(from, to).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (top, bottom, sheet = 0))]
    fn read(&self, top: &str, bottom: &str, sheet: usize) -> PyResult<Vec<(String, String)>> {
        let t = parse_a1(top).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let b = parse_a1(bottom).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let cells = self.inner.read(sheet, t, b).map_err(|e| PyValueError::new_err(e.to_string()))?;
        Ok(cells.into_iter().map(|(a, v)| (to_a1(a), v.to_string())).collect())
    }

    #[pyo3(signature = (sheet = 0))]
    fn extent(&self, sheet: usize) -> PyResult<Option<String>> {
        self.inner.extent(sheet).map(|o| o.map(to_a1)).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    #[pyo3(signature = (a1, direction, sheet = 0))]
    fn edge(&self, a1: &str, direction: &str, sheet: usize) -> PyResult<String> {
        let a: Addr = parse_a1(a1).map_err(|e| PyValueError::new_err(e.to_string()))?;
        let d = Dir::parse(direction).ok_or_else(|| PyValueError::new_err("direction is up, down, left or right"))?;
        self.inner.edge(sheet, a, d).map(to_a1).map_err(|e| PyValueError::new_err(e.to_string()))
    }
}

fn pairs(c: Changed) -> Vec<(String, String)> {
    c.into_iter().map(|(_, a, v)| (to_a1(a), v.to_string())).collect()
}

#[pyfunction]
fn version() -> &'static str {
    VERSION
}

#[pyfunction]
fn offset(src: &str, dr: i64, dc: i64) -> String {
    formcel_core::formula::offset_text(src, dr, dc)
}

#[pyfunction]
fn reads_as_text(raw: &str) -> bool {
    !raw.starts_with(['=', '\'']) && matches!(formcel_core::Value::parse_input(raw), formcel_core::Value::Text(_))
}

#[pyfunction]
fn set_locale(tag: &str) -> bool {
    formcel_core::locale::Locale::parse(tag).map(formcel_core::locale::set).is_some()
}

#[pymodule]
fn formcel_engine(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(version, m)?)?;
    m.add_function(wrap_pyfunction!(offset, m)?)?;
    m.add_function(wrap_pyfunction!(reads_as_text, m)?)?;
    m.add_function(wrap_pyfunction!(set_locale, m)?)?;
    m.add_class::<Workbook>()?;
    m.add("MAX_ROWS", MAX_ROWS)?;
    m.add("MAX_COLS", MAX_COLS)?;
    Ok(())
}
