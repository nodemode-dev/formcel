use super::report::{nums_of, text_of};
use super::*;

struct Grp {
    name: String,
    v: Vec<f64>,
}

struct W {
    o: Addr,
    cells: Vec<(Addr, String)>,
    fmts: Vec<(Addr, Addr, String)>,
    charts: Vec<String>,
}

impl W {
    fn at(&self, r: u32, c: u32) -> String {
        format!("{}{}", crate::col_name(self.o.col + c), self.o.row + r + 1)
    }

    fn span(&self, r0: u32, c0: u32, r1: u32, c1: u32) -> String {
        format!("{}:{}", self.at(r0, c0), self.at(r1, c1))
    }

    fn chart(&mut self, kind: &str, range: String, title: &str, xt: &str, yt: &str, secondary: &str) {
        self.charts.push(format!("{kind}|{range}|{title}|{xt}|{yt}|{secondary}"));
    }

    fn put(&mut self, r: u32, c: u32, s: impl Into<String>) {
        self.cells.push((Addr { row: self.o.row + r, col: self.o.col + c }, s.into()));
    }

    fn num(&mut self, r: u32, c: u32, x: f64) {
        self.put(r, c, fnum(tidy(x)));
    }

    fn fmt(&mut self, r0: u32, c0: u32, r1: u32, c1: u32, code: &str) {
        self.fmts.push((Addr { row: self.o.row + r0, col: self.o.col + c0 }, Addr { row: self.o.row + r1, col: self.o.col + c1 }, code.to_string()));
    }
}

pub(super) fn dump_reply(cells: &[(Addr, String)], o: Addr) -> String {
    let top = cells.iter().map(|c| c.0.row).max().unwrap_or(o.row) - o.row + 1;
    let wide = cells.iter().map(|c| c.0.col).max().unwrap_or(o.col) - o.col + 1;
    let mut l = format!("dump\t{top}\t{wide}");
    for (ad, raw) in cells {
        let mut e = String::new();
        escape(raw, &mut e);
        l.push_str(&format!("\t{}\t{}\t{}", ad.row - o.row, ad.col - o.col, e));
    }
    l
}

fn tidy(x: f64) -> f64 {
    if x.abs() < 1e-13 {
        0.0
    } else {
        x
    }
}

fn f_inv_upper(p: f64, d1: f64, d2: f64) -> f64 {
    let (mut lo, mut hi) = (0.0, 1.0);
    while stats::f_upper(hi, d1, d2) > p && hi < 1e12 {
        hi *= 2.0;
    }
    for _ in 0..200 {
        let mid = (lo + hi) / 2.0;
        if stats::f_upper(mid, d1, d2) > p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo + hi) / 2.0
}

fn groups_of(block: &[Vec<Value>], by_row: bool, labels: bool) -> Vec<Grp> {
    let mut out = Vec::new();
    if by_row {
        for (i, row) in block.iter().enumerate() {
            let (name, rest) = if labels { (text_of(&row[0]).unwrap_or_else(|| format!("Row {}", i + 1)), &row[1..]) } else { (format!("Row {}", i + 1), &row[..]) };
            out.push(Grp { name, v: nums_of(rest) });
        }
    } else {
        for c in 0..block[0].len() {
            let col: Vec<Value> = block.iter().map(|r| r[c].clone()).collect();
            let (name, rest) = if labels { (text_of(&col[0]).unwrap_or_else(|| format!("Column {}", c + 1)), &col[1..]) } else { (format!("Column {}", c + 1), &col[..]) };
            out.push(Grp { name, v: nums_of(rest) });
        }
    }
    out.retain(|g| !g.v.is_empty());
    out
}

struct Rng(u64);

impl Rng {
    fn new(seed: Option<f64>) -> Rng {
        let base = seed.map_or_else(|| crate::numfmt::now().to_bits(), f64::to_bits);
        let mut r = Rng(base ^ 0x9E37_79B9_7F4A_7C15);
        for _ in 0..8 {
            r.next();
        }
        r
    }

    fn next(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        ((x.wrapping_mul(0x2545_F491_4F6C_DD1D)) >> 11) as f64 / (1u64 << 53) as f64
    }

    fn normal(&mut self) -> f64 {
        let (u, v) = (self.next().max(1e-300), self.next());
        (-2.0 * u.ln()).sqrt() * (2.0 * std::f64::consts::PI * v).cos()
    }
}

fn summary_rows(w: &mut W, r: &mut u32, head: &str, names: &[String], groups: &[Vec<f64>]) {
    w.put(*r, 0, head);
    for (i, h) in ["Count", "Sum", "Average", "Variance"].iter().enumerate() {
        w.put(*r, 1 + i as u32, *h);
    }
    *r += 1;
    for (n, v) in names.iter().zip(groups) {
        w.put(*r, 0, n.clone());
        w.num(*r, 1, v.len() as f64);
        w.num(*r, 2, v.iter().sum());
        w.num(*r, 3, stats::mean(v));
        w.num(*r, 4, if v.len() > 1 { stats::var_s(v) } else { f64::NAN });
        *r += 1;
    }
}

fn anova_table(w: &mut W, r: &mut u32, rows: &[(&str, f64, f64)], alpha: f64, total: (f64, f64)) {
    for (i, h) in ["Source of Variation", "SS", "df", "MS", "F", "P-value", "F crit"].iter().enumerate() {
        w.put(*r, i as u32, *h);
    }
    *r += 1;
    let err = rows[rows.len() - 1];
    for (k, (name, ss, df)) in rows.iter().enumerate() {
        w.put(*r, 0, *name);
        w.num(*r, 1, *ss);
        w.num(*r, 2, *df);
        w.num(*r, 3, ss / df);
        if k + 1 < rows.len() {
            let f = (ss / df) / (err.1 / err.2);
            w.num(*r, 4, f);
            w.num(*r, 5, stats::f_upper(f, *df, err.2));
            w.num(*r, 6, f_inv_upper(alpha, *df, err.2));
        }
        *r += 1;
    }
    *r += 1;
    w.put(*r, 0, "Total");
    w.num(*r, 1, total.0);
    w.num(*r, 2, total.1);
}

fn fft(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = 2.0 * std::f64::consts::PI / len as f64 * if inverse { 1.0 } else { -1.0 };
        let (wr, wi) = (ang.cos(), ang.sin());
        let mut i = 0;
        while i < n {
            let (mut cr, mut ci) = (1.0, 0.0);
            for k in 0..len / 2 {
                let (ur, ui) = (re[i + k], im[i + k]);
                let (vr, vi) = (re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, re[i + k + len / 2] * ci + im[i + k + len / 2] * cr);
                re[i + k] = ur + vr;
                im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr;
                im[i + k + len / 2] = ui - vi;
                let t = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = t;
            }
            i += len;
        }
        len <<= 1;
    }
    if inverse {
        for k in 0..n {
            re[k] /= n as f64;
            im[k] /= n as f64;
        }
    }
}

impl Workbook {
    fn tp_range(&self, src: usize, text: &str) -> Result<(Vec<Vec<Value>>, Area, usize), String> {
        let (sh, ar) = self.resolve(text, src)?;
        Ok((self.block(sh, ar), ar, sh))
    }

    fn tp_flat(&self, src: usize, text: &str, labels: bool) -> Result<(String, Vec<f64>), String> {
        let (blk, _, _) = self.tp_range(src, text)?;
        let g = groups_of(&blk, false, labels);
        let name = g.first().map_or_else(|| "Variable".to_string(), |x| x.name.clone());
        Ok((name, g.into_iter().flat_map(|x| x.v).collect()))
    }

    pub(super) fn toolpak(&mut self, tool: &str, a: &[String], fx: &mut Effect) -> Reply {
        if a.len() < 4 {
            return Err("The request was incomplete.".to_string());
        }
        let src = self.sheet_of(&a[0])?;
        let dump = a[2].trim() == "=";
        let dst = if dump { usize::MAX } else { self.dst_of(&a[2])? };
        let origin = parse_a1(&a[3]).map_err(|_| "Choose a cell for the output.".to_string())?;
        let mut w = W { o: origin, cells: Vec::new(), fmts: Vec::new(), charts: Vec::new() };
        let arg = |i: usize| a.get(i).map(|s| s.trim().to_string()).unwrap_or_default();
        let flag = |i: usize| a.get(i).is_some_and(|s| s.trim() == "1");
        let numarg = |i: usize, d: f64| -> Result<f64, String> {
            match a.get(i).map(|s| s.trim()) {
                None | Some("") => Ok(d),
                Some(s) => pnum(s),
            }
        };
        match tool {
            "anova1" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let groups = groups_of(&blk, arg(4) == "r", flag(5));
                let alpha = numarg(6, 0.05)?;
                if groups.len() < 2 {
                    return Err("Single factor ANOVA needs at least two groups of numbers.".to_string());
                }
                let n_all: usize = groups.iter().map(|g| g.v.len()).sum();
                let k = groups.len();
                if n_all <= k {
                    return Err("Each group needs more than one number for the within-groups variance.".to_string());
                }
                let all: Vec<f64> = groups.iter().flat_map(|g| g.v.clone()).collect();
                let gm = stats::mean(&all);
                let ssb: f64 = groups.iter().map(|g| g.v.len() as f64 * (stats::mean(&g.v) - gm).powi(2)).sum();
                let ssw: f64 = groups.iter().map(|g| g.v.iter().map(|x| (x - stats::mean(&g.v)).powi(2)).sum::<f64>()).sum();
                w.put(0, 0, "Anova: Single Factor");
                w.put(2, 0, "SUMMARY");
                let mut r = 3;
                let names: Vec<String> = groups.iter().map(|g| g.name.clone()).collect();
                let vs: Vec<Vec<f64>> = groups.iter().map(|g| g.v.clone()).collect();
                summary_rows(&mut w, &mut r, "Groups", &names, &vs);
                r += 1;
                w.put(r, 0, "ANOVA");
                r += 1;
                anova_table(&mut w, &mut r, &[("Between Groups", ssb, (k - 1) as f64), ("Within Groups", ssw, (n_all - k) as f64)], alpha, (ssb + ssw, (n_all - 1) as f64));
            }
            "anova2" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let labels = flag(4);
                let alpha = numarg(5, 0.05)?;
                let (r0, c0) = (usize::from(labels), usize::from(labels));
                let rows = blk.len() - r0;
                let cols = blk[0].len() - c0;
                if rows < 2 || cols < 2 {
                    return Err("Two factor ANOVA needs at least two rows and two columns of numbers.".to_string());
                }
                let mut m = vec![vec![0.0; cols]; rows];
                for i in 0..rows {
                    for j in 0..cols {
                        m[i][j] = match &blk[r0 + i][c0 + j] {
                            Value::Number(n) => *n,
                            _ => return Err("The data range holds text or blanks.".to_string()),
                        };
                    }
                }
                let all: Vec<f64> = m.iter().flatten().copied().collect();
                let gm = stats::mean(&all);
                let rmeans: Vec<f64> = m.iter().map(|r| stats::mean(r)).collect();
                let cvals: Vec<Vec<f64>> = (0..cols).map(|j| m.iter().map(|r| r[j]).collect()).collect();
                let cmeans: Vec<f64> = cvals.iter().map(|c| stats::mean(c)).collect();
                let sst: f64 = all.iter().map(|x| (x - gm).powi(2)).sum();
                let ssr = cols as f64 * rmeans.iter().map(|x| (x - gm).powi(2)).sum::<f64>();
                let ssc = rows as f64 * cmeans.iter().map(|x| (x - gm).powi(2)).sum::<f64>();
                let sse = sst - ssr - ssc;
                w.put(0, 0, "Anova: Two-Factor Without Replication");
                w.put(2, 0, "SUMMARY");
                let mut r = 3;
                let rnames: Vec<String> = (0..rows).map(|i| if labels { text_of(&blk[r0 + i][0]).unwrap_or_else(|| format!("Row {}", i + 1)) } else { format!("Row {}", i + 1) }).collect();
                let cnames: Vec<String> = (0..cols).map(|j| if labels { text_of(&blk[0][c0 + j]).unwrap_or_else(|| format!("Column {}", j + 1)) } else { format!("Column {}", j + 1) }).collect();
                summary_rows(&mut w, &mut r, "", &rnames, &m);
                r += 1;
                summary_rows(&mut w, &mut r, "", &cnames, &cvals);
                r += 1;
                w.put(r, 0, "ANOVA");
                r += 1;
                anova_table(&mut w, &mut r, &[("Rows", ssr, (rows - 1) as f64), ("Columns", ssc, (cols - 1) as f64), ("Error", sse, ((rows - 1) * (cols - 1)) as f64)], alpha, (sst, (rows * cols - 1) as f64));
            }
            "anova2r" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let per = numarg(4, 0.0)? as usize;
                let alpha = numarg(5, 0.05)?;
                let data_rows = blk.len().saturating_sub(1);
                if per < 2 || data_rows == 0 || data_rows % per != 0 {
                    return Err("Rows per sample must be at least 2 and divide the number of data rows evenly.".to_string());
                }
                let s = data_rows / per;
                let cols = blk[0].len() - 1;
                if s < 2 || cols < 2 {
                    return Err("Two factor ANOVA with replication needs at least two samples and two columns.".to_string());
                }
                let mut cell = vec![vec![Vec::new(); cols]; s];
                for i in 0..s {
                    for k in 0..per {
                        for j in 0..cols {
                            match &blk[1 + i * per + k][1 + j] {
                                Value::Number(n) => cell[i][j].push(*n),
                                _ => return Err("The data range holds text or blanks.".to_string()),
                            }
                        }
                    }
                }
                let all: Vec<f64> = cell.iter().flatten().flatten().copied().collect();
                let gm = stats::mean(&all);
                let samp: Vec<Vec<f64>> = cell.iter().map(|r| r.iter().flatten().copied().collect()).collect();
                let colv: Vec<Vec<f64>> = (0..cols).map(|j| cell.iter().flat_map(|r| r[j].clone()).collect()).collect();
                let sst: f64 = all.iter().map(|x| (x - gm).powi(2)).sum();
                let sss = (cols * per) as f64 * samp.iter().map(|v| (stats::mean(v) - gm).powi(2)).sum::<f64>();
                let ssc = (s * per) as f64 * colv.iter().map(|v| (stats::mean(v) - gm).powi(2)).sum::<f64>();
                let ssw: f64 = cell.iter().flatten().map(|v| v.iter().map(|x| (x - stats::mean(v)).powi(2)).sum::<f64>()).sum();
                let ssi = sst - sss - ssc - ssw;
                w.put(0, 0, "Anova: Two-Factor With Replication");
                w.put(2, 0, "SUMMARY");
                let mut r = 3;
                let cnames: Vec<String> = (0..cols).map(|j| text_of(&blk[0][1 + j]).unwrap_or_else(|| format!("Column {}", j + 1))).collect();
                let mut blocks: Vec<(String, Vec<Vec<f64>>)> = Vec::new();
                for i in 0..s {
                    let name = text_of(&blk[1 + i * per][0]).unwrap_or_else(|| format!("Sample {}", i + 1));
                    let mut cols_v: Vec<Vec<f64>> = cell[i].clone();
                    cols_v.push(samp[i].clone());
                    blocks.push((name, cols_v));
                }
                let mut tot: Vec<Vec<f64>> = colv.clone();
                tot.push(all.clone());
                blocks.push(("Total".to_string(), tot));
                let mut heads = cnames.clone();
                heads.push("Total".to_string());
                for (name, cv) in &blocks {
                    w.put(r, 0, name.clone());
                    for (j, h) in heads.iter().enumerate() {
                        w.put(r, 1 + j as u32, h.clone());
                    }
                    r += 1;
                    let stat: [(&str, fn(&[f64]) -> f64); 4] = [("Count", |v| v.len() as f64), ("Sum", |v| v.iter().sum()), ("Average", stats::mean), ("Variance", |v| if v.len() > 1 { stats::var_s(v) } else { f64::NAN })];
                    for (lab, f) in stat {
                        w.put(r, 0, lab);
                        for (j, v) in cv.iter().enumerate() {
                            w.num(r, 1 + j as u32, f(v));
                        }
                        r += 1;
                    }
                    r += 1;
                }
                w.put(r, 0, "ANOVA");
                r += 1;
                anova_table(&mut w, &mut r, &[("Sample", sss, (s - 1) as f64), ("Columns", ssc, (cols - 1) as f64), ("Interaction", ssi, ((s - 1) * (cols - 1)) as f64), ("Within", ssw, (s * cols * (per - 1)) as f64)], alpha, (sst, (all.len() - 1) as f64));
            }
            "correl" | "covar" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let groups = groups_of(&blk, arg(4) == "r", flag(5));
                if groups.is_empty() {
                    return Err("The input range holds no numbers.".to_string());
                }
                let n = groups[0].v.len();
                if groups.iter().any(|g| g.v.len() != n) {
                    return Err("Every column needs the same number of numbers.".to_string());
                }
                w.put(0, 0, if tool == "correl" { "Correlation" } else { "Covariance" });
                let k = groups.len();
                for (j, g) in groups.iter().enumerate() {
                    w.put(1, 1 + j as u32, g.name.clone());
                    w.put(2 + j as u32, 0, g.name.clone());
                }
                for i in 0..k {
                    for j in 0..=i {
                        let (x, y) = (&groups[i].v, &groups[j].v);
                        let val = if tool == "correl" {
                            if i == j { 1.0 } else { stats::correl(x, y).unwrap_or(f64::NAN) }
                        } else {
                            let (mx, my) = (stats::mean(x), stats::mean(y));
                            x.iter().zip(y).map(|(p, q)| (p - mx) * (q - my)).sum::<f64>() / n as f64
                        };
                        w.num(2 + i as u32, 1 + j as u32, val);
                    }
                }
            }
            "expsmooth" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let damp = numarg(4, 0.3)?;
                let labels = flag(5);
                if !(0.0..1.0).contains(&damp) {
                    return Err("The damping factor must be at least 0 and less than 1.".to_string());
                }
                let g = groups_of(&blk, false, labels);
                let v = g.first().ok_or("The input range holds no numbers.")?;
                let mut f = vec![f64::NAN; v.v.len()];
                for t in 1..v.v.len() {
                    f[t] = if t == 1 { v.v[0] } else { (1.0 - damp) * v.v[t - 1] + damp * f[t - 1] };
                }
                w.put(0, 0, "Data");
                w.put(0, 1, "Exponential Smoothing");
                if flag(6) {
                    w.put(0, 2, "Standard Error");
                }
                for t in 0..v.v.len() {
                    w.num(1 + t as u32, 0, v.v[t]);
                    w.num(1 + t as u32, 1, f[t]);
                    if flag(6) {
                        if t >= 3 {
                            let s: f64 = (t - 2..=t).map(|i| (v.v[i] - f[i]).powi(2)).sum::<f64>() / 3.0;
                            w.num(1 + t as u32, 2, s.sqrt());
                        } else {
                            w.put(1 + t as u32, 2, "#N/A");
                        }
                    }
                }
                if flag(7) {
                    let range = w.span(0, 0, v.v.len() as u32, 1);
                    w.chart("line", range, "Exponential Smoothing", "Data point", "Value", "");
                }
            }
            "movavg" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let k = numarg(4, 3.0)? as usize;
                let g = groups_of(&blk, false, flag(5));
                let v = g.first().ok_or("The input range holds no numbers.")?;
                if k < 1 || k > v.v.len() {
                    return Err("The interval must be at least 1 and no larger than the number of values.".to_string());
                }
                w.put(0, 0, "Data");
                w.put(0, 1, "Moving Average");
                if flag(6) {
                    w.put(0, 2, "Standard Error");
                }
                let avg = |t: usize| -> f64 { v.v[t + 1 - k..=t].iter().sum::<f64>() / k as f64 };
                for t in 0..v.v.len() {
                    w.num(1 + t as u32, 0, v.v[t]);
                    if t + 1 >= k {
                        w.num(1 + t as u32, 1, avg(t));
                    } else {
                        w.put(1 + t as u32, 1, "#N/A");
                    }
                    if flag(6) {
                        if t + 1 >= 2 * k - 1 {
                            let s: f64 = (t + 1 - k..=t).map(|i| (v.v[i] - avg(i)).powi(2)).sum::<f64>() / k as f64;
                            w.num(1 + t as u32, 2, s.sqrt());
                        } else {
                            w.put(1 + t as u32, 2, "#N/A");
                        }
                    }
                }
                if flag(7) {
                    let range = w.span(0, 0, v.v.len() as u32, 1);
                    w.chart("line", range, "Moving Average", "Data point", "Value", "");
                }
            }
            "ftest" => {
                let labels = flag(5);
                let alpha = numarg(6, 0.05)?;
                let (n1, v1) = self.tp_flat(src, &a[1], labels)?;
                let (n2, v2) = self.tp_flat(src, &arg(4), labels)?;
                if v1.len() < 2 || v2.len() < 2 {
                    return Err("Each variable needs at least two numbers.".to_string());
                }
                let (s1, s2) = (stats::var_s(&v1), stats::var_s(&v2));
                let (d1, d2) = ((v1.len() - 1) as f64, (v2.len() - 1) as f64);
                let f = s1 / s2;
                w.put(0, 0, "F-Test Two-Sample for Variances");
                w.put(2, 1, n1);
                w.put(2, 2, n2);
                for (i, (lab, x, y)) in [("Mean", stats::mean(&v1), stats::mean(&v2)), ("Variance", s1, s2), ("Observations", v1.len() as f64, v2.len() as f64), ("df", d1, d2)].iter().enumerate() {
                    w.put(3 + i as u32, 0, *lab);
                    w.num(3 + i as u32, 1, *x);
                    w.num(3 + i as u32, 2, *y);
                }
                w.put(7, 0, "F");
                w.num(7, 1, f);
                let (p, crit) = if f > 1.0 { (stats::f_upper(f, d1, d2), f_inv_upper(alpha, d1, d2)) } else { (1.0 - stats::f_upper(f, d1, d2), f_inv_upper(1.0 - alpha, d1, d2)) };
                w.put(8, 0, "P(F<=f) one-tail");
                w.num(8, 1, p);
                w.put(9, 0, "F Critical one-tail");
                w.num(9, 1, crit);
            }
            "ttest" => {
                let kind = arg(5);
                let hyp = numarg(6, 0.0)?;
                let labels = flag(7);
                let alpha = numarg(8, 0.05)?;
                let (n1, v1) = self.tp_flat(src, &a[1], labels)?;
                let (n2, v2) = self.tp_flat(src, &arg(4), labels)?;
                let title = match kind.as_str() {
                    "paired" => "t-Test: Paired Two Sample for Means",
                    "equal" => "t-Test: Two-Sample Assuming Equal Variances",
                    _ => "t-Test: Two-Sample Assuming Unequal Variances",
                };
                if v1.len() < 2 || v2.len() < 2 {
                    return Err("Each variable needs at least two numbers.".to_string());
                }
                let (m1, m2, s1, s2) = (stats::mean(&v1), stats::mean(&v2), stats::var_s(&v1), stats::var_s(&v2));
                let (c1, c2) = (v1.len() as f64, v2.len() as f64);
                w.put(0, 0, title);
                w.put(2, 1, n1);
                w.put(2, 2, n2);
                let mut r = 3;
                let mut rowp = |w: &mut W, lab: &str, x: f64, y: Option<f64>| {
                    w.put(r, 0, lab);
                    w.num(r, 1, x);
                    if let Some(y) = y {
                        w.num(r, 2, y);
                    }
                    r += 1;
                };
                rowp(&mut w, "Mean", m1, Some(m2));
                rowp(&mut w, "Variance", s1, Some(s2));
                rowp(&mut w, "Observations", c1, Some(c2));
                let (t, df);
                match kind.as_str() {
                    "paired" => {
                        if v1.len() != v2.len() {
                            return Err("A paired t-test needs the same number of values in both variables.".to_string());
                        }
                        let d: Vec<f64> = v1.iter().zip(&v2).map(|(x, y)| x - y).collect();
                        let sd = stats::var_s(&d).sqrt();
                        rowp(&mut w, "Pearson Correlation", stats::correl(&v1, &v2).unwrap_or(f64::NAN), None);
                        rowp(&mut w, "Hypothesized Mean Difference", hyp, None);
                        df = c1 - 1.0;
                        t = (stats::mean(&d) - hyp) / (sd / c1.sqrt());
                        rowp(&mut w, "df", df, None);
                    }
                    "equal" => {
                        df = c1 + c2 - 2.0;
                        let sp = ((c1 - 1.0) * s1 + (c2 - 1.0) * s2) / df;
                        rowp(&mut w, "Pooled Variance", sp, None);
                        rowp(&mut w, "Hypothesized Mean Difference", hyp, None);
                        t = (m1 - m2 - hyp) / (sp * (1.0 / c1 + 1.0 / c2)).sqrt();
                        rowp(&mut w, "df", df, None);
                    }
                    _ => {
                        let (q1, q2) = (s1 / c1, s2 / c2);
                        df = ((q1 + q2).powi(2) / (q1 * q1 / (c1 - 1.0) + q2 * q2 / (c2 - 1.0))).round();
                        rowp(&mut w, "Hypothesized Mean Difference", hyp, None);
                        t = (m1 - m2 - hyp) / (q1 + q2).sqrt();
                        rowp(&mut w, "df", df, None);
                    }
                }
                let p2 = stats::t_two_tail(t.abs(), df);
                rowp(&mut w, "t Stat", t, None);
                rowp(&mut w, "P(T<=t) one-tail", p2 / 2.0, None);
                rowp(&mut w, "t Critical one-tail", stats::t_inv_two_tail(2.0 * alpha, df), None);
                rowp(&mut w, "P(T<=t) two-tail", p2, None);
                rowp(&mut w, "t Critical two-tail", stats::t_inv_two_tail(alpha, df), None);
            }
            "ztest" => {
                let hyp = numarg(5, 0.0)?;
                let (va, vb) = (numarg(6, f64::NAN)?, numarg(7, f64::NAN)?);
                let labels = flag(8);
                let alpha = numarg(9, 0.05)?;
                if !(va > 0.0 && vb > 0.0) {
                    return Err("Enter the known variance of each variable; both must be above zero.".to_string());
                }
                let (n1, v1) = self.tp_flat(src, &a[1], labels)?;
                let (n2, v2) = self.tp_flat(src, &arg(4), labels)?;
                if v1.is_empty() || v2.is_empty() {
                    return Err("Each variable needs at least one number.".to_string());
                }
                let (m1, m2) = (stats::mean(&v1), stats::mean(&v2));
                let z = (m1 - m2 - hyp) / (va / v1.len() as f64 + vb / v2.len() as f64).sqrt();
                w.put(0, 0, "z-Test: Two Sample for Means");
                w.put(2, 1, n1);
                w.put(2, 2, n2);
                for (i, (lab, x, y)) in [("Mean", m1, m2), ("Known Variance", va, vb), ("Observations", v1.len() as f64, v2.len() as f64)].iter().enumerate() {
                    w.put(3 + i as u32, 0, *lab);
                    w.num(3 + i as u32, 1, *x);
                    w.num(3 + i as u32, 2, *y);
                }
                let p1 = 1.0 - stats::norm_cdf(z.abs());
                for (i, (lab, x)) in [("Hypothesized Mean Difference", hyp), ("z", z), ("P(Z<=z) one-tail", p1), ("z Critical one-tail", stats::norm_s_inv(1.0 - alpha)), ("P(Z<=z) two-tail", 2.0 * p1), ("z Critical two-tail", stats::norm_s_inv(1.0 - alpha / 2.0))].iter().enumerate() {
                    w.put(6 + i as u32, 0, *lab);
                    w.num(6 + i as u32, 1, *x);
                }
            }
            "fourier" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let mut pts: Vec<(f64, f64)> = Vec::new();
                for row in blk.iter().skip(usize::from(flag(5))) {
                    for cell in row {
                        match cell {
                            Value::Number(x) => pts.push((*x, 0.0)),
                            Value::Text(t) => {
                                if let Some(p) = crate::eval::fx_eng::complex_parts(t) {
                                    pts.push(p);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                if pts.is_empty() {
                    return Err("The input range holds no numbers.".to_string());
                }
                let n = pts.len();
                if !(2..=4096).contains(&n) || !n.is_power_of_two() {
                    return Err("Fourier Analysis needs a number of values that is a power of 2, from 2 to 4096.".to_string());
                }
                let (mut re, mut im): (Vec<f64>, Vec<f64>) = pts.into_iter().unzip();
                fft(&mut re, &mut im, arg(4) == "1");
                w.put(0, 0, if arg(4) == "1" { "Inverse Fourier" } else { "Fourier" });
                for k in 0..n {
                    let (x, y) = (tidy(re[k]), tidy(im[k]));
                    w.put(1 + k as u32, 0, crate::eval::fx_eng::complex_text(x, y));
                }
            }
            "hist" => {
                let labels = flag(5);
                let (name, data) = self.tp_flat(src, &a[1], labels)?;
                if data.is_empty() {
                    return Err("The input range holds no numbers.".to_string());
                }
                let mut bins: Vec<f64> = if arg(4).is_empty() {
                    let (lo, hi) = (data.iter().copied().fold(f64::INFINITY, f64::min), data.iter().copied().fold(f64::NEG_INFINITY, f64::max));
                    let k = (data.len() as f64).sqrt().ceil().max(1.0) as usize;
                    let step = (hi - lo) / k as f64;
                    (0..k).map(|i| lo + step * (i as f64 + 1.0)).collect()
                } else {
                    self.tp_flat(src, &arg(4), labels)?.1
                };
                bins.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
                bins.dedup();
                let mut freq = vec![0usize; bins.len() + 1];
                for x in &data {
                    let i = bins.iter().position(|b| x <= b).unwrap_or(bins.len());
                    freq[i] += 1;
                }
                let (pareto, cumul, chart) = (flag(6), flag(7), flag(8));
                let label = |s: String| if chart { format!("'{s}") } else { s };
                let mut rows: Vec<(String, usize)> = bins.iter().enumerate().map(|(i, b)| (fnum(*b), freq[i])).collect();
                rows.push(("More".to_string(), freq[bins.len()]));
                let total = data.len() as f64;
                let n = rows.len() as u32;
                let table = |w: &mut W, c0: u32, list: &[(String, usize)]| {
                    w.put(0, c0, "Bin");
                    w.put(0, c0 + 1, "Frequency");
                    if cumul {
                        w.put(0, c0 + 2, "Cumulative %");
                    }
                    let mut cum = 0usize;
                    for (i, (b, f)) in list.iter().enumerate() {
                        w.put(1 + i as u32, c0, label(b.clone()));
                        w.num(1 + i as u32, c0 + 1, *f as f64);
                        cum += f;
                        if cumul {
                            w.num(1 + i as u32, c0 + 2, cum as f64 / total);
                        }
                    }
                    if cumul {
                        w.fmt(1, c0 + 2, list.len() as u32, c0 + 2, "0.00%");
                    }
                };
                table(&mut w, 0, &rows);
                let mut at = 0u32;
                if pareto {
                    let mut sorted = rows.clone();
                    sorted.sort_by(|x, y| y.1.cmp(&x.1));
                    table(&mut w, 3, &sorted);
                    at = 3;
                }
                if chart {
                    let last = at + if cumul { 2 } else { 1 };
                    let range = w.span(0, at, n, last);
                    let kind = if cumul { "combo" } else { "column" };
                    let title = if pareto { format!("Pareto of {name}") } else { format!("Histogram of {name}") };
                    w.chart(kind, range, &title, "Bin", "Frequency", "");
                }
            }
            "rank" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let groups = groups_of(&blk, arg(4) == "r", flag(5));
                if groups.is_empty() {
                    return Err("The input range holds no numbers.".to_string());
                }
                let mut c0 = 0u32;
                for g in &groups {
                    let n = g.v.len();
                    let mut order: Vec<usize> = (0..n).collect();
                    order.sort_by(|&i, &j| g.v[j].partial_cmp(&g.v[i]).unwrap_or(std::cmp::Ordering::Equal));
                    for (i, h) in ["Point", g.name.as_str(), "Rank", "Percent"].iter().enumerate() {
                        w.put(0, c0 + i as u32, *h);
                    }
                    for (r, &i) in order.iter().enumerate() {
                        let x = g.v[i];
                        let rank = 1 + g.v.iter().filter(|y| **y > x).count();
                        let below = g.v.iter().filter(|y| **y < x).count();
                        w.num(1 + r as u32, c0, (i + 1) as f64);
                        w.num(1 + r as u32, c0 + 1, x);
                        w.num(1 + r as u32, c0 + 2, rank as f64);
                        w.num(1 + r as u32, c0 + 3, if n > 1 { below as f64 / (n - 1) as f64 } else { 1.0 });
                    }
                    w.fmt(1, c0 + 3, n as u32, c0 + 3, "0.00%");
                    c0 += 5;
                }
            }
            "sample" => {
                let (blk, _, _) = self.tp_range(src, &a[1])?;
                let g = groups_of(&blk, false, flag(6));
                let data: Vec<f64> = g.into_iter().flat_map(|x| x.v).collect();
                let k = numarg(5, 0.0)? as usize;
                if data.is_empty() || k == 0 {
                    return Err("Give a range of numbers and a period or sample size of at least 1.".to_string());
                }
                w.put(0, 0, "Sample");
                if arg(4) == "periodic" {
                    for (r, i) in (k - 1..data.len()).step_by(k).enumerate() {
                        w.num(1 + r as u32, 0, data[i]);
                    }
                } else {
                    let mut rng = Rng::new(None);
                    for r in 0..k {
                        w.num(1 + r as u32, 0, data[(rng.next() * data.len() as f64) as usize % data.len()]);
                    }
                }
            }
            "rand" => {
                let dist = arg(1);
                let nvars = numarg(4, 1.0)? as usize;
                let count = numarg(5, 1.0)? as usize;
                let seed = match arg(6).as_str() {
                    "" => None,
                    s => Some(pnum(s)?),
                };
                if nvars == 0 || count == 0 || nvars * count > 200_000 {
                    return Err("Ask for at least one variable and one number, and no more than 200,000 values in all.".to_string());
                }
                let p1 = numarg(7, f64::NAN)?;
                let p2 = numarg(8, f64::NAN)?;
                let mut rng = Rng::new(seed);
                let mut discrete: Vec<(f64, f64)> = Vec::new();
                if dist == "discrete" {
                    let (blk, _, _) = self.tp_range(src, &arg(7))?;
                    for r in &blk {
                        if let (Some(Value::Number(v)), Some(Value::Number(p))) = (r.first(), r.get(1)) {
                            discrete.push((*v, *p));
                        }
                    }
                    let tot: f64 = discrete.iter().map(|d| d.1).sum();
                    if discrete.is_empty() || (tot - 1.0).abs() > 1e-6 {
                        return Err("The value and probability range needs two columns and the probabilities must add up to 1.".to_string());
                    }
                }
                let need = |ok: bool, msg: &str| if ok { Ok(()) } else { Err(msg.to_string()) };
                match dist.as_str() {
                    "uniform" => need(p1 <= p2, "Between must not be above And.")?,
                    "normal" => need(p2 >= 0.0, "The standard deviation cannot be negative.")?,
                    "bernoulli" => need((0.0..=1.0).contains(&p1), "The probability must be between 0 and 1.")?,
                    "binomial" => need((0.0..=1.0).contains(&p1) && p2 >= 1.0 && p2 <= 100_000.0, "Use a probability from 0 to 1 and 1 to 100,000 trials.")?,
                    "poisson" => need(p1 > 0.0 && p1 <= 100_000.0, "Lambda must be above 0.")?,
                    "patterned" | "discrete" => {}
                    _ => return Err("Choose a distribution.".to_string()),
                }
                if dist == "patterned" {
                    let step = numarg(9, 1.0)?;
                    let each = numarg(10, 1.0)?.max(1.0) as usize;
                    let seq = numarg(11, 1.0)?.max(1.0) as usize;
                    if step <= 0.0 || !(p1 <= p2) {
                        return Err("Patterned needs From not above To and a Step above 0.".to_string());
                    }
                    let mut vals = Vec::new();
                    let mut x = p1;
                    while x <= p2 + 1e-12 && vals.len() < 200_000 {
                        for _ in 0..each {
                            vals.push(x);
                        }
                        x += step;
                    }
                    let mut out = Vec::new();
                    for _ in 0..seq {
                        out.extend(vals.iter().copied());
                    }
                    for c in 0..nvars {
                        for (r, v) in out.iter().enumerate() {
                            w.num(r as u32, c as u32, *v);
                        }
                    }
                } else {
                    for c in 0..nvars {
                        for r in 0..count {
                            let x = match dist.as_str() {
                                "uniform" => p1 + (p2 - p1) * rng.next(),
                                "normal" => p1 + p2 * rng.normal(),
                                "bernoulli" => f64::from(u8::from(rng.next() < p1)),
                                "binomial" => (0..p2 as usize).filter(|_| rng.next() < p1).count() as f64,
                                "poisson" => {
                                    if p1 < 30.0 {
                                        let l = (-p1).exp();
                                        let (mut k, mut p) = (0.0, 1.0);
                                        loop {
                                            p *= rng.next();
                                            if p <= l {
                                                break k;
                                            }
                                            k += 1.0;
                                        }
                                    } else {
                                        (p1 + p1.sqrt() * rng.normal()).round().max(0.0)
                                    }
                                }
                                _ => {
                                    let u = rng.next();
                                    let mut acc = 0.0;
                                    let mut pick = discrete[discrete.len() - 1].0;
                                    for (v, p) in &discrete {
                                        acc += p;
                                        if u <= acc {
                                            pick = *v;
                                            break;
                                        }
                                    }
                                    pick
                                }
                            };
                            w.num(r as u32, c as u32, x);
                        }
                    }
                }
            }
            _ => return Err("The engine does not know that analysis tool.".to_string()),
        }
        if dump {
            return Ok(dump_reply(&w.cells, w.o));
        }
        self.put_all(dst, &w.cells, fx)?;
        if dst != usize::MAX {
            for (t, b, code) in &w.fmts {
                if let Ok(e) = self.set_format(dst, *t, *b, code) {
                    fx.formats.extend(e.formats);
                }
            }
        }
        let wide = w.cells.iter().map(|c| c.0.col).max().unwrap_or(w.o.col) - w.o.col;
        let mut reply = format!("ok\t{}", w.cells.len());
        for (i, ch) in w.charts.iter().enumerate() {
            let anchor = w.at((i as u32 / 2) * 17, wide + 2 + (i as u32 % 2) * 9);
            reply.push_str(&format!("\t{ch}|{anchor}"));
        }
        Ok(reply)
    }
}
