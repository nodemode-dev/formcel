use formcel_core::{parse_a1, Workbook as CoreBook, MAX_COLS, MAX_ROWS, VERSION};
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
