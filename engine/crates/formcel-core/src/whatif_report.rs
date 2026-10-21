use super::*;

fn col_label(c: u32) -> String {
    crate::col_name(c)
}

fn iso(serial: f64) -> String {
    match crate::numfmt::ymd(serial) {
        Some((y, m, d)) => format!("{y:04}-{m:02}-{d:02}"),
        None => num_raw(serial),
    }
}

fn date_or_num(s: &str) -> Result<f64, String> {
    match Value::parse_input(s.trim()) {
        Value::Number(n) => Ok(n),
        _ => Err(format!("{} is not a date or a number.", s.trim())),
    }
}

pub(super) fn text_of(v: &Value) -> Option<String> {
    match v {
        Value::Text(t) if !t.trim().is_empty() => Some(t.trim().to_string()),
        _ => None,
    }
}

pub(super) fn nums_of(vals: &[Value]) -> Vec<f64> {
    vals.iter().filter_map(|v| if let Value::Number(n) = v { Some(*n) } else { None }).collect()
}

fn money(n: f64) -> String {
    if n.fract().abs() < 1e-9 {
        format!("{}", n as i64)
    } else if n.abs() >= 100.0 {
        format!("{n:.1}")
    } else {
        format!("{n:.3}")
    }
}

impl Workbook {
    fn series_pairs(&self, a: &[String], sheet: usize) -> Result<(Vec<f64>, Vec<f64>, Option<String>, Addr, usize), String> {
        let (sh, tl) = self.resolve(&a[1], sheet)?;
        let (sv, vs) = self.resolve(&a[2], sheet)?;
        let (tc, vc) = (cells_of(tl), cells_of(vs));
        if tc.len() != vc.len() {
            return Err("The timeline and the values need the same number of cells.".to_string());
        }
        let mut t = Vec::new();
        let mut v = Vec::new();
        let mut name = None;
        for (i, (p, q)) in tc.iter().zip(&vc).enumerate() {
            let (tv, vv) = (self.val((sh, *p)), self.val((sv, *q)));
            if i == 0 && matches!(tv, Value::Text(_)) && matches!(vv, Value::Text(_)) {
                name = text_of(&vv);
                continue;
            }
            match (tv, vv) {
                (Value::Number(x), Value::Number(y)) => {
                    t.push(x);
                    v.push(y);
                }
                (Value::Number(_), Value::Empty) => {}
                _ => return Err("The timeline must hold dates or numbers and the values must hold numbers.".to_string()),
            }
        }
        let first = *tc.iter().find(|p| matches!(self.val((sh, **p)), Value::Number(_))).unwrap_or(&tc[0]);
        Ok((t, v, name, first, sh))
    }

    pub(super) fn forecast_sheet(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let src = self.sheet_of(&a[0])?;
        let dst = self.dst_of(&a[3])?;
        let (t, v, name, first, tsh) = self.series_pairs(a, src)?;
        let end = date_or_num(&a[4])?;
        let conf = pnum(&a[5])? / 100.0;
        let seas = pnum(&a[6])?;
        let comp = pnum(&a[7])?;
        let aggr = pnum(&a[8])?;
        let start = a.get(9).filter(|s| !s.trim().is_empty()).map(|s| date_or_num(s)).transpose()?;
        let want_stats = a.get(10).is_some_and(|s| s == "1");
        let mut pairs: Vec<(f64, f64)> = t.iter().cloned().zip(v.iter().cloned()).collect();
        pairs.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
        let cut = match start {
            Some(s) if s < pairs.last().map_or(0.0, |p| p.0) => pairs.iter().position(|p| p.0 >= s).unwrap_or(pairs.len()),
            _ => pairs.len(),
        };
        if cut < 3 {
            return Err("There are too few historical points before the forecast start.".to_string());
        }
        let (ht, hv): (Vec<f64>, Vec<f64>) = pairs[..cut].iter().cloned().unzip();
        let series = stats::prepare(&ht, &hv, comp as i32, aggr as i32).map_err(|_| "FormCel could not find a constant step in the timeline, or too many points are missing.".to_string())?;
        let model = stats::ets_model(&series, seas).map_err(|_| "That seasonality is not allowed.".to_string())?;
        let is_date = self.fmt(tsh, first).is_some_and(|f| f.is_date());
        let tw = |x: f64| if is_date { iso(x) } else { num_raw(x) };
        let label = name.clone().unwrap_or_else(|| "Values".to_string());
        let mut out = Vec::new();
        put(&mut out, 0, 0, "Timeline");
        put(&mut out, 0, 1, "Values");
        put(&mut out, 0, 2, format!("Forecast({label})"));
        if conf > 0.0 {
            put(&mut out, 0, 3, format!("Lower Confidence Bound({label})"));
            put(&mut out, 0, 4, format!("Upper Confidence Bound({label})"));
        }
        let n_hist = pairs.len();
        let last_used = cut as u32;
        let rng = |c: &str| format!("${c}$2:${c}${}", last_used + 1);
        let opts = format!("{},{},{}", num_raw(seas), num_raw(comp), num_raw(aggr));
        let conf_arg = num_raw(conf);
        for (i, (x, y)) in pairs.iter().enumerate() {
            let r = i as u32 + 1;
            put(&mut out, r, 0, tw(*x));
            put(&mut out, r, 1, num_raw(*y));
            if i + 1 == cut {
                put(&mut out, r, 2, num_raw(*y));
                if conf > 0.0 {
                    put(&mut out, r, 3, num_raw(*y));
                    put(&mut out, r, 4, num_raw(*y));
                }
            } else if i >= cut {
                let f = format!("=FORECAST.ETS(A{},{},{},{})", r + 1, rng("B"), rng("A"), opts);
                put(&mut out, r, 2, f);
                if conf > 0.0 {
                    let ci = format!("FORECAST.ETS.CONFINT(A{},{},{},{},{})", r + 1, rng("B"), rng("A"), conf_arg, opts);
                    put(&mut out, r, 3, format!("=C{}-{}", r + 1, ci));
                    put(&mut out, r, 4, format!("=C{}+{}", r + 1, ci));
                }
            }
        }
        let last_hist = pairs.last().map_or(0.0, |p| p.0);
        let mut k = series.last_offset() + 1.0 + (pairs.len() - cut) as f64 * 0.0;
        let mut future = 0usize;
        let mut row = n_hist as u32 + 1;
        let after_hist = series.offset(last_hist);
        if after_hist.is_finite() && after_hist > series.last_offset() {
            k = after_hist + 1.0;
        }
        loop {
            let tm = series.time_at(k);
            if !tm.is_finite() || tm > end || future >= 5000 {
                break;
            }
            put(&mut out, row, 0, tw(tm));
            let f = format!("=FORECAST.ETS(A{},{},{},{})", row + 1, rng("B"), rng("A"), opts);
            put(&mut out, row, 2, f);
            if conf > 0.0 {
                let ci = format!("FORECAST.ETS.CONFINT(A{},{},{},{},{})", row + 1, rng("B"), rng("A"), conf_arg, opts);
                put(&mut out, row, 3, format!("=C{}-{}", row + 1, ci));
                put(&mut out, row, 4, format!("=C{}+{}", row + 1, ci));
            }
            row += 1;
            k += 1.0;
            future += 1;
        }
        if future == 0 && cut == n_hist {
            return Err("The forecast end must be after the last point of the timeline.".to_string());
        }
        if want_stats {
            put(&mut out, 0, 6, "Statistic");
            put(&mut out, 0, 7, "Value");
            for (i, nm) in ["Alpha", "Beta", "Gamma", "MASE", "SMAPE", "MAE", "RMSE"].iter().enumerate() {
                put(&mut out, i as u32 + 1, 6, *nm);
                put(&mut out, i as u32 + 1, 7, format!("=FORECAST.ETS.STAT({},{},{},{})", rng("B"), rng("A"), i + 1, opts));
            }
            put(&mut out, 9, 6, "Seasonality detected");
            put(&mut out, 9, 7, if model.m > 1 { num_raw(model.m as f64) } else { "0".to_string() });
            put(&mut out, 10, 6, "Confidence interval");
            put(&mut out, 10, 7, if conf > 0.0 { num_raw(conf) } else { "off".to_string() });
        }
        self.put_all(dst, &out, fx)?;
        if dst != usize::MAX {
            let last = Addr { row: row.max(n_hist as u32), col: 4 };
            if let Ok(e) = self.set_format(dst, Addr { row: 1, col: 2 }, last, "0.00") {
                fx.formats.extend(e.formats);
            }
        }
        Ok(format!("ok\t{}\t{}\t{}", if model.m > 1 { model.m } else { 0 }, n_hist, future))
    }

    pub(super) fn describe(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let src = self.sheet_of(&a[0])?;
        let (sh, ar) = self.resolve(&a[1], src)?;
        let dst = self.dst_of(&a[2])?;
        let origin = parse_a1(&a[3]).map_err(|_| "Choose a cell for the output.".to_string())?;
        let by_row = a[4] == "r";
        let labels = a[5] == "1";
        let summary = a[6] == "1";
        let kl = a[7].trim().parse::<usize>().unwrap_or(0);
        let ks = a[8].trim().parse::<usize>().unwrap_or(0);
        let conf = a.get(9).and_then(|s| s.trim().parse::<f64>().ok()).unwrap_or(0.0);
        let block = self.block(sh, ar);
        let mut groups: Vec<(String, Vec<f64>)> = Vec::new();
        if by_row {
            for (i, row) in block.iter().enumerate() {
                let (name, rest) = if labels { (text_of(&row[0]).unwrap_or_else(|| format!("Row{}", i + 1)), &row[1..]) } else { (format!("Row{}", i + 1), &row[..]) };
                groups.push((name, nums_of(rest)));
            }
        } else {
            for c in 0..block[0].len() {
                let col: Vec<Value> = block.iter().map(|r| r[c].clone()).collect();
                let (name, rest) = if labels { (text_of(&col[0]).unwrap_or_else(|| format!("Column{}", c + 1)), &col[1..]) } else { (format!("Column{}", c + 1), &col[..]) };
                groups.push((name, nums_of(rest)));
            }
        }
        let mut out = Vec::new();
        let mut c = origin.col;
        for (name, v) in &groups {
            let mut r = origin.row;
            put(&mut out, r, c + 1, name.clone());
            r += 2;
            if summary {
                let n = v.len() as f64;
                let sd = stats::var_s(v).sqrt();
                let min = v.iter().cloned().fold(f64::INFINITY, f64::min);
                let max = v.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
                let rows: Vec<(&str, String)> = vec![
                    ("Mean", fnum(stats::mean(v))),
                    ("Standard Error", fnum(sd / n.sqrt())),
                    ("Median", fnum(stats::median(v))),
                    ("Mode", stats::mode(v).map_or("#N/A".to_string(), fnum)),
                    ("Standard Deviation", fnum(sd)),
                    ("Sample Variance", fnum(sd * sd)),
                    ("Kurtosis", fnum(stats::kurt(v))),
                    ("Skewness", fnum(stats::skew(v))),
                    ("Range", fnum(max - min)),
                    ("Minimum", fnum(min)),
                    ("Maximum", fnum(max)),
                    ("Sum", fnum(v.iter().sum())),
                    ("Count", fnum(n)),
                ];
                for (lab, val) in rows {
                    put(&mut out, r, c, lab);
                    put(&mut out, r, c + 1, val);
                    r += 1;
                }
                let mut sorted = v.clone();
                sorted.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
                if kl > 0 {
                    put(&mut out, r, c, format!("Largest({kl})"));
                    put(&mut out, r, c + 1, if kl <= sorted.len() { fnum(sorted[sorted.len() - kl]) } else { "#NUM!".to_string() });
                    r += 1;
                }
                if ks > 0 {
                    put(&mut out, r, c, format!("Smallest({ks})"));
                    put(&mut out, r, c + 1, if ks <= sorted.len() { fnum(sorted[ks - 1]) } else { "#NUM!".to_string() });
                    r += 1;
                }
                if conf > 0.0 && conf < 100.0 {
                    put(&mut out, r, c, format!("Confidence Level({conf:.1}%)"));
                    put(&mut out, r, c + 1, fnum(stats::t_inv_two_tail(1.0 - conf / 100.0, n - 1.0) * sd / n.sqrt()));
                }
            }
            c += 3;
        }
        self.put_all(dst, &out, fx)?;
        Ok(format!("ok\t{}", groups.len()))
    }

    pub(super) fn regress(&mut self, a: &[String], fx: &mut Effect) -> Reply {
        let src = self.sheet_of(&a[0])?;
        let (ysh, yar) = self.resolve(&a[1], src)?;
        let (xsh, xar) = self.resolve(&a[2], src)?;
        let dst = self.dst_of(&a[3])?;
        let origin = parse_a1(&a[4]).map_err(|_| "Choose a cell for the output.".to_string())?;
        let labels = a[5] == "1";
        let konst = a[6] != "0";
        let conf = pnum(&a[7])?;
        let resid = a[8] == "1";
        let yb = self.block(ysh, yar);
        let xb = self.block(xsh, xar);
        if yar.c1 != yar.c0 {
            return Err("The Y range must be a single column.".to_string());
        }
        if yb.len() != xb.len() {
            return Err("The Y and X ranges need the same number of rows.".to_string());
        }
        let skip = usize::from(labels);
        let yname = if labels { text_of(&yb[0][0]).unwrap_or_else(|| "Y".to_string()) } else { "Y".to_string() };
        let ys: Vec<f64> = yb[skip..].iter().map(|r| if let Value::Number(n) = r[0] { Some(n) } else { None }).collect::<Option<Vec<f64>>>().ok_or("The Y range holds text or blanks.")?;
        let k = xb[0].len();
        let mut xs: Vec<Vec<f64>> = Vec::new();
        let mut names = Vec::new();
        for c in 0..k {
            let col: Option<Vec<f64>> = xb[skip..].iter().map(|r| if let Value::Number(n) = r[c] { Some(n) } else { None }).collect();
            xs.push(col.ok_or("The X range holds text or blanks.")?);
            names.push(if labels { text_of(&xb[0][c]).unwrap_or_else(|| format!("X Variable {}", c + 1)) } else { format!("X Variable {}", c + 1) });
        }
        let _ = yname;
        let fit = stats::ols(&ys, &xs, konst).ok_or("FormCel could not fit that model: the X columns may be collinear or there are too few rows.")?;
        let n = ys.len() as f64;
        let kf = k as f64;
        let adj = if konst { 1.0 - (1.0 - fit.r2) * (n - 1.0) / (n - kf - 1.0) } else { 1.0 - (1.0 - fit.r2) * n / (n - kf) };
        let o = origin;
        let mut out = Vec::new();
        let mut r = o.row;
        let c0 = o.col;
        put(&mut out, r, c0, "SUMMARY OUTPUT");
        r += 2;
        put(&mut out, r, c0, "Regression Statistics");
        r += 1;
        for (lab, val) in [("Multiple R", fit.r2.max(0.0).sqrt()), ("R Square", fit.r2), ("Adjusted R Square", adj), ("Standard Error", fit.sey), ("Observations", n)] {
            put(&mut out, r, c0, lab);
            put(&mut out, r, c0 + 1, fnum(val));
            r += 1;
        }
        r += 1;
        put(&mut out, r, c0, "ANOVA");
        r += 1;
        for (i, h) in ["df", "SS", "MS", "F", "Significance F"].iter().enumerate() {
            put(&mut out, r, c0 + 1 + i as u32, *h);
        }
        r += 1;
        let total_df = if konst { n - 1.0 } else { n };
        put(&mut out, r, c0, "Regression");
        put(&mut out, r, c0 + 1, fnum(kf));
        put(&mut out, r, c0 + 2, fnum(fit.ssreg));
        put(&mut out, r, c0 + 3, fnum(fit.ssreg / kf));
        put(&mut out, r, c0 + 4, fnum(fit.f));
        put(&mut out, r, c0 + 5, fnum(stats::f_upper(fit.f, kf, fit.df)));
        r += 1;
        put(&mut out, r, c0, "Residual");
        put(&mut out, r, c0 + 1, fnum(fit.df));
        put(&mut out, r, c0 + 2, fnum(fit.ssresid));
        put(&mut out, r, c0 + 3, fnum(fit.ssresid / fit.df));
        r += 1;
        put(&mut out, r, c0, "Total");
        put(&mut out, r, c0 + 1, fnum(total_df));
        put(&mut out, r, c0 + 2, fnum(fit.sstotal));
        r += 2;
        let lvl = format!("{}%", num_raw(conf));
        for (i, h) in ["Coefficients", "Standard Error", "t Stat", "P-value"].iter().enumerate() {
            put(&mut out, r, c0 + 1 + i as u32, *h);
        }
        put(&mut out, r, c0 + 5, format!("Lower {lvl}"));
        put(&mut out, r, c0 + 6, format!("Upper {lvl}"));
        r += 1;
        let tcrit = stats::t_inv_two_tail(1.0 - conf / 100.0, fit.df);
        let mut order: Vec<(String, usize)> = Vec::new();
        if konst {
            order.push(("Intercept".to_string(), k));
        }
        for (i, nm) in names.iter().enumerate() {
            order.push((nm.clone(), i));
        }
        for (nm, idx) in order {
            let (cf, se) = (fit.coef[idx], fit.se[idx]);
            let t = cf / se;
            put(&mut out, r, c0, nm);
            put(&mut out, r, c0 + 1, fnum(cf));
            put(&mut out, r, c0 + 2, fnum(se));
            put(&mut out, r, c0 + 3, fnum(t));
            put(&mut out, r, c0 + 4, fnum(stats::t_two_tail(t, fit.df)));
            put(&mut out, r, c0 + 5, fnum(cf - tcrit * se));
            put(&mut out, r, c0 + 6, fnum(cf + tcrit * se));
            r += 1;
        }
        if resid {
            r += 1;
            put(&mut out, r, c0, "RESIDUAL OUTPUT");
            r += 2;
            put(&mut out, r, c0, "Observation");
            put(&mut out, r, c0 + 1, format!("Predicted {yname}"));
            put(&mut out, r, c0 + 2, "Residuals");
            r += 1;
            for i in 0..ys.len() {
                let row: Vec<f64> = xs.iter().map(|x| x[i]).collect();
                let p = fit.predict(&row);
                put(&mut out, r, c0, (i + 1).to_string());
                put(&mut out, r, c0 + 1, fnum(p));
                put(&mut out, r, c0 + 2, fnum(ys[i] - p));
                r += 1;
            }
        }
        self.put_all(dst, &out, fx)?;
        Ok(format!("ok\t{}", fnum(fit.r2)))
    }

    pub(super) fn explore(&mut self, a: &[String]) -> Reply {
        let src = self.sheet_of(&a[0])?;
        let (sh, mut ar) = self.resolve(&a[1], src)?;
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
        let (rows, cols) = (block.len(), block[0].len());
        if rows < 2 {
            return Err("Select a table with a header row and at least one row of data.".to_string());
        }
        let header = block[0].iter().all(|v| matches!(v, Value::Text(t) if !t.trim().is_empty()));
        let body = &block[usize::from(header)..];
        let names: Vec<String> = (0..cols).map(|c| if header { text_of(&block[0][c]).unwrap_or_default() } else { format!("Column {}", col_label(ar.c0 + c as u32)) }).collect();
        let at = |c: usize, r0: usize, r1: usize| -> String {
            format!("{}{}:{}{}", col_label(ar.c0 + c as u32), ar.r0 + (r0 + usize::from(header)) as u32 + 1, col_label(ar.c0 + c as u32), ar.r0 + (r1 + usize::from(header)) as u32 + 1)
        };
        let n = body.len();
        #[derive(PartialEq, Clone, Copy)]
        enum Kind {
            Num,
            Text,
            Date,
            Empty,
        }
        let mut kinds = Vec::new();
        for c in 0..cols {
            let vals: Vec<&Value> = body.iter().map(|r| &r[c]).filter(|v| !matches!(v, Value::Empty)).collect();
            let nums = vals.iter().filter(|v| matches!(v, Value::Number(_))).count();
            let date = body.iter().enumerate().any(|(i, r)| matches!(r[c], Value::Number(_)) && self.fmt(sh, Addr { row: ar.r0 + (i + usize::from(header)) as u32, col: ar.c0 + c as u32 }).is_some_and(|f| f.is_date()));
            kinds.push(if vals.is_empty() { Kind::Empty } else if date && nums * 10 >= vals.len() * 8 { Kind::Date } else if nums * 10 >= vals.len() * 8 { Kind::Num } else { Kind::Text });
        }
        let label_col = (0..cols).find(|c| kinds[*c] == Kind::Text && {
            let mut d: Vec<String> = body.iter().filter_map(|r| text_of(&r[*c])).collect();
            d.sort();
            d.dedup();
            d.len() > 1
        });
        let label_of = |i: usize| -> String { label_col.and_then(|c| text_of(&body[i][c])).unwrap_or_else(|| format!("row {}", ar.r0 as usize + i + usize::from(header) + 1)) };
        let mut out: Vec<[String; 4]> = Vec::new();
        let mut add = |kind: &str, title: String, detail: String, range: String| out.push([kind.to_string(), title, detail, range]);
        let ncount = kinds.iter().filter(|k| **k == Kind::Num).count();
        let tcount = kinds.iter().filter(|k| **k == Kind::Text).count();
        add("overview", format!("{n} rows by {cols} columns"), format!("{ncount} number columns and {tcount} text columns{}.", if header { ", with a header row" } else { "" }), format!("{}:{}", to_a1(Addr { row: ar.r0, col: ar.c0 }), to_a1(Addr { row: ar.r1, col: ar.c1 })));
        let xdate = (0..cols).find(|c| kinds[*c] == Kind::Date);
        let mut series: Vec<(usize, Vec<(usize, f64)>)> = Vec::new();
        for c in 0..cols {
            if kinds[c] != Kind::Num {
                continue;
            }
            let pts: Vec<(usize, f64)> = body.iter().enumerate().filter_map(|(i, r)| if let Value::Number(v) = r[c] { Some((i, v)) } else { None }).collect();
            if pts.is_empty() {
                continue;
            }
            let vals: Vec<f64> = pts.iter().map(|p| p.1).collect();
            let total: f64 = vals.iter().sum();
            let mean = stats::mean(&vals);
            let (imax, vmax) = pts.iter().fold((0, f64::MIN), |b, p| if p.1 > b.1 { *p } else { b });
            let (imin, vmin) = pts.iter().fold((0, f64::MAX), |b, p| if p.1 < b.1 { *p } else { b });
            add("total", format!("{}: total {}, average {}", names[c], money(total), money(mean)), format!("Highest is {} at {}; lowest is {} at {}.", money(vmax), label_of(imax), money(vmin), label_of(imin)), at(c, 0, n - 1));
            if vals.len() >= 5 {
                let sd = stats::var_s(&vals).sqrt();
                if sd > 0.0 {
                    let outl: Vec<&(usize, f64)> = pts.iter().filter(|p| ((p.1 - mean) / sd).abs() > 3.0).collect();
                    if !outl.is_empty() {
                        add("outlier", format!("{} has {} unusual value{}", names[c], outl.len(), if outl.len() == 1 { "" } else { "s" }), format!("{} at {} is more than 3 standard deviations from the average.", money(outl[0].1), label_of(outl[0].0)), at(c, outl[0].0, outl[0].0));
                    }
                }
            }
            if vals.len() >= 4 {
                let xs: Vec<f64> = match xdate {
                    Some(dc) => pts.iter().map(|p| if let Value::Number(d) = body[p.0][dc] { d } else { p.0 as f64 }).collect(),
                    None => pts.iter().map(|p| p.0 as f64).collect(),
                };
                if let Some(f) = stats::ols(&vals, &[xs], true) {
                    let per = if xdate.is_some() { "day" } else { "row" };
                    if f.r2 >= 0.5 && f.coef[0] != 0.0 {
                        add("trend", format!("{} {} over {}", names[c], if f.coef[0] > 0.0 { "trends up" } else { "trends down" }, if xdate.is_some() { "time" } else { "the rows" }), format!("About {} per {per} (R squared {:.2}).", money(f.coef[0]), f.r2), at(c, 0, n - 1));
                    } else {
                        add("trend", format!("{} shows no clear trend", names[c]), format!("A straight line explains {:.0}% of the movement.", f.r2 * 100.0), at(c, 0, n - 1));
                    }
                }
            }
            series.push((c, pts));
        }
        for c in 0..cols {
            if kinds[c] != Kind::Text {
                continue;
            }
            let mut counts: Vec<(String, usize)> = Vec::new();
            for r in body {
                if let Some(t) = text_of(&r[c]) {
                    match counts.iter_mut().find(|x| x.0 == t) {
                        Some(x) => x.1 += 1,
                        None => counts.push((t, 1)),
                    }
                }
            }
            let filled: usize = counts.iter().map(|x| x.1).sum();
            if counts.len() < 2 || counts.len() == filled {
                continue;
            }
            counts.sort_by(|x, y| y.1.cmp(&x.1).then(x.0.cmp(&y.0)));
            let top: Vec<String> = counts.iter().take(3).map(|(t, k)| format!("{t} ({k}, {:.0}%)", *k as f64 * 100.0 / filled as f64)).collect();
            add("top", format!("Most common in {}: {}", names[c], counts[0].0), format!("Top values: {}. {} different values.", top.join(", "), counts.len()), at(c, 0, n - 1));
        }
        if let Some(lc) = label_col {
            let mut cats: Vec<String> = body.iter().filter_map(|r| text_of(&r[lc])).collect();
            cats.sort();
            cats.dedup();
            if cats.len() <= 12 {
                for (c, pts) in &series {
                    let mut sums: Vec<(String, f64)> = cats.iter().map(|k| (k.clone(), pts.iter().filter(|p| text_of(&body[p.0][lc]).as_deref() == Some(k.as_str())).map(|p| p.1).sum())).collect();
                    let total: f64 = sums.iter().map(|s| s.1).sum();
                    if total <= 0.0 || sums.iter().any(|s| s.1 < 0.0) {
                        continue;
                    }
                    sums.sort_by(|x, y| y.1.partial_cmp(&x.1).unwrap_or(std::cmp::Ordering::Equal));
                    let (hi, lo) = (&sums[0], &sums[sums.len() - 1]);
                    add("group", format!("{} has the highest total {}", hi.0, names[*c]), format!("{} is {:.0}% of all; {} is lowest with {}.", money(hi.1), hi.1 * 100.0 / total, lo.0, money(lo.1)), at(*c, 0, n - 1));
                }
            }
        }
        for i in 0..series.len() {
            for j in i + 1..series.len() {
                let (ci, pi) = (&series[i].0, &series[i].1);
                let (cj, pj) = (&series[j].0, &series[j].1);
                let shared: Vec<(f64, f64)> = pi.iter().filter_map(|p| pj.iter().find(|q| q.0 == p.0).map(|q| (p.1, q.1))).collect();
                if shared.len() < 4 {
                    continue;
                }
                let (x, y): (Vec<f64>, Vec<f64>) = shared.into_iter().unzip();
                if let Some(r) = stats::correl(&x, &y) {
                    if r.abs() >= 0.7 {
                        add("corr", format!("{} and {} {}", names[*ci], names[*cj], if r > 0.0 { "rise together" } else { "move in opposite directions" }), format!("Correlation {r:.2}."), at(*ci, 0, n - 1));
                    }
                }
            }
        }
        for c in 0..cols {
            if kinds[c] == Kind::Empty {
                continue;
            }
            let blanks = body.iter().filter(|r| matches!(r[c], Value::Empty)).count();
            if blanks > 0 {
                add("blank", format!("{} has {} blank cell{}", names[c], blanks, if blanks == 1 { "" } else { "s" }), format!("{:.0}% of the column is empty.", blanks as f64 * 100.0 / n as f64), at(c, 0, n - 1));
            }
        }
        Ok(out.iter().map(|l| l.iter().map(|f| { let mut s = String::new(); escape(f, &mut s); s }).collect::<Vec<_>>().join("\t")).collect::<Vec<_>>().join("\n"))
    }
}
