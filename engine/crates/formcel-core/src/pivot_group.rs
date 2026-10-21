use super::*;
use crate::numfmt;

const PART: char = '\u{1e}';
const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
pub const UNITS: [&str; 7] = ["years", "quarters", "months", "days", "hours", "minutes", "seconds"];

#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    pub field: String,
    pub date: bool,
    pub units: Vec<String>,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub by: f64,
}

fn opt(x: Option<f64>) -> String {
    x.map_or(String::new(), |v| format!("{v}"))
}

impl Group {
    pub fn line(&self) -> String {
        [self.field.clone(), if self.date { "d" } else { "n" }.to_string(), self.units.join(","), opt(self.start), opt(self.end), format!("{}", self.by)].join(&PART.to_string())
    }

    pub fn parse(s: &str) -> Option<Group> {
        let q: Vec<&str> = s.split(PART).collect();
        if q.len() < 6 || q[0].is_empty() {
            return None;
        }
        let by: f64 = q[5].parse().ok()?;
        let units: Vec<String> = q[2].split(',').filter(|u| UNITS.contains(u)).map(str::to_string).collect();
        let date = q[1] == "d";
        if (date && units.is_empty()) || !(by.is_finite() && by > 0.0) {
            return None;
        }
        Some(Group { field: q[0].to_string(), date, units, start: q[3].parse().ok(), end: q[4].parse().ok(), by })
    }
}

fn unit_title(u: &str) -> &'static str {
    match u {
        "years" => "Years",
        "quarters" => "Quarters",
        "months" => "Months",
        "days" => "Days",
        "hours" => "Hours",
        "minutes" => "Minutes",
        _ => "Seconds",
    }
}

fn iso(serial: f64) -> String {
    match numfmt::ymd(serial) {
        Some((y, m, d)) => format!("{y:04}-{m:02}-{d:02}"),
        None => format!("{serial}"),
    }
}

fn unique(names: &[String], want: String) -> String {
    let mut name = want.clone();
    let mut k = 2;
    while names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
        name = format!("{want} {k}");
        k += 1;
    }
    name
}

fn bin_label(x: f64) -> String {
    format!("{x}")
}

fn date_cells(g: &Group, v: &Value) -> Vec<(Value, String)> {
    let blank = || g.units.iter().map(|_| (Value::Empty, String::new())).collect::<Vec<_>>();
    let Value::Number(n) = v else { return blank() };
    if let Some(s) = g.start {
        if *n < s.floor() {
            let t = format!("<{}", iso(s));
            return g.units.iter().map(|_| (Value::Number(f64::MIN / 2.0), t.clone())).collect();
        }
    }
    if let Some(e) = g.end {
        if *n >= e.floor() + 1.0 {
            let t = format!(">{}", iso(e));
            return g.units.iter().map(|_| (Value::Number(f64::MAX / 2.0), t.clone())).collect();
        }
    }
    let Some((y, m, d)) = numfmt::ymd(*n) else { return blank() };
    let (h, mi, s) = numfmt::hms(*n);
    let multi = g.units.iter().any(|u| u == "months" || u == "years" || u == "quarters");
    g.units
        .iter()
        .map(|u| match u.as_str() {
            "years" => (Value::Number(y as f64), y.to_string()),
            "quarters" => (Value::Number(((m - 1) / 3 + 1) as f64), format!("Qtr{}", (m - 1) / 3 + 1)),
            "months" => (Value::Number(m as f64), MONTHS[(m - 1).clamp(0, 11) as usize].to_string()),
            "days" => {
                if g.by > 1.0 {
                    let base = g.start.unwrap_or(0.0).floor();
                    let lo = base + ((n.floor() - base) / g.by).floor() * g.by;
                    (Value::Number(lo), format!("{} - {}", iso(lo), iso(lo + g.by - 1.0)))
                } else if multi {
                    (Value::Number(d as f64), d.to_string())
                } else {
                    (Value::Number(n.floor()), iso(*n))
                }
            }
            "hours" => (Value::Number(h as f64), h.to_string()),
            "minutes" => (Value::Number(mi as f64), mi.to_string()),
            _ => (Value::Number(s as f64), s.to_string()),
        })
        .collect()
}

fn number_cell(g: &Group, lo: f64, hi: f64, v: &Value) -> (Value, String) {
    let Value::Number(n) = v else { return (Value::Empty, String::new()) };
    if *n < lo {
        return (Value::Number(f64::MIN / 2.0), format!("<{}", bin_label(lo)));
    }
    if *n > hi {
        return (Value::Number(f64::MAX / 2.0), format!(">{}", bin_label(hi)));
    }
    let k = ((n - lo) / g.by).floor();
    let a = lo + k * g.by;
    let whole = lo.fract() == 0.0 && g.by.fract() == 0.0;
    let b = if whole { a + g.by - 1.0 } else { a + g.by };
    (Value::Number(a), format!("{}-{}", bin_label(a), bin_label(b)))
}

pub(super) fn apply(mut data: Data, groups: &[Group]) -> Data {
    for g in groups {
        let Some(f) = data.names.iter().position(|n| n.eq_ignore_ascii_case(&g.field)) else { continue };
        let rows = data.vals.len();
        if g.date {
            let units: Vec<String> = UNITS.iter().filter(|u| g.units.iter().any(|x| x == *u)).map(|u| u.to_string()).collect();
            if units.is_empty() {
                continue;
            }
            let ordered = Group { units, ..g.clone() };
            let mut cols: Vec<(Vec<Value>, Vec<String>)> = ordered.units.iter().map(|_| (Vec::with_capacity(rows), Vec::with_capacity(rows))).collect();
            for r in 0..rows {
                for (i, (v, t)) in date_cells(&ordered, &data.vals[r][f]).into_iter().enumerate() {
                    cols[i].0.push(v);
                    cols[i].1.push(t);
                }
            }
            for (u, (vs, ts)) in ordered.units.iter().zip(cols) {
                let name = unique(&data.names, unit_title(u).to_string());
                data.names.push(name);
                for (r, (v, t)) in vs.into_iter().zip(ts).enumerate() {
                    data.vals[r].push(v);
                    data.txt[r].push(t);
                }
            }
        } else {
            let nums: Vec<f64> = data.vals.iter().filter_map(|r| if let Value::Number(n) = &r[f] { Some(*n) } else { None }).collect();
            if nums.is_empty() {
                continue;
            }
            let lo = g.start.unwrap_or_else(|| nums.iter().copied().fold(f64::INFINITY, f64::min));
            let hi = g.end.unwrap_or_else(|| nums.iter().copied().fold(f64::NEG_INFINITY, f64::max));
            let name = unique(&data.names, format!("{} groups", g.field));
            data.names.push(name);
            for r in 0..rows {
                let (v, t) = number_cell(g, lo, hi, &data.vals[r][f]);
                data.vals[r].push(v);
                data.txt[r].push(t);
            }
        }
    }
    data
}
