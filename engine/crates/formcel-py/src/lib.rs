use formcel_core::{parse_a1, to_a1, Addr, Changed, Dir, Workbook as CoreBook, MAX_COLS, MAX_ROWS, VERSION};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

#[pyclass(name = "Workbook", unsendable)]
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

    fn undo(&mut self) -> Option<Vec<(String, String)>> {
        self.inner.undo().map(pairs)
    }

    fn redo(&mut self) -> Option<Vec<(String, String)>> {
        self.inner.redo().map(pairs)
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

#[pymodule]
fn formcel_engine(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(version, m)?)?;
    m.add_class::<Workbook>()?;
    m.add("MAX_ROWS", MAX_ROWS)?;
    m.add("MAX_COLS", MAX_COLS)?;
    Ok(())
}
