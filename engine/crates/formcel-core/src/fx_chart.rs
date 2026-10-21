use super::*;

pub const SPARK_MARK: char = '\u{E000}';

impl Eval<'_> {
    pub(crate) fn call_chart(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        match name {
            "SPARKLINE" => Some(self.sparkline(a)),
            _ => None,
        }
    }

    fn sparkline(&self, a: &[Expr]) -> Result<Value, ErrKind> {
        if a.is_empty() || a.len() > 2 {
            return Err(ErrKind::Na);
        }
        let data = self.grid(self.arg(&a[0]))?;
        let mut kind = "line".to_string();
        let mut color = String::new();
        let mut neg = String::new();
        let mut lo: Option<f64> = None;
        let mut hi: Option<f64> = None;
        let mut width = 1.5_f64;
        if a.len() > 1 && !matches!(a[1], Expr::Missing) {
            let o = self.grid(self.arg(&a[1]))?;
            let rows: Vec<Vec<&Value>> = (0..o.rows).map(|r| (0..o.cols).map(|c| &o.data[r * o.cols + c]).collect()).collect();
            let pairs: Vec<(&Value, &Value)> = if o.cols >= 2 {
                rows.iter().map(|r| (r[0], r[1])).collect()
            } else if o.rows >= 2 {
                vec![(rows[0][0], rows[1][0])]
            } else {
                Vec::new()
            };
            for (k, v) in pairs {
                let key = text_of(k)?.to_ascii_lowercase();
                match key.as_str() {
                    "charttype" => {
                        let t = text_of(v)?.to_ascii_lowercase();
                        if matches!(t.as_str(), "line" | "bar" | "column" | "winloss") {
                            kind = t;
                        }
                    }
                    "color" | "linecolor" => color = text_of(v)?,
                    "negcolor" => neg = text_of(v)?,
                    "ymin" => lo = number_of(v).ok(),
                    "ymax" => hi = number_of(v).ok(),
                    "max" | "min" => {
                        if kind == "bar" {
                            let n = number_of(v).ok();
                            if key == "max" {
                                hi = n;
                            } else {
                                lo = n;
                            }
                        }
                    }
                    "linewidth" => width = number_of(v).unwrap_or(1.5),
                    _ => {}
                }
            }
        }
        let mut nums: Vec<String> = Vec::new();
        for v in &data.data {
            match v {
                Value::Number(n) => nums.push(format!("{}", n)),
                Value::Error(k) => return Err(*k),
                Value::Empty => nums.push(String::new()),
                Value::Bool(_) | Value::Text(_) => nums.push(String::new()),
            }
        }
        if nums.iter().all(|s| s.is_empty()) {
            return Err(ErrKind::Value);
        }
        let opt = |x: Option<f64>| x.map_or(String::new(), |n| format!("{}", n));
        Ok(Value::Text(format!(
            "{}SPK\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
            SPARK_MARK,
            kind,
            color.replace('\t', " "),
            neg.replace('\t', " "),
            opt(lo),
            opt(hi),
            width,
            nums.join(",")
        )))
    }
}
