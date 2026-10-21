use super::report::text_of;
use super::*;

#[derive(PartialEq, Clone, Copy)]
enum Kind {
    Num,
    Text,
    Date,
    Empty,
}

struct Tab {
    ar: Area,
    header: bool,
    names: Vec<String>,
    body: Vec<Vec<Value>>,
    kinds: Vec<Kind>,
}

#[derive(Clone, Copy, PartialEq)]
enum Agg {
    Sum,
    Avg,
    Max,
    Min,
    Median,
    Count,
    Distinct,
    Share,
}

enum Cond {
    Eq(usize, String),
    Gt(usize, f64),
    Lt(usize, f64),
    Between(usize, f64, f64),
    Year(usize, i64),
    Month(usize, i64),
}

fn norm(q: &str) -> String {
    let mut out = String::new();
    for ch in q.to_lowercase().chars() {
        if ch.is_alphanumeric() || matches!(ch, '>' | '<' | '=' | '%' | '$' | '.' | '-') {
            out.push(ch);
        } else {
            out.push(' ');
        }
    }
    let t: Vec<&str> = out.split_whitespace().map(|w| w.trim_matches(|c| c == '.' || c == '-')).filter(|w| !w.is_empty()).collect();
    format!(" {} ", t.join(" "))
}

fn stem(w: &str) -> String {
    let w = w.trim();
    if w.len() > 3 && w.ends_with("ies") {
        format!("{}y", &w[..w.len() - 3])
    } else if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") {
        w[..w.len() - 1].to_string()
    } else {
        w.to_string()
    }
}

fn has(q: &str, words: &[&str]) -> bool {
    words.iter().any(|w| q.contains(&format!(" {w} ")) || q.contains(&format!(" {w}s ")))
}

fn phrase_at(q: &str, phrase: &str) -> Option<usize> {
    let p = format!(" {} ", norm(phrase).trim());
    if p.trim().is_empty() {
        return None;
    }
    q.find(&p).or_else(|| {
        let s = format!(" {} ", stem(norm(phrase).trim()));
        q.find(&s)
    })
}

fn nums_in(q: &str) -> Vec<(usize, f64)> {
    let mut out = Vec::new();
    let mut pos = 0;
    for w in q.split(' ') {
        let t = w.trim_start_matches(['$', '>', '<', '=']).trim_end_matches('%');
        if let Ok(n) = t.replace(',', "").parse::<f64>() {
            out.push((pos, n));
        }
        pos += w.len() + 1;
    }
    out
}

fn after_num(q: &str, keys: &[&str]) -> Option<f64> {
    for k in keys {
        if let Some(i) = q.find(&format!(" {k} ")) {
            let rest = &q[i + k.len() + 2..];
            if let Some(n) = rest.split(' ').next().and_then(|t| t.trim_start_matches('$').trim_end_matches('%').replace(',', "").parse::<f64>().ok()) {
                return Some(n);
            }
        }
    }
    None
}

fn fmt_n(n: f64) -> String {
    let a = n.abs();
    let base = if n.fract().abs() < 1e-9 { format!("{}", n.round() as i64) } else if a >= 100.0 { format!("{n:.1}") } else { format!("{n:.2}") };
    let (sign, digits) = base.strip_prefix('-').map_or(("", base.as_str()), |d| ("-", d));
    let (int, frac) = digits.split_once('.').map_or((digits, ""), |(i, f)| (i, f));
    let mut grouped = String::new();
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    if frac.is_empty() { format!("{sign}{grouped}") } else { format!("{sign}{grouped}.{frac}") }
}

fn agg_word(a: Agg) -> &'static str {
    match a {
        Agg::Sum => "Total",
        Agg::Avg => "Average",
        Agg::Max => "Highest",
        Agg::Min => "Lowest",
        Agg::Median => "Median",
        Agg::Count => "Count of",
        Agg::Distinct => "Distinct",
        Agg::Share => "Share of",
    }
}

fn apply(a: Agg, v: &[f64]) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    Some(match a {
        Agg::Sum | Agg::Share => v.iter().sum(),
        Agg::Avg => stats::mean(v),
        Agg::Max => v.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        Agg::Min => v.iter().copied().fold(f64::INFINITY, f64::min),
        Agg::Median => stats::median(v),
        Agg::Count | Agg::Distinct => v.len() as f64,
    })
}

impl Workbook {
    fn ask_table(&self, sheet: usize, text: &str) -> Result<Tab, String> {
        let (sh, mut ar) = self.resolve(text, sheet)?;
        if ar.r0 == ar.r1 && ar.c0 == ar.c1 {
            let filled = |wb: &Workbook, r0: u32, c0: u32, r1: u32, c1: u32| (r0..=r1).any(|r| (c0..=c1).any(|c| !matches!(wb.val((sh, Addr { row: r, col: c })), Value::Empty)));
            loop {
                let mut grew = false;
                if ar.r0 > 0 && filled(self, ar.r0 - 1, ar.c0.saturating_sub(1), ar.r0 - 1, ar.c1 + 1) {
                    ar.r0 -= 1;
                    grew = true;
                }
                if filled(self, ar.r1 + 1, ar.c0.saturating_sub(1), ar.r1 + 1, ar.c1 + 1) {
                    ar.r1 += 1;
                    grew = true;
                }
                if ar.c0 > 0 && filled(self, ar.r0, ar.c0 - 1, ar.r1, ar.c0 - 1) {
                    ar.c0 -= 1;
                    grew = true;
                }
                if filled(self, ar.r0, ar.c1 + 1, ar.r1, ar.c1 + 1) {
                    ar.c1 += 1;
                    grew = true;
                }
                if !grew || (ar.r1 - ar.r0) > 100_000 || (ar.c1 - ar.c0) > 500 {
                    break;
                }
            }
        }
        if (ar.r1 - ar.r0 + 1) as u64 * (ar.c1 - ar.c0 + 1) as u64 > 2_000_000 {
            return Err("That selection is too large to analyze.".to_string());
        }
        let block = self.block(sh, ar);
        if block.len() < 2 {
            return Err("Select a table with a header row and at least one row of data.".to_string());
        }
        let header = block[0].iter().all(|v| matches!(v, Value::Text(t) if !t.trim().is_empty()));
        let skip = usize::from(header);
        let cols = block[0].len();
        let names: Vec<String> = (0..cols).map(|c| if header { text_of(&block[0][c]).unwrap_or_default() } else { format!("Column {}", col_label_of(ar.c0 + c as u32)) }).collect();
        let body: Vec<Vec<Value>> = block[skip..].to_vec();
        let mut kinds = Vec::new();
        for c in 0..cols {
            let vals: Vec<&Value> = body.iter().map(|r| &r[c]).filter(|v| !matches!(v, Value::Empty)).collect();
            let nums = vals.iter().filter(|v| matches!(v, Value::Number(_))).count();
            let date = body.iter().enumerate().any(|(i, r)| matches!(r[c], Value::Number(_)) && self.fmt(sh, Addr { row: ar.r0 + (i + skip) as u32, col: ar.c0 + c as u32 }).is_some_and(|f| f.is_date()));
            kinds.push(if vals.is_empty() { Kind::Empty } else if date && nums * 10 >= vals.len() * 8 { Kind::Date } else if nums * 10 >= vals.len() * 8 { Kind::Num } else { Kind::Text });
        }
        Ok(Tab { ar, header, names, body, kinds })
    }

    pub(super) fn ask(&mut self, a: &[String], _fx: &mut Effect) -> Reply {
        let sheet = self.sheet_of(&a[0])?;
        let t = self.ask_table(sheet, &a[1])?;
        let q = norm(&a[2]);
        if q.trim().is_empty() {
            return Err("Type a question about the data, such as total sales by region.".to_string());
        }
        let skip = usize::from(t.header);
        let n = t.body.len();
        let rng = |c: usize, r0: usize, r1: usize| -> String {
            let cl = col_label_of(t.ar.c0 + c as u32);
            format!("{cl}{}:{cl}{}", t.ar.r0 as usize + r0 + skip + 1, t.ar.r0 as usize + r1 + skip + 1)
        };
        let mut rows: Vec<[String; 4]> = Vec::new();
        let mut add = |kind: &str, title: String, detail: String, range: String| rows.push([kind.to_string(), title, detail, range]);

        let mut mentioned: Vec<(usize, usize)> = Vec::new();
        for (c, name) in t.names.iter().enumerate() {
            if t.kinds[c] == Kind::Empty || name.is_empty() {
                continue;
            }
            if let Some(p) = phrase_at(&q, name) {
                mentioned.push((p, c));
            } else {
                let words: Vec<String> = norm(name).split_whitespace().map(stem).filter(|w| w.len() > 3).collect();
                if let Some(p) = words.iter().filter_map(|w| q.split(' ').position(|x| stem(x) == *w).map(|i| q.split(' ').take(i).map(|s| s.len() + 1).sum::<usize>())).min() {
                    if words.len() == 1 || words.iter().all(|w| q.split(' ').any(|x| stem(x) == *w)) {
                        mentioned.push((p, c));
                    }
                }
            }
        }
        mentioned.sort();
        mentioned.dedup_by_key(|m| m.1);

        let mut conds: Vec<Cond> = Vec::new();
        let mut used_for_filter: Vec<usize> = Vec::new();
        for (c, name) in t.names.iter().enumerate() {
            if t.kinds[c] != Kind::Text {
                continue;
            }
            let mut seen: Vec<String> = Vec::new();
            for r in &t.body {
                if let Some(v) = text_of(&r[c]) {
                    if !seen.contains(&v) {
                        seen.push(v);
                    }
                }
            }
            if seen.len() > 200 || seen.len() == n {
                continue;
            }
            let mut best: Option<String> = None;
            for v in &seen {
                if phrase_at(&q, v).is_some() && best.as_ref().is_none_or(|b| v.len() > b.len()) {
                    best = Some(v.clone());
                }
            }
            if let Some(v) = best {
                if phrase_at(&q, name).is_none() || phrase_at(&q, name).is_some_and(|p| phrase_at(&q, &v).is_some_and(|pv| pv != p)) {
                    conds.push(Cond::Eq(c, v));
                    used_for_filter.push(c);
                }
            }
        }
        let date_col = (0..t.names.len()).find(|c| t.kinds[*c] == Kind::Date);
        if let Some(dc) = date_col {
            for (_, num) in nums_in(&q) {
                if num.fract() == 0.0 && (1900.0..2200.0).contains(&num) {
                    conds.push(Cond::Year(dc, num as i64));
                }
            }
            for (i, m) in ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].iter().enumerate() {
                if q.contains(&format!(" {m} ")) || q.contains(&format!(" {} ", &m[..3])) && !matches!(&m[..3], "may" | "mar") || (q.contains(" in mar ") && i == 2) {
                    conds.push(Cond::Month(dc, i as i64 + 1));
                }
            }
        }
        let num_cols: Vec<usize> = (0..t.names.len()).filter(|c| t.kinds[*c] == Kind::Num).collect();
        let measure_mention = mentioned.iter().map(|m| m.1).find(|c| t.kinds[*c] == Kind::Num);
        let first_num = measure_mention.or_else(|| num_cols.first().copied());
        let cmp_col = measure_mention.or(first_num);
        if let Some(mc) = cmp_col {
            if let (Some(lo), Some(hi)) = (after_num(&q, &["between"]), q.find(" and ").and_then(|i| q[i + 5..].split(' ').next().and_then(|t| t.trim_start_matches('$').replace(',', "").parse::<f64>().ok()))) {
                if q.contains(" between ") {
                    conds.push(Cond::Between(mc, lo.min(hi), lo.max(hi)));
                }
            } else if let Some(x) = after_num(&q, &["above", "over", "greater than", "more than", "exceeding", "exceeds", ">", "at least", "higher than"]) {
                conds.push(Cond::Gt(mc, x));
            } else if let Some(x) = after_num(&q, &["below", "under", "less than", "fewer than", "<", "at most", "lower than"]) {
                conds.push(Cond::Lt(mc, x));
            }
        }

        let ok_row = |r: &Vec<Value>| -> bool {
            conds.iter().all(|c| match c {
                Cond::Eq(col, v) => text_of(&r[*col]).is_some_and(|x| x.eq_ignore_ascii_case(v)),
                Cond::Gt(col, x) => matches!(&r[*col], Value::Number(n) if n > x),
                Cond::Lt(col, x) => matches!(&r[*col], Value::Number(n) if n < x),
                Cond::Between(col, lo, hi) => matches!(&r[*col], Value::Number(n) if n >= lo && n <= hi),
                Cond::Year(col, y) => matches!(&r[*col], Value::Number(n) if crate::numfmt::ymd(*n).is_some_and(|d| d.0 == *y)),
                Cond::Month(col, m) => matches!(&r[*col], Value::Number(n) if crate::numfmt::ymd(*n).is_some_and(|d| d.1 == *m)),
            })
        };
        let hits: Vec<usize> = (0..n).filter(|&i| ok_row(&t.body[i])).collect();
        let cond_text = {
            let mut parts = Vec::new();
            for c in &conds {
                parts.push(match c {
                    Cond::Eq(col, v) => format!("{} is {}", t.names[*col], v),
                    Cond::Gt(col, x) => format!("{} is above {}", t.names[*col], fmt_n(*x)),
                    Cond::Lt(col, x) => format!("{} is below {}", t.names[*col], fmt_n(*x)),
                    Cond::Between(col, lo, hi) => format!("{} is between {} and {}", t.names[*col], fmt_n(*lo), fmt_n(*hi)),
                    Cond::Year(_, y) => format!("the year is {y}"),
                    Cond::Month(_, m) => format!("the month is {}", ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][(*m - 1) as usize]),
                });
            }
            parts.join(" and ")
        };
        let scope = if conds.is_empty() { format!("all {n} rows") } else { format!("{} of {} rows where {}", hits.len(), n, cond_text) };

        let group_by = {
            let by_at = [" by ", " per ", " each ", " across ", " for every ", " grouped by "].iter().filter_map(|k| q.find(k).map(|i| i + k.len())).min();
            let rank_intent = has(&q, &["top", "bottom", "best", "worst", "which", "who", "rank", "ranking"]);
            let cand = by_at.and_then(|p| mentioned.iter().find(|m| m.0 + 1 >= p).map(|m| m.1));
            cand.filter(|c| t.kinds[*c] == Kind::Text || (!rank_intent && t.body.iter().filter_map(|r| if let Value::Number(n) = r[*c] { Some(n.to_bits()) } else { None }).collect::<std::collections::HashSet<_>>().len() <= 24)).or_else(|| {
                if rank_intent {
                    mentioned.iter().map(|m| m.1).find(|c| t.kinds[*c] == Kind::Text && !used_for_filter.contains(c))
                        .or_else(|| (0..t.names.len()).find(|c| t.kinds[*c] == Kind::Text && !used_for_filter.contains(c) && measure_mention != Some(*c)))
                } else {
                    None
                }
            })
        };
        let measure = measure_mention.filter(|c| Some(*c) != group_by);

        if has(&q, &["correlation", "correlate", "correlated", "relationship", "related"]) || q.contains(" versus ") || q.contains(" vs ") {
            let m: Vec<usize> = mentioned.iter().map(|m| m.1).filter(|c| t.kinds[*c] == Kind::Num).collect();
            let (c1, c2) = match (m.first(), m.get(1)) {
                (Some(x), Some(y)) => (*x, *y),
                _ if num_cols.len() >= 2 => (num_cols[0], num_cols[1]),
                _ => return Err("Name two number columns, such as correlation between price and quantity.".to_string()),
            };
            let pairs: Vec<(f64, f64)> = t.body.iter().filter_map(|r| match (&r[c1], &r[c2]) {
                (Value::Number(x), Value::Number(y)) => Some((*x, *y)),
                _ => None,
            }).collect();
            let (x, y): (Vec<f64>, Vec<f64>) = pairs.into_iter().unzip();
            match stats::correl(&x, &y) {
                Some(r) => {
                    let strength = if r.abs() >= 0.8 { "strong" } else if r.abs() >= 0.5 { "moderate" } else if r.abs() >= 0.3 { "weak" } else { "very little" };
                    add("answer", format!("{} and {}: correlation {:.2}", t.names[c1], t.names[c2], r), format!("That is {} {} relationship across {} rows.", strength, if r >= 0.0 { "positive" } else { "negative" }, x.len()), rng(c1, 0, n - 1));
                }
                None => add("answer", "No correlation could be worked out".to_string(), "One of the columns has no variation or too few numbers.".to_string(), rng(c1, 0, n - 1)),
            }
        } else if has(&q, &["trend", "growth", "growing", "declining", "increasing", "decreasing", "rising", "falling"]) || q.contains(" over time ") {
            let mc = measure.or(first_num).ok_or("Name a number column, such as the trend of sales.")?;
            let pts: Vec<(usize, f64)> = hits.iter().filter_map(|&i| if let Value::Number(v) = t.body[i][mc] { Some((i, v)) } else { None }).collect();
            if pts.len() < 3 {
                return Err("There are too few numbers to find a trend.".to_string());
            }
            let xs: Vec<f64> = pts.iter().map(|p| match date_col.map(|d| &t.body[p.0][d]) {
                Some(Value::Number(d)) => *d,
                _ => p.0 as f64,
            }).collect();
            let ys: Vec<f64> = pts.iter().map(|p| p.1).collect();
            match stats::ols(&ys, &[xs], true) {
                Some(f) => {
                    let first = ys[0];
                    let last = ys[ys.len() - 1];
                    let dir = if f.coef[0] > 0.0 { "up" } else if f.coef[0] < 0.0 { "down" } else { "flat" };
                    let change = if first != 0.0 { format!(" From {} to {} ({:+.1}%).", fmt_n(first), fmt_n(last), (last - first) / first.abs() * 100.0) } else { String::new() };
                    add("answer", format!("{} trends {}", t.names[mc], dir), format!("A straight line explains {:.0}% of the movement, about {} per {}.{}", f.r2 * 100.0, fmt_n(f.coef[0]), if date_col.is_some() { "day" } else { "row" }, change), rng(mc, 0, n - 1));
                }
                None => return Err("FormCel could not fit a trend to those numbers.".to_string()),
            }
        } else if has(&q, &["outlier", "unusual", "anomaly", "anomalies", "odd", "strange"]) {
            let mc = measure.or(first_num).ok_or("Name a number column, such as outliers in sales.")?;
            let pts: Vec<(usize, f64)> = hits.iter().filter_map(|&i| if let Value::Number(v) = t.body[i][mc] { Some((i, v)) } else { None }).collect();
            let vals: Vec<f64> = pts.iter().map(|p| p.1).collect();
            let sd = if vals.len() > 1 { stats::var_s(&vals).sqrt() } else { 0.0 };
            let m = stats::mean(&vals);
            let out: Vec<&(usize, f64)> = pts.iter().filter(|p| sd > 0.0 && ((p.1 - m) / sd).abs() > 2.5).collect();
            if out.is_empty() {
                add("answer", format!("No unusual values in {}", t.names[mc]), "Nothing is more than 2.5 standard deviations from the average.".to_string(), rng(mc, 0, n - 1));
            } else {
                for p in out.iter().take(5) {
                    add("answer", format!("{} in {} is unusual", fmt_n(p.1), t.names[mc]), format!("Row {} is {:.1} standard deviations from the average of {}.", t.ar.r0 as usize + p.0 + skip + 1, (p.1 - m) / sd, fmt_n(m)), rng(mc, p.0, p.0));
                }
            }
        } else if let Some(gc) = group_by.filter(|_| has(&q, &["top", "bottom", "best", "worst", "highest", "lowest", "largest", "smallest", "most", "least", "which", "rank", "ranking", "biggest"]) || true) {
            let agg = if has(&q, &["average", "mean", "avg"]) { Agg::Avg } else if has(&q, &["count", "many", "number"]) && measure.is_none() { Agg::Count } else if has(&q, &["percent", "percentage", "share", "proportion"]) || q.contains('%') { Agg::Share } else if has(&q, &["median"]) { Agg::Median } else if has(&q, &["maximum", "max"]) { Agg::Max } else if has(&q, &["minimum", "min"]) { Agg::Min } else { Agg::Sum };
            let mc = measure.or_else(|| if agg == Agg::Count { None } else { first_num.filter(|c| *c != gc) });
            let mut groups: Vec<(String, Vec<f64>, usize)> = Vec::new();
            for &i in &hits {
                let key = match &t.body[i][gc] {
                    Value::Empty => "(blank)".to_string(),
                    Value::Number(x) => fmt_n(*x),
                    v => text_of(v).unwrap_or_else(|| v.to_string()),
                };
                let val = match mc {
                    Some(c) => match &t.body[i][c] {
                        Value::Number(x) => Some(*x),
                        _ => None,
                    },
                    None => Some(1.0),
                };
                match groups.iter_mut().find(|g| g.0 == key) {
                    Some(g) => {
                        if let Some(v) = val {
                            g.1.push(v);
                        }
                        g.2 += 1;
                    }
                    None => groups.push((key, val.into_iter().collect(), 1)),
                }
            }
            let total_all: f64 = groups.iter().map(|g| if agg == Agg::Count || mc.is_none() { g.2 as f64 } else { g.1.iter().sum() }).sum();
            let mut scored: Vec<(String, f64)> = groups.iter().filter_map(|g| {
                let v = if agg == Agg::Count || mc.is_none() { Some(g.2 as f64) } else { apply(agg, &g.1) };
                v.map(|x| (g.0.clone(), if agg == Agg::Share { if total_all != 0.0 { x / total_all * 100.0 } else { 0.0 } } else { x }))
            }).collect();
            if scored.is_empty() {
                return Err("No rows match, so there is nothing to total.".to_string());
            }
            let low = has(&q, &["bottom", "worst", "lowest", "smallest", "least", "fewest"]);
            scored.sort_by(|x, y| if low { x.1.partial_cmp(&y.1) } else { y.1.partial_cmp(&x.1) }.unwrap_or(std::cmp::Ordering::Equal));
            let limit = nums_in(&q).iter().find(|(_, v)| v.fract() == 0.0 && *v >= 1.0 && *v <= 50.0 && q.contains(&format!(" top {} ", *v as i64)) || q.contains(&format!(" bottom {} ", *v as i64)) || q.contains(&format!(" first {} ", *v as i64))).map(|x| x.1 as usize);
            let single = limit.is_none() && has(&q, &["which", "who", "what"]) && (has(&q, &["highest", "lowest", "most", "least", "best", "worst", "largest", "smallest", "biggest", "fewest"]));
            let plural = |s: &str| if s.ends_with('s') { s.to_lowercase() } else { format!("{}s", s.to_lowercase()) };
            let word = if agg == Agg::Share { format!("Share of {}", mc.map_or("rows".to_string(), |c| t.names[c].clone())) } else if mc.is_none() { "Count of rows".to_string() } else { format!("{} {}", agg_word(agg), t.names[mc.unwrap_or(0)]) };
            let unit = |v: f64| if agg == Agg::Share { format!("{v:.1}%") } else { fmt_n(v) };
            let range_g = rng(gc, 0, n - 1);
            if single || limit == Some(1) {
                let w = &scored[0];
                add("answer", format!("{} has the {} {}: {}", w.0, if low { "lowest" } else { "highest" }, mc.map_or("count".to_string(), |c| t.names[c].to_lowercase()), unit(w.1)), format!("Out of {} {}; next is {}. Based on {}.", scored.len(), plural(&t.names[gc]), scored.get(1).map_or("none".to_string(), |s| format!("{} at {}", s.0, unit(s.1))), scope), range_g.clone());
            } else {
                let show = limit.unwrap_or(scored.len()).min(scored.len()).min(12);
                let list: Vec<String> = scored.iter().take(show).map(|s| format!("{}: {}", s.0, unit(s.1))).collect();
                add("answer", format!("{} by {}", word, t.names[gc]), format!("{}. Based on {}.", list.join("; "), scope), range_g.clone());
                if scored.len() > 1 {
                    let top = &scored[0];
                    add("group", format!("{} is {} {}", top.0, if low { "lowest" } else { "highest" }, unit(top.1)), format!("{} is {}.", scored[scored.len() - 1].0, unit(scored[scored.len() - 1].1)), range_g);
                }
            }
        } else {
            let agg = if has(&q, &["distinct", "unique", "different"]) { Agg::Distinct } else if has(&q, &["average", "mean", "avg"]) { Agg::Avg } else if has(&q, &["median"]) { Agg::Median } else if has(&q, &["maximum", "max", "highest", "largest", "biggest", "most", "greatest", "top"]) { Agg::Max } else if has(&q, &["minimum", "min", "lowest", "smallest", "least", "fewest", "bottom"]) { Agg::Min } else if has(&q, &["count", "many", "number"]) { Agg::Count } else { Agg::Sum };
            if has(&q, &["blank", "blanks", "missing", "empty"]) {
                let c = mentioned.first().map(|m| m.1);
                match c {
                    Some(c) => {
                        let k = hits.iter().filter(|&&i| matches!(t.body[i][c], Value::Empty)).count();
                        add("answer", format!("{} has {} blank cell{}", t.names[c], k, if k == 1 { "" } else { "s" }), format!("Out of {}.", scope), rng(c, 0, n - 1));
                    }
                    None => {
                        let mut found = false;
                        for c in 0..t.names.len() {
                            let k = hits.iter().filter(|&&i| matches!(t.body[i][c], Value::Empty)).count();
                            if k > 0 {
                                found = true;
                                add("answer", format!("{} has {} blank cell{}", t.names[c], k, if k == 1 { "" } else { "s" }), format!("Out of {}.", scope), rng(c, 0, n - 1));
                            }
                        }
                        if !found {
                            add("answer", "No blank cells".to_string(), format!("Checked {}.", scope), rng(0, 0, n - 1));
                        }
                    }
                }
            } else if agg == Agg::Distinct {
                let c = mentioned.iter().map(|m| m.1).find(|c| t.kinds[*c] != Kind::Empty).ok_or("Name a column, such as how many different regions.")?;
                let mut seen: Vec<String> = hits.iter().filter(|&&i| !matches!(t.body[i][c], Value::Empty)).map(|&i| t.body[i][c].to_string()).collect();
                seen.sort();
                seen.dedup();
                let sample: Vec<String> = seen.iter().take(8).cloned().collect();
                add("answer", format!("{} different {}", seen.len(), if seen.len() == 1 || t.names[c].ends_with('s') { t.names[c].to_lowercase() } else { format!("{}s", t.names[c].to_lowercase()) }), format!("{}{}. Based on {}.", sample.join(", "), if seen.len() > 8 { ", and more" } else { "" }, scope), rng(c, 0, n - 1));
            } else if agg == Agg::Count && (measure.is_none() || has(&q, &["row", "record", "entry", "entries", "item"])) {
                add("answer", format!("{} row{}", hits.len(), if hits.len() == 1 { "" } else { "s" }), if conds.is_empty() { "Every data row in the table.".to_string() } else { format!("Rows where {}.", cond_text) }, hits.first().map_or(rng(0, 0, n - 1), |&i| format!("{}{}:{}{}", col_label_of(t.ar.c0), t.ar.r0 as usize + i + skip + 1, col_label_of(t.ar.c1), t.ar.r0 as usize + i + skip + 1)));
            } else {
                let mc = measure.or(first_num).ok_or("Name a number column, such as total sales.")?;
                let vals: Vec<f64> = hits.iter().filter_map(|&i| if let Value::Number(v) = t.body[i][mc] { Some(v) } else { None }).collect();
                match apply(agg, &vals) {
                    Some(v) => {
                        let where_ = if matches!(agg, Agg::Max | Agg::Min) {
                            let row = hits.iter().copied().find(|&i| matches!(t.body[i][mc], Value::Number(x) if x == v));
                            row.and_then(|i| (0..t.names.len()).find(|c| t.kinds[*c] == Kind::Text && !used_for_filter.contains(c)).and_then(|c| text_of(&t.body[i][c]).map(|s| format!(" It is on the row for {s}."))))
                        } else {
                            None
                        };
                        add("answer", format!("{} {}: {}", agg_word(agg), t.names[mc], fmt_n(v)), format!("Based on {}, {} numbers.{}", scope, vals.len(), where_.unwrap_or_default()), rng(mc, 0, n - 1));
                        if matches!(agg, Agg::Sum | Agg::Avg) && conds.is_empty() && vals.len() > 1 {
                            let (lo, hi) = (vals.iter().copied().fold(f64::INFINITY, f64::min), vals.iter().copied().fold(f64::NEG_INFINITY, f64::max));
                            add("group", format!("Range of {}: {} to {}", t.names[mc], fmt_n(lo), fmt_n(hi)), format!("Median {}.", fmt_n(stats::median(&vals))), rng(mc, 0, n - 1));
                        }
                    }
                    None => return Err("No rows match, so there are no numbers to work with.".to_string()),
                }
            }
        }
        if rows.is_empty() {
            return Err("FormCel could not tell what to work out. Try total sales by region, average price, top 3 products by revenue or correlation between price and quantity.".to_string());
        }
        Ok(rows.iter().map(|l| l.iter().map(|f| { let mut s = String::new(); escape(f, &mut s); s }).collect::<Vec<_>>().join("\t")).collect::<Vec<_>>().join("\n"))
    }
}

fn col_label_of(c: u32) -> String {
    crate::col_name(c)
}
