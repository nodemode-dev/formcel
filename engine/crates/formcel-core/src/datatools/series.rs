use super::*;
use crate::numfmt;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Linear,
    Growth,
    Date,
    Auto,
}

fn month_len(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => 28 + i64::from((y % 4 == 0 && y % 100 != 0) || y % 400 == 0),
    }
}

fn add_months(serial: f64, n: i64) -> Option<f64> {
    let (y, m, d) = numfmt::ymd(serial)?;
    let total = y * 12 + (m - 1) + n;
    let (ny, nm) = (total.div_euclid(12), total.rem_euclid(12) + 1);
    numfmt::serial(ny, nm, d.min(month_len(ny, nm)))
}

fn add_weekdays(serial: f64, n: i64) -> f64 {
    let mut s = serial.floor();
    let dir = if n < 0 { -1.0 } else { 1.0 };
    let mut left = n.abs();
    while left > 0 {
        s += dir;
        let w = numfmt::weekday(s);
        if w != 1 && w != 7 {
            left -= 1;
        }
    }
    s
}

fn fit(ys: &[f64]) -> (f64, f64) {
    let n = ys.len() as f64;
    let sx: f64 = (1..=ys.len()).map(|i| i as f64).sum();
    let sy: f64 = ys.iter().sum();
    let sxy: f64 = ys.iter().enumerate().map(|(i, y)| (i + 1) as f64 * y).sum();
    let sxx: f64 = (1..=ys.len()).map(|i| (i * i) as f64).sum();
    let den = n * sxx - sx * sx;
    let slope = if den == 0.0 { 0.0 } else { (n * sxy - sx * sy) / den };
    (slope, (sy - slope * sx) / n)
}

impl Workbook {
    pub(super) fn t_series(&mut self, sheet: usize, p: &[String]) -> Out {
        let Some(area) = area_of(arg(p, 1)) else { return bad("bad range") };
        let by_rows = arg(p, 2) == "rows";
        let kind = match arg(p, 3) {
            "growth" => Kind::Growth,
            "date" => Kind::Date,
            "auto" => Kind::Auto,
            _ => Kind::Linear,
        };
        let unit = arg(p, 4).to_string();
        let step_text = arg(p, 5).trim();
        let step: Option<f64> = if step_text.is_empty() { None } else { Some(step_text.parse::<f64>().map_err(|_| EngineError::BadStyle("The step value is not a number.".into()))?) };
        let stop_text = arg(p, 6).trim();
        let stop: Option<f64> = if stop_text.is_empty() {
            None
        } else {
            let v = Value::parse_input(stop_text);
            match v {
                Value::Number(n) => Some(n),
                _ => return bad("The stop value is not a number or a date."),
            }
        };
        let trend = flag(p, 7);
        let lanes: Vec<Vec<Addr>> = if by_rows {
            (area.r0..=area.r1).map(|r| (area.c0..=area.c1).map(|c| a(r, c)).collect()).collect()
        } else {
            (area.c0..=area.c1).map(|c| (area.r0..=area.r1).map(|r| a(r, c)).collect()).collect()
        };
        let mut edits: Vec<(Addr, String)> = Vec::new();
        let mut formats = Vec::new();
        let mut done = 0usize;
        for lane in lanes {
            let nums: Vec<f64> = lane.iter().map_while(|ad| match self.cell_val(sheet, *ad) {
                Value::Number(n) => Some(n),
                _ => None,
            }).collect();
            let Some(&start) = nums.first() else { continue };
            let date = kind == Kind::Date || self.fmts.get(&(sheet, lane[0])).is_some_and(|f| f.is_date());
            let known = if trend || (kind == Kind::Auto && nums.len() > 1) { nums.len().min(lane.len()) } else { 1 };
            let mut slope = step.unwrap_or(1.0);
            let mut geometric = kind == Kind::Growth;
            if kind == Kind::Auto {
                if nums.len() > 1 {
                    slope = (nums[nums.len() - 1] - nums[0]) / (nums.len() - 1) as f64;
                } else {
                    slope = 0.0;
                }
                geometric = false;
            }
            let predict: Box<dyn Fn(usize) -> f64> = if trend && known >= 2 {
                let ys = &nums[..known];
                if kind == Kind::Growth {
                    if ys.iter().any(|y| *y <= 0.0) {
                        return bad("A growth trend needs positive numbers.");
                    }
                    let logs: Vec<f64> = ys.iter().map(|y| y.ln()).collect();
                    let (b, a0) = fit(&logs);
                    Box::new(move |i| (a0 + b * (i + 1) as f64).exp())
                } else {
                    let (b, a0) = fit(ys);
                    Box::new(move |i| a0 + b * (i + 1) as f64)
                }
            } else {
                let (s, g, b0) = (slope, geometric, start);
                let unit = unit.clone();
                Box::new(move |i| {
                    let n = i as i64;
                    if kind == Kind::Date {
                        let st = s as i64;
                        match unit.as_str() {
                            "weekday" => add_weekdays(b0, st * n),
                            "month" => add_months(b0, st * n).unwrap_or(f64::NAN),
                            "year" => add_months(b0, st * n * 12).unwrap_or(f64::NAN),
                            _ => b0 + (s * n as f64),
                        }
                    } else if g {
                        b0 * s.powi(i as i32)
                    } else {
                        b0 + s * n as f64
                    }
                })
            };
            let open_ended = stop.is_some() && lane.len() == 1;
            let count = if open_ended { 100_000 } else { lane.len() };
            let first = if (trend || kind == Kind::Auto) && known >= 2 { known } else { 1 };
            let rising = match (stop, kind) {
                (Some(_), Kind::Growth) => step.unwrap_or(1.0) >= 1.0,
                _ => slope >= 0.0,
            };
            for i in first..count {
                let v = predict(i);
                if !v.is_finite() {
                    break;
                }
                if let Some(s) = stop {
                    if (rising && v > s + 1e-9) || (!rising && v < s - 1e-9) {
                        break;
                    }
                }
                let to = if by_rows { a(lane[0].row, lane[0].col + i as u32) } else { a(lane[0].row + i as u32, lane[0].col) };
                if to.row >= crate::MAX_ROWS || to.col >= crate::MAX_COLS {
                    break;
                }
                let raw = if date {
                    match numfmt::ymd(v) {
                        Some((y, m, d)) if v.fract() == 0.0 => format!("{y:04}-{m:02}-{d:02}"),
                        _ => Value::Number(v).to_string(),
                    }
                } else {
                    Value::Number((v * 1e12).round() / 1e12).to_string()
                };
                edits.push((to, raw));
                let style = self.styles.get(&(sheet, lane[0])).map(|s| s.0.clone()).unwrap_or_default();
                let code = self.codes.get(&(sheet, lane[0])).map(|c| c.0.clone()).unwrap_or_default();
                formats.push((to, Some(style), Some(code)));
                done += 1;
            }
        }
        if edits.is_empty() {
            return bad("Put a starting number or date in the first cell of each row or column of the selection.");
        }
        let mut out = Effect { cells: self.apply(sheet, &edits)?, ..Effect::default() };
        out = out.join(self.put_formats(sheet, &formats)?);
        let last = edits.iter().fold((0u32, 0u32), |m, (ad, _)| (m.0.max(ad.row), m.1.max(ad.col)));
        Ok((out, say(&format!("Filled {done} cells.\n{}\t{}", last.0, last.1))))
    }
}
