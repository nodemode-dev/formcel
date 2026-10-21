use formcel_core::{parse_a1, to_a1, Addr, Changed, Dir, Workbook as CoreBook, MAX_COLS, MAX_ROWS, VERSION};
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

    fn rename_sheet(&mut self, sheet: usize, name: &str) -> PyResult<()> {
        self.inner.rename_sheet(sheet, name).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn define_name(&mut self, name: &str, refers: &str) -> PyResult<()> {
        self.inner.define_name(name, refers).map(|_| ()).map_err(|e| PyValueError::new_err(e.to_string()))
    }

    fn names(&self) -> Vec<(String, String)> {
        self.inner.names()
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
    fn rules(&self, sheet: usize) -> Vec<String> {
        self.inner.rule_lines(sheet)
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

#[pymodule]
fn formcel_engine(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(version, m)?)?;
    m.add_function(wrap_pyfunction!(offset, m)?)?;
    m.add_class::<Workbook>()?;
    m.add("MAX_ROWS", MAX_ROWS)?;
    m.add("MAX_COLS", MAX_COLS)?;
    Ok(())
}
