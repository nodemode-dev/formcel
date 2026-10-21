use super::*;

const ELEMENTWISE: [&str; 109] = [
    "ACOS", "ACOSH", "ACOT", "ACOTH", "ARABIC", "ASIN", "ASINH", "ATAN", "ATAN2", "ATANH", "BASE", "BETA.DIST", "BETA.INV", "BINOM.DIST", "BINOM.INV", "CEILING", "CEILING.MATH", "CEILING.PRECISE", "CHISQ.DIST",
    "CHISQ.DIST.RT", "CHISQ.INV", "CHISQ.INV.RT", "COMBIN", "COMBINA", "CONFIDENCE.NORM", "CONFIDENCE.T", "COS", "COSH", "COT", "COTH", "CSC", "CSCH", "DB", "DDB", "DECIMAL", "DEGREES", "DOLLARDE", "DOLLARFR",
    "EFFECT", "EVEN", "EXP", "EXPON.DIST", "F.DIST", "F.DIST.RT", "F.INV", "F.INV.RT", "FACT", "FACTDOUBLE", "FISHER", "FISHERINV", "FLOOR", "FLOOR.MATH", "FLOOR.PRECISE", "FV", "GAMMA", "GAMMA.DIST", "GAMMA.INV",
    "GAMMALN", "GAMMALN.PRECISE", "GAUSS", "IPMT", "ISPMT", "LN", "LOG", "LOG10", "LOGNORM.DIST", "LOGNORM.INV", "MROUND", "NOMINAL", "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "NORMDIST", "NORMINV",
    "NORMSDIST", "NORMSINV", "NPER", "ODD", "PDURATION", "PERMUT", "PERMUTATIONA", "PHI", "PMT", "POISSON.DIST", "PPMT", "PV", "QUOTIENT", "RADIANS", "ROMAN", "RRI", "SEC", "SECH", "SIGN", "SIN", "SINH", "SLN",
    "SQRTPI", "STANDARDIZE", "SYD", "T.DIST", "T.DIST.2T", "T.DIST.RT", "T.INV", "T.INV.2T", "TAN", "TANH", "TRUNC", "WEIBULL.DIST",
];

const ARRAYS: [&str; 6] = ["FREQUENCY", "MMULT", "MINVERSE", "MODE.MULT", "MUNIT", "RANDARRAY"];

pub(super) fn routed(name: &str) -> bool {
    ARRAYS.contains(&name) || ELEMENTWISE.binary_search(&name).is_ok()
}

fn literal(v: &Value) -> Expr {
    match v {
        Value::Number(n) => Expr::Num(*n),
        Value::Text(s) => Expr::Str(s.clone()),
        Value::Bool(b) => Expr::Bool(*b),
        Value::Error(k) => Expr::Err(*k),
        Value::Empty => Expr::Num(0.0),
    }
}

impl Eval<'_> {
    pub(super) fn call_fx(&self, name: &str, a: &[Expr]) -> Result<Value, ErrKind> {
        if let Some(r) = self.fin(name, a).or_else(|| self.math(name, a)).or_else(|| self.stat(name, a)).or_else(|| self.db(name, a)) {
            return r;
        }
        Err(ErrKind::Name)
    }

    pub(super) fn call_fx_arg(&self, name: &str, a: &[Expr]) -> Result<Arg, ErrKind> {
        if let Some(r) = self.math_arr(name, a).or_else(|| self.stat_arr(name, a)) {
            return r;
        }
        let mut slots: Vec<Result<Array, Expr>> = Vec::with_capacity(a.len());
        for e in a {
            if matches!(e, Expr::Missing) {
                slots.push(Err(Expr::Missing));
                continue;
            }
            let x = self.arg(e);
            if multi(&x) {
                slots.push(Ok(self.grid(x)?));
            } else {
                slots.push(Err(literal(&self.deref(x))));
            }
        }
        let shape = slots.iter().filter_map(|s| s.as_ref().ok()).fold((1usize, 1usize), |(r, c), g| (r.max(g.rows), c.max(g.cols)));
        if slots.iter().all(Result::is_err) {
            let lits: Vec<Expr> = slots.into_iter().map(|s| s.err().unwrap_or(Expr::Missing)).collect();
            return Ok(Arg::V(self.call_fx(name, &lits).unwrap_or_else(err)));
        }
        if (shape.0 as u64) * (shape.1 as u64) > MAX_ARRAY {
            return Err(ErrKind::Value);
        }
        let mut data = Vec::with_capacity(shape.0 * shape.1);
        for r in 0..shape.0 {
            for c in 0..shape.1 {
                let lits: Vec<Expr> = slots.iter().map(|s| match s {
                    Ok(g) => literal(&g.pick(r, c)),
                    Err(e) => e.clone(),
                }).collect();
                data.push(self.call_fx(name, &lits).unwrap_or_else(err));
            }
        }
        Ok(Arg::A(Array { rows: shape.0, cols: shape.1, data }))
    }
}
