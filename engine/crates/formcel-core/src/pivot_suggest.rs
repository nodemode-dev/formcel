use super::*;

const SEC: char = '\u{1d}';
const PREVIEW_ROWS: usize = 7;
const PREVIEW_COLS: usize = 5;
const MEASURE_HINTS: [&str; 16] = ["sales", "revenue", "amount", "total", "price", "cost", "profit", "qty", "quantity", "units", "income", "expense", "salary", "spend", "budget", "balance"];
const IDENT_WORDS: [&str; 6] = ["id", "zip", "code", "phone", "number", "no"];

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Text,
    Num,
    Date,
}

struct Col {
    name: String,
    kind: Kind,
    distinct: usize,
}

fn spread(k: usize) -> f64 {
    match k {
        0 | 1 => 0.0,
        2 => 45.0,
        3..=12 => 100.0,
        13..=25 => 70.0,
        26..=60 => 40.0,
        _ => 10.0,
    }
}

fn measure(name: &str) -> f64 {
    let low = name.to_lowercase();
    if MEASURE_HINTS.iter().any(|h| low.contains(h)) {
        100.0
    } else {
        60.0
    }
}

fn is_ident(name: &str) -> bool {
    let low = name.to_lowercase();
    IDENT_WORDS.iter().any(|w| low == *w || low.ends_with(&format!(" {w}")) || low.ends_with(&format!("_{w}")) || low.starts_with(&format!("{w} ")))
}

fn cell_text(c: &Cl) -> String {
    let clean: String = c.raw.chars().map(|ch| if ch.is_control() { ' ' } else { ch }).collect();
    let clean = clean.trim_start_matches('\'').to_string();
    match clean.parse::<f64>() {
        Ok(x) if c.pct => format!("{:.1}%", x * 100.0),
        Ok(x) if x.fract() == 0.0 => format!("{x}"),
        Ok(x) => format!("{x:.2}"),
        Err(_) => clean,
    }
}

fn preview(grid: &[Vec<Cl>]) -> String {
    let rows: Vec<String> = grid
        .iter()
        .filter(|r| !r.is_empty())
        .take(PREVIEW_ROWS)
        .map(|r| r.iter().take(PREVIEW_COLS).map(cell_text).collect::<Vec<_>>().join("\u{1f}"))
        .collect();
    rows.join("\u{1e}")
}

pub(super) fn run(wb: &Workbook, sheet: usize, s: usize, a: Area, t: String) -> Vec<String> {
    let data = wb.pivot_data(s, a);
    let n = data.vals.len();
    let mut cols: Vec<Col> = Vec::new();
    for (i, name) in data.names.iter().enumerate() {
        let filled: Vec<usize> = (0..n).filter(|&r| data.vals[r][i] != Value::Empty).collect();
        if filled.is_empty() {
            continue;
        }
        let numeric = filled.iter().filter(|&&r| matches!(data.vals[r][i], Value::Number(_))).count() * 5 >= filled.len() * 4;
        let mut seen: Vec<&String> = filled.iter().map(|&r| &data.txt[r][i]).collect();
        seen.sort();
        seen.dedup();
        let distinct = seen.len();
        if numeric {
            let date = filled.iter().take(5).any(|&r| wb.fmt(s, Addr { row: a.r0 + 1 + r as u32, col: a.c0 + i as u32 }).is_some_and(|f| f.is_date()));
            if date {
                cols.push(Col { name: name.clone(), kind: Kind::Date, distinct });
            } else if !is_ident(name) {
                cols.push(Col { name: name.clone(), kind: Kind::Num, distinct });
            }
        } else if distinct >= 2 && distinct <= 60 && distinct < n.max(3) {
            cols.push(Col { name: name.clone(), kind: Kind::Text, distinct });
        }
    }
    let texts: Vec<&Col> = cols.iter().filter(|c| c.kind == Kind::Text).collect();
    let nums: Vec<&Col> = cols.iter().filter(|c| c.kind == Kind::Num).collect();
    let dates: Vec<&Col> = cols.iter().filter(|c| c.kind == Kind::Date).collect();
    let base = Pivot { name: String::new(), sheet, row: 0, col: 0, src_sheet: s, src: a, table: t, grand_rows: true, grand_cols: true, subtotals: true, auto: true, out: None, rows: Vec::new(), cols: Vec::new(), values: Vec::new(), filters: Vec::new(), calc: Vec::new(), groups: Vec::new() };
    let vf = |f: &str, func: Func, show: Show| ValueField { field: f.to_string(), func, show, name: String::new(), base_field: String::new(), base_item: String::new() };
    let mut cands: Vec<(f64, String, Pivot)> = Vec::new();
    let mut top_nums: Vec<&&Col> = nums.iter().collect();
    top_nums.sort_by(|x, y| measure(&y.name).partial_cmp(&measure(&x.name)).unwrap_or(std::cmp::Ordering::Equal));
    for tx in texts.iter().take(4) {
        for nm in top_nums.iter().take(2) {
            let m = measure(&nm.name);
            let score = spread(tx.distinct) * 0.6 + m * 0.4;
            cands.push((score, format!("Sum of {} by {}", nm.name, tx.name), Pivot { rows: vec![tx.name.clone()], values: vec![vf(&nm.name, Func::Sum, Show::Normal)], ..base.clone() }));
            cands.push((score * 0.8, format!("Average {} by {}", nm.name, tx.name), Pivot { rows: vec![tx.name.clone()], values: vec![vf(&nm.name, Func::Average, Show::Normal)], ..base.clone() }));
            cands.push((score * 0.78, format!("Share of {} by {}", nm.name, tx.name), Pivot { rows: vec![tx.name.clone()], values: vec![vf(&nm.name, Func::Sum, Show::Grand)], ..base.clone() }));
        }
        if top_nums.len() >= 2 {
            let (n1, n2) = (&top_nums[0].name, &top_nums[1].name);
            cands.push((spread(tx.distinct) * 0.6 + (measure(n1) + measure(n2)) * 0.2 * 0.85, format!("{n1} and {n2} by {}", tx.name), Pivot { rows: vec![tx.name.clone()], values: vec![vf(n1, Func::Sum, Show::Normal), vf(n2, Func::Sum, Show::Normal)], ..base.clone() }));
        }
        cands.push((spread(tx.distinct) * 0.6 + 20.0, format!("Count of rows by {}", tx.name), Pivot { rows: vec![tx.name.clone()], values: vec![vf(&tx.name, Func::Count, Show::Normal)], ..base.clone() }));
    }
    for (i, t1) in texts.iter().enumerate().take(4) {
        for t2 in texts.iter().skip(i + 1).take(3) {
            let cells = t1.distinct * t2.distinct;
            let fit = if cells <= 60 { 100.0 } else if cells <= 150 { 60.0 } else { 20.0 };
            for nm in top_nums.iter().take(1) {
                let score = (spread(t1.distinct) + spread(t2.distinct)) * 0.3 + measure(&nm.name) * 0.2 + fit * 0.2 - 8.0;
                if t2.distinct <= 8 {
                    cands.push((score, format!("Sum of {} by {} across {}", nm.name, t1.name, t2.name), Pivot { rows: vec![t1.name.clone()], cols: vec![t2.name.clone()], values: vec![vf(&nm.name, Func::Sum, Show::Normal)], ..base.clone() }));
                }
                cands.push((score - 6.0, format!("Sum of {} by {} and {}", nm.name, t1.name, t2.name), Pivot { rows: vec![t1.name.clone(), t2.name.clone()], values: vec![vf(&nm.name, Func::Sum, Show::Normal)], ..base.clone() }));
            }
        }
    }
    let taken: Vec<String> = data.names.iter().map(|x| x.to_lowercase()).collect();
    let free = |w: &str| !taken.iter().any(|x| x == w);
    if free("years") && free("months") {
        for d in dates.iter().take(2) {
            let g = Group { field: d.name.clone(), date: true, units: vec!["years".to_string(), "months".to_string()], start: None, end: None, by: 1.0 };
            for nm in top_nums.iter().take(2) {
                cands.push((60.0 + measure(&nm.name) * 0.4 + 5.0, format!("Sum of {} by month of {}", nm.name, d.name), Pivot { rows: vec!["Years".to_string(), "Months".to_string()], values: vec![vf(&nm.name, Func::Sum, Show::Normal)], groups: vec![g.clone()], ..base.clone() }));
                if let Some(tx) = texts.iter().find(|c| c.distinct <= 8) {
                    let g2 = Group { units: vec!["years".to_string()], ..g.clone() };
                    cands.push((55.0 + measure(&nm.name) * 0.4, format!("Sum of {} by year of {} across {}", nm.name, d.name, tx.name), Pivot { rows: vec!["Years".to_string()], cols: vec![tx.name.clone()], values: vec![vf(&nm.name, Func::Sum, Show::Normal)], groups: vec![g2], ..base.clone() }));
                }
            }
        }
    }
    if texts.is_empty() && dates.is_empty() {
        if let Some(n1) = top_nums.first() {
            cands.push((30.0, format!("Sum of {}", n1.name), Pivot { values: vec![vf(&n1.name, Func::Sum, Show::Normal)], ..base.clone() }));
        }
    }
    cands.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    let mut seen_layouts: Vec<String> = Vec::new();
    for (score, title, p) in cands {
        let key = format!("{:?}{:?}{:?}", p.rows, p.cols, p.values.iter().map(|v| (&v.field, v.func.code(), v.show.code())).collect::<Vec<_>>());
        if seen_layouts.contains(&key) {
            continue;
        }
        let Ok(grid) = wb.render_pivot(&p) else { continue };
        seen_layouts.push(key);
        let shown = score.clamp(1.0, 99.0).round() as u32;
        out.push([p.line(), shown.to_string(), title, preview(&grid)].join(&SEC.to_string()));
        if out.len() >= 8 {
            break;
        }
    }
    out
}
