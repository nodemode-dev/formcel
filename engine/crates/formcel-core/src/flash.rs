use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tf {
    Id,
    Lower,
    Upper,
    Proper,
    Tok(char, i8, u8),
    Tok2(char, i8, char, i8, u8),
    TokInit(char, i8),
    First(usize, u8),
    Last(usize, u8),
    Init,
    Digits,
    Alpha,
}

#[derive(Clone, Debug)]
enum Seg {
    Lit(String),
    Out(usize),
}

#[derive(Clone, Copy, Debug)]
enum Pick {
    Lit,
    Atom(usize, Tf),
}

const DELIMS: [char; 12] = [' ', ',', ';', '-', '/', '.', '_', '@', ':', '|', '(', ')'];

fn case(s: &str, k: u8) -> String {
    match k {
        1 => s.to_lowercase(),
        2 => s.to_uppercase(),
        3 => proper(s),
        _ => s.to_string(),
    }
}

pub fn proper(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut start = true;
    for ch in s.chars() {
        if ch.is_alphabetic() {
            if start {
                out.extend(ch.to_uppercase());
            } else {
                out.extend(ch.to_lowercase());
            }
            start = false;
        } else {
            out.push(ch);
            start = !ch.is_alphanumeric() && ch != '\'';
        }
    }
    out
}

fn token(s: &str, d: char, i: i8) -> Option<String> {
    let parts: Vec<&str> = s.split(d).map(str::trim).filter(|p| !p.is_empty()).collect();
    let idx = if i >= 0 { i as usize } else { parts.len().checked_sub((-i) as usize)? };
    parts.get(idx).map(|p| (*p).to_string())
}

pub fn eval_tf(s: &str, tf: Tf) -> Option<String> {
    let out = match tf {
        Tf::Id => s.to_string(),
        Tf::Lower => case(s, 1),
        Tf::Upper => case(s, 2),
        Tf::Proper => case(s, 3),
        Tf::Tok(d, i, k) => case(&token(s, d, i)?, k),
        Tf::Tok2(d, i, e, j, k) => case(&token(&token(s, d, i)?, e, j)?, k),
        Tf::TokInit(d, i) => token(s, d, i)?.chars().next()?.to_uppercase().to_string(),
        Tf::First(n, k) => {
            let chars: Vec<char> = s.chars().collect();
            if chars.len() < n {
                return None;
            }
            case(&chars[..n].iter().collect::<String>(), k)
        }
        Tf::Last(n, k) => {
            let chars: Vec<char> = s.chars().collect();
            if chars.len() < n {
                return None;
            }
            case(&chars[chars.len() - n..].iter().collect::<String>(), k)
        }
        Tf::Init => s.split_whitespace().filter_map(|w| w.chars().next()).flat_map(char::to_uppercase).collect(),
        Tf::Digits => s.chars().filter(char::is_ascii_digit).collect(),
        Tf::Alpha => s.chars().filter(|c| c.is_alphabetic()).collect(),
    };
    (!out.is_empty()).then_some(out)
}

fn cost(tf: Tf) -> usize {
    match tf {
        Tf::First(..) | Tf::Last(..) => 14,
        Tf::Digits | Tf::Alpha => 3,
        Tf::Init | Tf::TokInit(..) | Tf::Tok2(..) => 2,
        _ => 1,
    }
}

fn all_tf() -> Vec<Tf> {
    let mut out = vec![Tf::Id, Tf::Lower, Tf::Upper, Tf::Proper, Tf::Init, Tf::Digits, Tf::Alpha];
    for d in DELIMS {
        for i in [0i8, 1, 2, 3, -1, -2] {
            for k in 0..4u8 {
                out.push(Tf::Tok(d, i, k));
            }
            out.push(Tf::TokInit(d, i));
        }
    }
    for d in DELIMS {
        for i in [0i8, 1, -1] {
            for e in DELIMS {
                for j in [0i8, 1, -1] {
                    if d != e {
                        for k in 0..4u8 {
                            out.push(Tf::Tok2(d, i, e, j, k));
                        }
                    }
                }
            }
        }
    }
    for n in 1..=6usize {
        for k in [0u8, 2] {
            out.push(Tf::First(n, k));
            out.push(Tf::Last(n, k));
        }
    }
    out
}

fn search(t: &[char], p: usize, outs: &[Vec<char>], segs: &mut Vec<Seg>, found: &mut Vec<Vec<Seg>>, budget: &mut u32) {
    if *budget == 0 || found.len() >= 3000 {
        return;
    }
    *budget -= 1;
    if p == t.len() {
        found.push(segs.clone());
        return;
    }
    for (i, o) in outs.iter().enumerate() {
        if p + o.len() <= t.len() && t[p..p + o.len()] == o[..] {
            segs.push(Seg::Out(i));
            search(t, p + o.len(), outs, segs, found, budget);
            segs.pop();
        }
    }
    let c = t[p];
    if let Some(Seg::Lit(s)) = segs.last_mut() {
        s.push(c);
        search(t, p + 1, outs, segs, found, budget);
        if let Some(Seg::Lit(s)) = segs.last_mut() {
            s.pop();
        }
    } else {
        segs.push(Seg::Lit(c.to_string()));
        search(t, p + 1, outs, segs, found, budget);
        segs.pop();
    }
}

type Example = (Vec<(usize, String)>, Vec<char>);

fn resolve(segs: &[Seg], i: usize, cands: &[Vec<(usize, Tf)>], examples: &[Example], pos: &[usize], picks: &mut Vec<Pick>, budget: &mut u32) -> bool {
    if i == segs.len() {
        return pos.iter().zip(examples).all(|(p, e)| *p == e.1.len());
    }
    if *budget == 0 {
        return false;
    }
    match &segs[i] {
        Seg::Lit(l) => {
            let lit: Vec<char> = l.chars().collect();
            let mut next = Vec::with_capacity(pos.len());
            for (p, e) in pos.iter().zip(examples) {
                if e.1.len() < p + lit.len() || e.1[*p..p + lit.len()] != lit[..] {
                    return false;
                }
                next.push(p + lit.len());
            }
            picks.push(Pick::Lit);
            if resolve(segs, i + 1, cands, examples, &next, picks, budget) {
                return true;
            }
            picks.pop();
            false
        }
        Seg::Out(o) => {
            for (col, tf) in &cands[*o] {
                *budget = budget.saturating_sub(1);
                let mut next = Vec::with_capacity(pos.len());
                let mut ok = true;
                for (p, e) in pos.iter().zip(examples) {
                    let Some(src) = e.0.iter().find(|(c, _)| c == col) else {
                        ok = false;
                        break;
                    };
                    let Some(text) = eval_tf(&src.1, *tf) else {
                        ok = false;
                        break;
                    };
                    let chars: Vec<char> = text.chars().collect();
                    if e.1.len() < p + chars.len() || e.1[*p..p + chars.len()] != chars[..] {
                        ok = false;
                        break;
                    }
                    next.push(p + chars.len());
                }
                if !ok {
                    continue;
                }
                picks.push(Pick::Atom(*col, *tf));
                if resolve(segs, i + 1, cands, examples, &next, picks, budget) {
                    return true;
                }
                picks.pop();
            }
            false
        }
    }
}

pub struct Program {
    steps: Vec<(Option<(usize, Tf)>, String)>,
}

impl Program {
    pub fn run(&self, sources: &[(usize, String)]) -> Option<String> {
        let mut out = String::new();
        for (atom, lit) in &self.steps {
            match atom {
                None => out.push_str(lit),
                Some((col, tf)) => {
                    let src = sources.iter().find(|(c, _)| c == col)?;
                    out.push_str(&eval_tf(&src.1, *tf)?);
                }
            }
        }
        (!out.is_empty()).then_some(out)
    }
}

pub fn infer(examples: &[(Vec<(usize, String)>, String)]) -> Option<Program> {
    let (first_src, first_out) = examples.first()?;
    let target: Vec<char> = first_out.chars().collect();
    let tfs = all_tf();
    let mut groups: HashMap<Vec<char>, Vec<(usize, Tf)>> = HashMap::new();
    for (col, s) in first_src {
        for tf in &tfs {
            if let Some(o) = eval_tf(s, *tf) {
                groups.entry(o.chars().collect()).or_default().push((*col, *tf));
            }
        }
    }
    let mut keyed: Vec<(Vec<char>, Vec<(usize, Tf)>)> = groups.into_iter().collect();
    keyed.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.0.cmp(&b.0)));
    for (_, v) in keyed.iter_mut() {
        v.sort_by_key(|(c, tf)| (cost(*tf), *c));
    }
    let outs: Vec<Vec<char>> = keyed.iter().map(|k| k.0.clone()).collect();
    let cands: Vec<Vec<(usize, Tf)>> = keyed.into_iter().map(|k| k.1).collect();
    let mut found = Vec::new();
    let mut budget = 300_000;
    search(&target, 0, &outs, &mut Vec::new(), &mut found, &mut budget);
    let mut scored: Vec<(usize, Vec<Seg>)> = found
        .into_iter()
        .map(|segs| {
            let s: usize = segs
                .iter()
                .map(|g| match g {
                    Seg::Lit(l) => l.chars().count() * 8 + 3,
                    Seg::Out(i) => cands[*i].first().map_or(9, |c| cost(c.1)),
                })
                .sum();
            (s, segs)
        })
        .collect();
    scored.sort_by_key(|s| s.0);
    let init: Vec<usize> = vec![0; examples.len()];
    let exs: Vec<Example> = examples.iter().map(|(s, o)| (s.clone(), o.chars().collect())).collect();
    let mut tries = 0;
    for (_, segs) in scored {
        tries += 1;
        if tries > 200 {
            break;
        }
        let mut picks = Vec::new();
        let mut work = 20_000;
        if resolve(&segs, 0, &cands, &exs, &init, &mut picks, &mut work) {
            let steps = segs
                .iter()
                .zip(picks)
                .map(|(g, p)| match (g, p) {
                    (Seg::Lit(l), _) => (None, l.clone()),
                    (_, Pick::Atom(c, tf)) => (Some((c, tf)), String::new()),
                    _ => (None, String::new()),
                })
                .collect();
            return Some(Program { steps });
        }
    }
    None
}
