use super::*;

pub(super) struct Ctx<'a> {
    pub data: &'a Data,
    pub keep: &'a [usize],
    pub rd: &'a Dim,
    pub cd: &'a Dim,
}

impl Ctx<'_> {
    fn at(&self, vf: &Vf, rp: &[usize], cp: &[usize]) -> Option<f64> {
        let recs: Vec<usize> = self.keep.iter().copied().filter(|&r| hit(self.rd, rp, r) && hit(self.cd, cp, r)).collect();
        aggregate(self.data, vf, &recs).ok().flatten()
    }

    fn dim(&self, rows: bool) -> &Dim {
        if rows {
            self.rd
        } else {
            self.cd
        }
    }
}

fn swap(path: &[usize], lvl: usize, id: usize) -> Vec<usize> {
    let mut p = path.to_vec();
    p[lvl] = id;
    p
}

fn ratio(a: f64, b: f64) -> String {
    if b != 0.0 && (a / b).is_finite() {
        format!("{}", a / b)
    } else {
        "#DIV/0!".to_string()
    }
}

fn plain(x: f64) -> String {
    if x.is_finite() {
        format!("{x}")
    } else {
        "#DIV/0!".to_string()
    }
}

pub(super) fn apply(cx: &Ctx, vf: &Vf, rp: &[usize], cp: &[usize], own: Result<Option<f64>, ()>) -> (String, u8) {
    let a = match own {
        Ok(None) => return (String::new(), 0),
        Err(()) => return ("#DIV/0!".to_string(), 1),
        Ok(Some(a)) => a,
    };
    match vf.show {
        Show::Normal => (plain(a), 0),
        Show::Grand => (cx.at(vf, &[], &[]).map_or("#DIV/0!".to_string(), |b| ratio(a, b)), 1),
        Show::Col => (cx.at(vf, &[], cp).map_or("#DIV/0!".to_string(), |b| ratio(a, b)), 1),
        Show::Row => (cx.at(vf, rp, &[]).map_or("#DIV/0!".to_string(), |b| ratio(a, b)), 1),
        Show::Index => {
            let (g, r, c) = (cx.at(vf, &[], &[]), cx.at(vf, rp, &[]), cx.at(vf, &[], cp));
            match (g, r, c) {
                (Some(g), Some(r), Some(c)) if r * c != 0.0 && (a * g / (r * c)).is_finite() => (format!("{}", a * g / (r * c)), 3),
                _ => ("#DIV/0!".to_string(), 3),
            }
        }
        other => {
            let Some((rows, lvl)) = vf.base else { return (String::new(), 0) };
            let path = if rows { rp } else { cp };
            let d = cx.dim(rows);
            let pct = matches!(other, Show::Of | Show::ParentRow | Show::ParentCol | Show::Parent | Show::PctDiff | Show::PctRunning);
            let shape = if pct {
                1
            } else if matches!(other, Show::RankAsc | Show::RankDesc) {
                2
            } else {
                0
            };
            if path.len() <= lvl {
                return (String::new(), shape);
            }
            let value_at = |id: usize| -> Option<f64> {
                let np = swap(path, lvl, id);
                if rows {
                    cx.at(vf, &np, cp)
                } else {
                    cx.at(vf, rp, &np)
                }
            };
            let parent_path = || -> Vec<usize> {
                if path.len() > lvl + 1 {
                    path[..=lvl].to_vec()
                } else {
                    path[..path.len() - 1].to_vec()
                }
            };
            let target = || -> Option<usize> {
                let own_id = path[lvl];
                match vf.base_item.as_str() {
                    "(previous)" => own_id.checked_sub(1),
                    "(next)" => (own_id + 1 < d.items[lvl].len()).then_some(own_id + 1),
                    item => d.items[lvl].iter().position(|t| shown_label(t) == item),
                }
            };
            match other {
                Show::Of | Show::Diff | Show::PctDiff => {
                    let Some(t) = target() else { return (String::new(), shape) };
                    if t == path[lvl] && vf.base_item != "(previous)" && vf.base_item != "(next)" {
                        return (String::new(), shape);
                    }
                    let Some(b) = value_at(t) else { return (String::new(), shape) };
                    match other {
                        Show::Of => (ratio(a, b), 1),
                        Show::Diff => (plain(a - b), 0),
                        _ => (ratio(a - b, b), 1),
                    }
                }
                Show::Running | Show::PctRunning => {
                    let total: f64 = (0..=path[lvl]).filter_map(&value_at).sum();
                    if other == Show::Running {
                        (plain(total), 0)
                    } else {
                        let whole = if rows { cx.at(vf, &path[..lvl], cp) } else { cx.at(vf, rp, &path[..lvl]) };
                        (whole.map_or("#DIV/0!".to_string(), |b| ratio(total, b)), 1)
                    }
                }
                Show::RankAsc | Show::RankDesc => {
                    let siblings: Vec<f64> = (0..d.items[lvl].len()).filter_map(&value_at).collect();
                    let better = siblings.iter().filter(|&&v| if other == Show::RankAsc { v < a } else { v > a }).count();
                    (format!("{}", better + 1), 2)
                }
                _ => {
                    let pp = parent_path();
                    let whole = match other {
                        Show::ParentRow => cx.at(vf, &pp, cp),
                        Show::ParentCol => cx.at(vf, rp, &pp),
                        _ => {
                            if rows {
                                cx.at(vf, &pp, &[])
                            } else {
                                cx.at(vf, &[], &pp)
                            }
                        }
                    };
                    let whole = if matches!(other, Show::ParentRow) && !rows || matches!(other, Show::ParentCol) && rows { cx.at(vf, rp, cp) } else { whole };
                    (whole.map_or("#DIV/0!".to_string(), |b| ratio(a, b)), 1)
                }
            }
        }
    }
}
