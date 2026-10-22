use crate::{col_name, MAX_COLS, MAX_ROWS};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ErrKind {
    Div0,
    Value,
    Ref,
    Name,
    Na,
    Num,
    Null,
    Error,
    Spill,
    Calc,
    Field,
}

impl ErrKind {
    pub fn text(self) -> &'static str {
        match self {
            ErrKind::Div0 => "#DIV/0!",
            ErrKind::Value => "#VALUE!",
            ErrKind::Ref => "#REF!",
            ErrKind::Name => "#NAME?",
            ErrKind::Na => "#N/A",
            ErrKind::Num => "#NUM!",
            ErrKind::Null => "#NULL!",
            ErrKind::Error => "#ERROR!",
            ErrKind::Spill => "#SPILL!",
            ErrKind::Calc => "#CALC!",
            ErrKind::Field => "#FIELD!",
        }
    }

    pub fn parse(s: &str) -> Option<ErrKind> {
        [ErrKind::Div0, ErrKind::Value, ErrKind::Ref, ErrKind::Name, ErrKind::Na, ErrKind::Num, ErrKind::Null, ErrKind::Error, ErrKind::Spill, ErrKind::Calc, ErrKind::Field]
            .into_iter()
            .find(|e| e.text().eq_ignore_ascii_case(s))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellRef {
    pub row: u32,
    pub col: u32,
    pub abs_row: bool,
    pub abs_col: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefKind {
    Cell(CellRef),
    Area(CellRef, CellRef),
    Cols(u32, bool, u32, bool),
    Rows(u32, bool, u32, bool),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Area {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
}

impl Area {
    pub fn contains(&self, row: u32, col: u32) -> bool {
        row >= self.r0 && row <= self.r1 && col >= self.c0 && col <= self.c1
    }
}

impl RefKind {
    pub fn area(&self) -> Area {
        match *self {
            RefKind::Cell(c) => Area { r0: c.row, c0: c.col, r1: c.row, c1: c.col },
            RefKind::Area(a, b) => Area { r0: a.row.min(b.row), c0: a.col.min(b.col), r1: a.row.max(b.row), c1: a.col.max(b.col) },
            RefKind::Cols(a, _, b, _) => Area { r0: 0, c0: a.min(b), r1: MAX_ROWS - 1, c1: a.max(b) },
            RefKind::Rows(a, _, b, _) => Area { r0: a.min(b), c0: 0, r1: a.max(b), c1: MAX_COLS - 1 },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Cat,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

impl Op {
    fn text(self) -> &'static str {
        match self {
            Op::Add => "+",
            Op::Sub => "-",
            Op::Mul => "*",
            Op::Div => "/",
            Op::Pow => "^",
            Op::Cat => "&",
            Op::Eq => "=",
            Op::Ne => "<>",
            Op::Lt => "<",
            Op::Le => "<=",
            Op::Gt => ">",
            Op::Ge => ">=",
        }
    }

    fn prec(self) -> u8 {
        match self {
            Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => 1,
            Op::Cat => 2,
            Op::Add | Op::Sub => 3,
            Op::Mul | Op::Div => 4,
            Op::Pow => 5,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    Num(f64),
    Str(String),
    Bool(bool),
    Err(ErrKind),
    Missing,
    Ref(Option<String>, RefKind),
    Name(String),
    Neg(Box<Expr>),
    Pos(Box<Expr>),
    Pct(Box<Expr>),
    Bin(Op, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
    Paren(Box<Expr>),
    Array(Vec<Vec<Expr>>),
    Range(Box<Expr>, Box<Expr>),
    Intersect(Box<Expr>, Box<Expr>),
    Union(Vec<Expr>),
    Invoke(Box<Expr>, Vec<Expr>),
    Spill(Box<Expr>),
    Single(Box<Expr>),
    Table(Option<String>, TableSpec),
}

pub const ITEM_ALL: u8 = 1;
pub const ITEM_DATA: u8 = 2;
pub const ITEM_HEADERS: u8 = 4;
pub const ITEM_TOTALS: u8 = 8;
pub const ITEM_THIS: u8 = 16;
const ITEMS: [(&str, u8); 5] = [("#All", ITEM_ALL), ("#Headers", ITEM_HEADERS), ("#Data", ITEM_DATA), ("#Totals", ITEM_TOTALS), ("#This Row", ITEM_THIS)];

#[derive(Clone, Debug, PartialEq)]
pub struct TableSpec {
    pub items: u8,
    pub cols: Option<(String, String)>,
    pub long: bool,
    pub fixed: bool,
}

fn unquote_col(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.trim().chars();
    while let Some(c) = it.next() {
        if c == '\'' {
            if let Some(n) = it.next() {
                out.push(n);
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn groups(s: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    let mut depth = 0;
    let mut cur = String::new();
    let mut it = s.chars();
    while let Some(c) = it.next() {
        match c {
            '\'' => {
                cur.push(c);
                cur.push(it.next()?);
            }
            '[' => {
                depth += 1;
                cur.push(c);
            }
            ']' => {
                depth -= 1;
                cur.push(c);
            }
            ',' if depth == 0 => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    (depth == 0).then(|| {
        out.push(cur);
        out.into_iter().map(|g| g.trim().to_string()).filter(|g| !g.is_empty()).collect()
    })
}

fn bracketed(s: &str) -> Option<&str> {
    s.strip_prefix('[')?.strip_suffix(']')
}

fn col_range(s: &str) -> Option<(String, String, bool)> {
    let s = s.trim();
    let Some(inner) = bracketed(s) else { return Some((unquote_col(s), unquote_col(s), false)) };
    let mut depth = 0;
    let mut quoted = false;
    for (i, c) in s.char_indices() {
        if quoted {
            quoted = false;
            continue;
        }
        match c {
            '\'' => quoted = true,
            '[' => depth += 1,
            ']' => depth -= 1,
            ':' if depth == 0 => {
                let a = bracketed(s[..i].trim())?;
                let b = bracketed(s[i + 1..].trim())?;
                return Some((unquote_col(a), unquote_col(b), true));
            }
            _ => {}
        }
    }
    Some((unquote_col(inner), unquote_col(inner), false))
}

pub fn parse_spec(raw: &str) -> Option<TableSpec> {
    let raw = raw.trim();
    if let Some(rest) = raw.strip_prefix('@') {
        let rest = rest.trim();
        let (cols, fixed) = if rest.is_empty() {
            (None, false)
        } else {
            let (a, b, f) = col_range(rest)?;
            (Some((a, b)), f)
        };
        return Some(TableSpec { items: ITEM_THIS, cols, long: false, fixed });
    }
    if !raw.contains('[') {
        if raw.starts_with('#') {
            let item = ITEMS.iter().find(|(n, _)| n.eq_ignore_ascii_case(raw))?.1;
            return Some(TableSpec { items: item, cols: None, long: false, fixed: false });
        }
        let c = unquote_col(raw);
        return Some(TableSpec { items: 0, cols: Some((c.clone(), c)), long: false, fixed: false });
    }
    let mut spec = TableSpec { items: 0, cols: None, long: false, fixed: false };
    for g in groups(raw)? {
        let inner = bracketed(&g).map(str::trim);
        if let Some(item) = inner.and_then(|i| ITEMS.iter().find(|(n, _)| n.eq_ignore_ascii_case(i))) {
            spec.items |= item.1;
        } else if spec.cols.is_none() {
            let (a, b, f) = col_range(&g)?;
            spec.cols = Some((a, b));
            spec.fixed = f;
        } else {
            return None;
        }
    }
    if spec.items & ITEM_THIS != 0 && spec.items != ITEM_THIS {
        return None;
    }
    Some(spec)
}

fn escape_col(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if matches!(c, '[' | ']' | '#' | '\'' | '@') {
            out.push('\'');
        }
        out.push(c);
    }
    out
}

fn plain_col(s: &str) -> bool {
    s.chars().all(|c| c.is_alphanumeric() || c == ' ') && !s.starts_with(' ') && !s.ends_with(' ')
}

fn print_cols(cols: &(String, String), fixed: bool, out: &mut String) {
    out.push('[');
    out.push_str(&escape_col(&cols.0));
    out.push(']');
    if cols.0 != cols.1 || fixed {
        out.push_str(":[");
        out.push_str(&escape_col(&cols.1));
        out.push(']');
    }
}

pub fn print_spec(spec: &TableSpec, out: &mut String) {
    let single = spec.cols.as_ref().filter(|c| c.0 == c.1 && !spec.fixed);
    if spec.items == ITEM_THIS && !spec.long {
        out.push_str("[@");
        match (&spec.cols, single) {
            (None, _) => {}
            (Some(_), Some(c)) if plain_col(&c.0) && !c.0.contains(' ') => out.push_str(&escape_col(&c.0)),
            (Some(c), _) => print_cols(c, spec.fixed, out),
        }
        out.push(']');
        return;
    }
    if spec.items == 0 {
        match (&spec.cols, single) {
            (None, _) => {}
            (Some(_), Some(c)) if plain_col(&c.0) => {
                out.push('[');
                out.push_str(&escape_col(&c.0));
                out.push(']');
            }
            (Some(c), _) => {
                out.push('[');
                print_cols(c, spec.fixed, out);
                out.push(']');
            }
        }
        return;
    }
    let names: Vec<&str> = ITEMS.iter().filter(|(_, b)| spec.items & b != 0).map(|(n, _)| *n).collect();
    if names.len() == 1 && spec.cols.is_none() {
        out.push('[');
        out.push_str(names[0]);
        out.push(']');
        return;
    }
    out.push('[');
    for (i, n) in names.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('[');
        out.push_str(n);
        out.push(']');
    }
    if let Some(c) = &spec.cols {
        out.push(',');
        print_cols(c, spec.fixed, out);
    }
    out.push(']');
}

pub fn tables_in(e: &Expr, f: &mut dyn FnMut(Option<&str>, &TableSpec)) {
    match e {
        Expr::Table(n, s) => f(n.as_deref(), s),
        o => {
            for c in children(o) {
                tables_in(c, f);
            }
        }
    }
}

pub fn has_table(e: &Expr) -> bool {
    let mut any = false;
    tables_in(e, &mut |_, _| any = true);
    any
}

pub const FUNCTIONS: [&str; 431] = [
    "ABS", "ACOS", "ACOSH", "ACOT", "ACOTH", "ADDRESS", "AGGREGATE", "AI", "AND", "ARABIC", "AREAS", "ARRAYFORMULA", "ARRAYTOTEXT", "ASIN", "ASINH", "ATAN", "ATAN2", "ATANH",
    "AVEDEV", "AVERAGE", "AVERAGEA", "AVERAGEIF", "AVERAGEIFS", "BASE", "BESSELJ", "BETA.DIST", "BETA.INV", "BIN2DEC", "BIN2HEX", "BIN2OCT", "BINOM.DIST", "BINOM.INV", "BITAND", "BITLSHIFT", "BITOR", "BITRSHIFT",
    "BITXOR", "BYCOL", "BYROW", "CEILING", "CEILING.MATH", "CEILING.PRECISE", "CELL", "CHAR", "CHISQ.DIST", "CHISQ.DIST.RT", "CHISQ.INV", "CHISQ.INV.RT", "CHISQ.TEST", "CHOOSE", "CHOOSECOLS", "CHOOSEROWS", "CLEAN", "CODE",
    "COLUMN", "COLUMNS", "COMBIN", "COMBINA", "COMPLEX", "CONCAT", "CONCATENATE", "CONFIDENCE.NORM", "CONFIDENCE.T", "CONVERT", "CORREL", "COS", "COSH", "COT", "COTH", "COUNT", "COUNTA", "COUNTBLANK",
    "COUNTIF", "COUNTIFS", "COVAR", "COVARIANCE.P", "COVARIANCE.S", "CSC", "CSCH", "CUMIPMT", "CUMPRINC", "DATE", "DATEDIF", "DATEVALUE", "DAVERAGE", "DAY", "DAYS", "DAYS360", "DB", "DCOUNT",
    "DCOUNTA", "DDB", "DEC2BIN", "DEC2HEX", "DEC2OCT", "DECIMAL", "DEGREES", "DELTA", "DEVSQ", "DGET", "DMAX", "DMIN", "DOLLAR", "DOLLARDE", "DOLLARFR", "DPRODUCT", "DROP", "DSTDEV",
    "DSTDEVP", "DSUM", "DVAR", "DVARP", "EDATE", "EFFECT", "EOMONTH", "EPOCHTODATE", "ERF", "ERF.PRECISE", "ERFC", "ERFC.PRECISE", "ERROR.TYPE", "EVEN", "EXACT", "EXP", "EXPAND", "EXPON.DIST",
    "F.DIST", "F.DIST.RT", "F.INV", "F.INV.RT", "F.TEST", "FACT", "FACTDOUBLE", "FALSE", "FIELDVALUE", "FILTER", "FILTERXML", "FIND", "FISHER", "FISHERINV", "FIXED", "FLOOR", "FLOOR.MATH", "FLOOR.PRECISE", "FORECAST",
    "FORECAST.ETS", "FORECAST.ETS.CONFINT", "FORECAST.ETS.SEASONALITY", "FORECAST.ETS.STAT", "FORECAST.LINEAR", "FORMULATEXT", "FREQUENCY", "FV", "FVSCHEDULE", "GAMMA", "GAMMA.DIST", "GAMMA.INV", "GAMMALN", "GAMMALN.PRECISE", "GAUSS", "GCD", "GEOMEAN", "GESTEP",
    "GOOGLEFINANCE", "GROUPBY", "HARMEAN", "HEX2BIN", "HEX2DEC", "HEX2OCT", "HLOOKUP", "HOUR", "HSTACK", "HYPERLINK", "IF", "IFERROR", "IFNA", "IFS", "IMABS", "IMAGE", "IMAGINARY", "IMDIV", "IMPORTDATA", "IMPORTFEED", "IMPORTHTML",
    "IMPORTRANGE", "IMPORTXML", "IMPRODUCT", "IMREAL", "IMSUB", "IMSUM", "INDEX", "INDIRECT", "INFO", "INT", "INTERCEPT", "IPMT", "IRR", "ISBETWEEN", "ISBLANK", "ISDATE", "ISEMAIL", "ISERR", "ISERROR", "ISEVEN", "ISFORMULA",
    "ISLOGICAL", "ISNA", "ISNONTEXT", "ISNUMBER", "ISODD", "ISOMITTED", "ISOWEEKNUM", "ISPMT", "ISREF", "ISTEXT", "ISURL", "KURT", "LAMBDA", "LARGE", "LCM", "LEFT", "LEN", "LET", "LINEST", "LN",
    "LOG", "LOG10", "LOGNORM.DIST", "LOGNORM.INV", "LOOKUP", "LOWER", "MAKEARRAY", "MAP", "MATCH", "MAX", "MAXA", "MAXIFS", "MDETERM", "MEDIAN", "MID", "MIN", "MINA", "MINIFS",
    "MINUTE", "MINVERSE", "MIRR", "MMULT", "MOD", "MODE", "MODE.MULT", "MODE.SNGL", "MONTH", "MROUND", "MULTINOMIAL", "MUNIT", "N", "NA", "NETWORKDAYS", "NETWORKDAYS.INTL", "NOMINAL", "NORM.DIST",
    "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "NORMDIST", "NORMINV", "NORMSDIST", "NORMSINV", "NOT", "NOW", "NPER", "NPV", "NUMBERVALUE", "OCT2BIN", "OCT2DEC", "OCT2HEX", "ODD", "OFFSET", "OR",
    "PDURATION", "PEARSON", "PERCENTILE", "PERCENTILE.EXC", "PERCENTILE.INC", "PERCENTOF", "PERCENTRANK", "PERCENTRANK.EXC", "PERCENTRANK.INC", "PERMUT", "PERMUTATIONA", "PHI", "PI", "PIVOTBY", "PMT", "POISSON.DIST", "POWER", "PPMT",
    "PROB", "PRODUCT", "PROPER", "PV", "QUARTILE", "QUARTILE.EXC", "QUARTILE.INC", "QUERY", "QUOTIENT", "RADIANS", "RAND", "RANDARRAY", "RANDBETWEEN", "RANK", "RANK.AVG", "RANK.EQ", "RATE", "REDUCE",
    "REGEXEXTRACT", "REGEXMATCH", "REGEXREPLACE", "REGEXTEST", "REPLACE", "REPT", "RIGHT", "ROMAN", "ROUND", "ROUNDDOWN", "ROUNDUP", "ROW", "ROWS", "RRI", "RSQ", "SCAN", "SEARCH", "SEC",
    "SECH", "SECOND", "SEQUENCE", "SERIESSUM", "SHEET", "SHEETS", "SIGN", "SIN", "SINH", "SKEW", "SKEW.P", "SLN", "SLOPE", "SMALL", "SORT", "SORTBY", "SORTN", "SPARKLINE",
    "SPLIT", "SQRT", "SQRTPI", "STANDARDIZE", "STDEV", "STDEV.P", "STDEV.S", "STDEVA", "STDEVPA", "STEYX", "STOCKHISTORY", "SUBSTITUTE", "SUBTOTAL", "SUM", "SUMIF", "SUMIFS", "SUMPRODUCT", "SUMSQ", "SUMX2MY2",
    "SUMX2PY2", "SUMXMY2", "SWITCH", "SYD", "T", "T.DIST", "T.DIST.2T", "T.DIST.RT", "T.INV", "T.INV.2T", "T.TEST", "TAKE", "TAN", "TANH", "TEXT", "TEXTAFTER", "TEXTBEFORE", "TEXTJOIN",
    "TEXTSPLIT", "TIME", "TIMEVALUE", "TOCOL", "TODAY", "TOROW", "TRANSPOSE", "TREND", "TRIM", "TRIMMEAN", "TRUE", "TRUNC", "TYPE", "UNICHAR", "UNICODE", "UNIQUE", "UPPER", "VALUE",
    "VALUETOTEXT", "VAR", "VAR.P", "VAR.S", "VARA", "VARPA", "VDB", "VLOOKUP", "VSTACK", "WEBSERVICE", "WEEKDAY", "WEEKNUM", "WEIBULL.DIST", "WORKDAY", "WORKDAY.INTL", "WRAPCOLS", "WRAPROWS", "XIRR",
    "XLOOKUP", "XMATCH", "XNPV", "XOR", "YEAR", "YEARFRAC", "Z.TEST",
];

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Space,
    Num(f64),
    Str(String),
    Ident(String),
    Quoted(String),
    Err(ErrKind),
    Bang,
    Colon,
    Comma,
    LParen,
    RParen,
    Op(Op),
    Plus,
    Minus,
    Pct,
    LBrace,
    RBrace,
    Semi,
    Hash,
    At,
    Bracket(String),
}

fn lex(src: &str) -> Option<Vec<Tok>> {
    let s: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < s.len() {
        let c = s[i];
        if c.is_whitespace() {
            let mut j = i;
            while j < s.len() && s[j].is_whitespace() {
                j += 1;
            }
            let ends = match out.last() {
                Some(Tok::Ident(_) | Tok::Bracket(_) | Tok::Hash) => true,
                Some(Tok::RParen) => true,
                _ => false,
            };
            let starts = match s.get(j) {
                Some('(') => !matches!(out.last(), Some(Tok::Ident(_))),
                Some(n) => n.is_alphabetic() || matches!(n, '_' | '$' | '\'' | '['),
                None => false,
            };
            if ends && starts {
                out.push(Tok::Space);
            }
            i = j;
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && s.get(i + 1).is_some_and(|d| d.is_ascii_digit())) {
            let st = i;
            while i < s.len() && (s[i].is_ascii_digit() || s[i] == '.') {
                i += 1;
            }
            if i < s.len() && (s[i] == 'e' || s[i] == 'E') {
                let mut j = i + 1;
                if j < s.len() && (s[j] == '+' || s[j] == '-') {
                    j += 1;
                }
                if j < s.len() && s[j].is_ascii_digit() {
                    i = j;
                    while i < s.len() && s[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            let t: String = s[st..i].iter().collect();
            if i < s.len() && (s[i].is_ascii_alphabetic() || s[i] == '$') {
                while i < s.len() && (s[i].is_alphanumeric() || s[i] == '_' || s[i] == '.' || s[i] == '$') {
                    i += 1;
                }
                out.push(Tok::Ident(s[st..i].iter().collect()));
                continue;
            }
            out.push(Tok::Num(t.parse().ok()?));
            continue;
        }
        if c.is_alphabetic() || c == '_' || c == '$' || c == '\\' {
            let st = i;
            while i < s.len() && (s[i].is_alphanumeric() || s[i] == '_' || s[i] == '.' || s[i] == '$' || s[i] == '\\') {
                i += 1;
            }
            out.push(Tok::Ident(s[st..i].iter().collect()));
            continue;
        }
        if c == '[' {
            let mut depth = 1;
            let mut t = String::new();
            i += 1;
            while depth > 0 {
                let ch = *s.get(i)?;
                i += 1;
                match ch {
                    '\'' => {
                        t.push(ch);
                        t.push(*s.get(i)?);
                        i += 1;
                        continue;
                    }
                    '[' => depth += 1,
                    ']' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
                t.push(ch);
            }
            out.push(Tok::Bracket(t));
            continue;
        }
        match c {
            '"' | '\'' => {
                let q = c;
                let mut t = String::new();
                i += 1;
                loop {
                    if i >= s.len() {
                        return None;
                    }
                    if s[i] == q {
                        if s.get(i + 1) == Some(&q) {
                            t.push(q);
                            i += 2;
                            continue;
                        }
                        i += 1;
                        break;
                    }
                    t.push(s[i]);
                    i += 1;
                }
                out.push(if q == '"' { Tok::Str(t) } else { Tok::Quoted(t) });
                continue;
            }
            '#' if matches!(out.last(), Some(Tok::Ident(_))) && !s.get(i + 1).is_some_and(|d| d.is_ascii_alphanumeric() || *d == '/') => {
                out.push(Tok::Hash);
                i += 1;
                continue;
            }
            '#' => {
                let st = i;
                i += 1;
                while i < s.len() && (s[i].is_ascii_alphanumeric() || s[i] == '/') {
                    i += 1;
                }
                if i < s.len() && (s[i] == '!' || s[i] == '?') {
                    i += 1;
                }
                let t: String = s[st..i].iter().collect();
                out.push(Tok::Err(ErrKind::parse(&t)?));
                continue;
            }
            '<' => {
                let n = s.get(i + 1).copied();
                let (op, w) = match n {
                    Some('=') => (Op::Le, 2),
                    Some('>') => (Op::Ne, 2),
                    _ => (Op::Lt, 1),
                };
                out.push(Tok::Op(op));
                i += w;
                continue;
            }
            '>' => {
                let ge = s.get(i + 1) == Some(&'=');
                out.push(Tok::Op(if ge { Op::Ge } else { Op::Gt }));
                i += if ge { 2 } else { 1 };
                continue;
            }
            _ => {}
        }
        let t = match c {
            '!' => Tok::Bang,
            ':' => Tok::Colon,
            ',' => Tok::Comma,
            '(' => Tok::LParen,
            ')' => Tok::RParen,
            '+' => Tok::Plus,
            '-' => Tok::Minus,
            '%' => Tok::Pct,
            '@' => Tok::At,
            '{' => Tok::LBrace,
            '}' => Tok::RBrace,
            ';' => Tok::Semi,
            '*' => Tok::Op(Op::Mul),
            '/' => Tok::Op(Op::Div),
            '^' => Tok::Op(Op::Pow),
            '&' => Tok::Op(Op::Cat),
            '=' => Tok::Op(Op::Eq),
            _ => return None,
        };
        out.push(t);
        i += 1;
    }
    Some(out)
}

fn parse_col_part(s: &str) -> Option<(u32, bool)> {
    let (abs, rest) = s.strip_prefix('$').map_or((false, s), |r| (true, r));
    if rest.is_empty() || rest.len() > 3 || !rest.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let mut col: u32 = 0;
    for b in rest.to_ascii_uppercase().bytes() {
        col = col * 26 + u32::from(b - b'A' + 1);
    }
    (1..=MAX_COLS).contains(&col).then_some((col - 1, abs))
}

fn parse_row_part(s: &str) -> Option<(u32, bool)> {
    let (abs, rest) = s.strip_prefix('$').map_or((false, s), |r| (true, r));
    if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let row: u64 = rest.parse().ok()?;
    (row >= 1 && row <= u64::from(MAX_ROWS)).then_some(((row - 1) as u32, abs))
}

fn parse_cell(s: &str) -> Option<CellRef> {
    let b = s.as_bytes();
    let mut k = usize::from(b.first() == Some(&b'$'));
    while k < b.len() && b[k].is_ascii_alphabetic() {
        k += 1;
    }
    let (c, abs_col) = parse_col_part(&s[..k])?;
    let (r, abs_row) = parse_row_part(&s[k..])?;
    Some(CellRef { row: r, col: c, abs_row, abs_col })
}

struct Parser {
    t: Vec<Tok>,
    i: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.t.get(self.i)
    }

    fn peek_at(&self, k: usize) -> Option<&Tok> {
        self.t.get(self.i + k)
    }

    fn next(&mut self) -> Option<Tok> {
        let t = self.t.get(self.i).cloned();
        self.i += 1;
        t
    }

    fn expr(&mut self, min: u8) -> Option<Expr> {
        let mut left = self.unary()?;
        loop {
            let op = match self.peek() {
                Some(Tok::Op(o)) => *o,
                Some(Tok::Plus) => Op::Add,
                Some(Tok::Minus) => Op::Sub,
                _ => break,
            };
            let p = op.prec();
            if p < min {
                break;
            }
            self.i += 1;
            let right = self.expr(p + 1)?;
            left = Expr::Bin(op, Box::new(left), Box::new(right));
        }
        Some(left)
    }

    fn unary(&mut self) -> Option<Expr> {
        match self.peek() {
            Some(Tok::Minus) => {
                self.i += 1;
                Some(Expr::Neg(Box::new(self.unary()?)))
            }
            Some(Tok::Plus) => {
                self.i += 1;
                Some(Expr::Pos(Box::new(self.unary()?)))
            }
            Some(Tok::At) => {
                self.i += 1;
                Some(Expr::Single(Box::new(self.unary()?)))
            }
            _ => {
                let mut e = self.operand()?;
                while self.peek() == Some(&Tok::Space) {
                    self.i += 1;
                    let right = self.operand()?;
                    e = Expr::Intersect(Box::new(e), Box::new(right));
                }
                while self.peek() == Some(&Tok::Pct) {
                    self.i += 1;
                    e = Expr::Pct(Box::new(e));
                }
                Some(e)
            }
        }
    }

    fn operand(&mut self) -> Option<Expr> {
        let mut e = self.primary()?;
        while self.peek() == Some(&Tok::Colon) {
            self.i += 1;
            let right = self.primary()?;
            e = Expr::Range(Box::new(e), Box::new(right));
        }
        if self.peek() == Some(&Tok::Hash) {
            if !matches!(e, Expr::Ref(_, RefKind::Cell(_))) {
                return None;
            }
            self.i += 1;
            e = Expr::Spill(Box::new(e));
        }
        Some(e)
    }

    fn reference(&mut self, sheet: Option<String>, first: &str) -> Option<Expr> {
        let colon_next = self.peek() == Some(&Tok::Colon);
        if let Some(a) = parse_cell(first) {
            if colon_next {
                if let Some(Tok::Ident(second)) = self.peek_at(1) {
                    if let Some(b) = parse_cell(second) {
                        self.i += 2;
                        return Some(Expr::Ref(sheet, RefKind::Area(a, b)));
                    }
                }
            }
            return Some(Expr::Ref(sheet, RefKind::Cell(a)));
        }
        if colon_next {
            let second = match self.peek_at(1) {
                Some(Tok::Ident(s)) => s.clone(),
                Some(Tok::Num(n)) if n.fract() == 0.0 => format!("{}", *n as u64),
                _ => return None,
            };
            if let (Some((a, aa)), Some((b, ab))) = (parse_col_part(first), parse_col_part(&second)) {
                self.i += 2;
                return Some(Expr::Ref(sheet, RefKind::Cols(a, aa, b, ab)));
            }
            if let (Some((a, aa)), Some((b, ab))) = (parse_row_part(first), parse_row_part(&second)) {
                self.i += 2;
                return Some(Expr::Ref(sheet, RefKind::Rows(a, aa, b, ab)));
            }
        }
        None
    }

    fn fields(&mut self, sheet: Option<String>, id: &str) -> Option<Expr> {
        let (head, tail) = id.split_once('.')?;
        let cell = parse_cell(head)?;
        if self.peek() == Some(&Tok::LParen) {
            return None;
        }
        let mut e = Expr::Ref(sheet, RefKind::Cell(cell));
        for seg in tail.split('.').filter(|s| !s.is_empty()) {
            e = Expr::Call("_FV".to_string(), vec![e, Expr::Str(seg.to_string())]);
        }
        if tail.is_empty() || tail.ends_with('.') {
            let Some(Tok::Bracket(b)) = self.peek().cloned() else { return None };
            self.i += 1;
            e = Expr::Call("_FV".to_string(), vec![e, Expr::Str(b)]);
        }
        Some(e)
    }

    fn primary(&mut self) -> Option<Expr> {
        match self.next()? {
            Tok::Num(n) => {
                if n.fract() == 0.0 && self.peek() == Some(&Tok::Colon) {
                    if let Some(e) = self.reference(None, &format!("{}", n as u64)) {
                        return Some(e);
                    }
                }
                Some(Expr::Num(n))
            }
            Tok::Str(s) => Some(Expr::Str(s)),
            Tok::Err(e) => Some(Expr::Err(e)),
            Tok::LParen => {
                let e = self.expr(0)?;
                if self.peek() == Some(&Tok::Comma) {
                    let mut parts = vec![e];
                    while self.peek() == Some(&Tok::Comma) {
                        self.i += 1;
                        parts.push(self.expr(0)?);
                    }
                    return (self.next()? == Tok::RParen).then_some(Expr::Union(parts));
                }
                (self.next()? == Tok::RParen).then(|| Expr::Paren(Box::new(e)))
            }
            Tok::LBrace => {
                let mut rows = vec![Vec::new()];
                loop {
                    rows.last_mut()?.push(self.expr(0)?);
                    match self.next()? {
                        Tok::Comma => {}
                        Tok::Semi => rows.push(Vec::new()),
                        Tok::RBrace => break,
                        _ => return None,
                    }
                }
                let w = rows[0].len();
                rows.iter().all(|r| r.len() == w).then_some(Expr::Array(rows))
            }
            Tok::Quoted(name) => {
                if self.next()? != Tok::Bang {
                    return None;
                }
                self.sheet_ref(name)
            }
            Tok::Bracket(raw) => {
                if let (Some(Tok::Ident(sh)), Some(Tok::Bang)) = (self.peek().cloned(), self.peek_at(1)) {
                    self.i += 2;
                    return self.sheet_ref(format!("[{raw}]{sh}"));
                }
                Some(Expr::Table(None, parse_spec(&raw)?))
            }
            Tok::Ident(id) => {
                if let Some(e) = self.fields(None, &id) {
                    return Some(e);
                }
                if let Some(Tok::Bracket(raw)) = self.peek() {
                    let spec = parse_spec(&raw.clone())?;
                    self.i += 1;
                    return Some(Expr::Table(Some(id), spec));
                }
                if self.peek() == Some(&Tok::Bang) {
                    self.i += 1;
                    return self.sheet_ref(id);
                }
                if self.peek() == Some(&Tok::LParen) {
                    let up = id.to_ascii_uppercase();
                    let name = if FUNCTIONS.contains(&up.as_str()) { up } else { id };
                    let mut e = Expr::Call(name, self.args()?);
                    while self.peek() == Some(&Tok::LParen) {
                        e = Expr::Invoke(Box::new(e), self.args()?);
                    }
                    return Some(e);
                }
                match id.to_ascii_uppercase().as_str() {
                    "TRUE" => return Some(Expr::Bool(true)),
                    "FALSE" => return Some(Expr::Bool(false)),
                    _ => {}
                }
                if let Some(e) = self.reference(None, &id) {
                    return Some(e);
                }
                Some(Expr::Name(id))
            }
            _ => None,
        }
    }

    fn args(&mut self) -> Option<Vec<Expr>> {
        self.i += 1;
        let mut args = Vec::new();
        if self.peek() == Some(&Tok::RParen) {
            self.i += 1;
            return Some(args);
        }
        loop {
            if matches!(self.peek(), Some(Tok::Comma) | Some(Tok::RParen)) {
                args.push(Expr::Missing);
            } else {
                args.push(self.expr(0)?);
            }
            match self.next()? {
                Tok::Comma => continue,
                Tok::RParen => return Some(args),
                _ => return None,
            }
        }
    }

    fn sheet_ref(&mut self, sheet: String) -> Option<Expr> {
        let first = match self.next()? {
            Tok::Ident(s) => s,
            Tok::Num(n) if n.fract() == 0.0 => format!("{}", n as u64),
            Tok::Err(ErrKind::Ref) => return Some(Expr::Err(ErrKind::Ref)),
            _ => return None,
        };
        if let Some(e) = self.fields(Some(sheet.clone()), &first) {
            return Some(e);
        }
        self.reference(Some(sheet), &first)
    }
}

pub fn parse(src: &str) -> Option<Expr> {
    let toks = lex(src)?;
    let mut p = Parser { t: toks, i: 0 };
    let e = p.expr(0)?;
    (p.i == p.t.len()).then_some(e)
}

fn num_text(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}

pub(crate) fn sheet_text(name: &str, out: &mut String) {
    let word = |n: &str| !n.is_empty() && n.chars().all(|c| c.is_alphanumeric() || c == '_') && !n.starts_with(|c: char| c.is_ascii_digit());
    let plain = word(name) || crate::xref::split(name).is_some_and(|(p, b, s)| p.is_empty() && word(s) && b.chars().all(|c| c.is_alphanumeric() || matches!(c, '.' | '_' | '-')));
    if plain {
        out.push_str(name);
    } else {
        out.push('\'');
        out.push_str(&name.replace('\'', "''"));
        out.push('\'');
    }
    out.push('!');
}

fn cell_text(c: CellRef, out: &mut String) {
    if c.abs_col {
        out.push('$');
    }
    out.push_str(&col_name(c.col));
    if c.abs_row {
        out.push('$');
    }
    out.push_str(&(c.row + 1).to_string());
}

pub fn print(e: &Expr, out: &mut String) {
    match e {
        Expr::Num(n) => out.push_str(&num_text(*n)),
        Expr::Str(s) => {
            out.push('"');
            out.push_str(&s.replace('"', "\"\""));
            out.push('"');
        }
        Expr::Bool(b) => out.push_str(if *b { "TRUE" } else { "FALSE" }),
        Expr::Err(k) => out.push_str(k.text()),
        Expr::Missing => {}
        Expr::Name(n) => out.push_str(n),
        Expr::Table(n, spec) => {
            if let Some(n) = n {
                out.push_str(n);
            }
            if n.is_none() && spec.items == 0 && spec.cols.is_none() {
                out.push_str("[#Data]");
            } else {
                print_spec(spec, out);
            }
        }
        Expr::Ref(sheet, k) => {
            if let Some(s) = sheet {
                sheet_text(s, out);
            }
            match *k {
                RefKind::Cell(c) => cell_text(c, out),
                RefKind::Area(a, b) => {
                    cell_text(a, out);
                    out.push(':');
                    cell_text(b, out);
                }
                RefKind::Cols(a, aa, b, ab) => {
                    out.push_str(if aa { "$" } else { "" });
                    out.push_str(&col_name(a));
                    out.push(':');
                    out.push_str(if ab { "$" } else { "" });
                    out.push_str(&col_name(b));
                }
                RefKind::Rows(a, aa, b, ab) => {
                    out.push_str(if aa { "$" } else { "" });
                    out.push_str(&(a + 1).to_string());
                    out.push(':');
                    out.push_str(if ab { "$" } else { "" });
                    out.push_str(&(b + 1).to_string());
                }
            }
        }
        Expr::Neg(x) => {
            out.push('-');
            print(x, out);
        }
        Expr::Pos(x) => {
            out.push('+');
            print(x, out);
        }
        Expr::Pct(x) => {
            print(x, out);
            out.push('%');
        }
        Expr::Spill(x) => {
            print(x, out);
            out.push('#');
        }
        Expr::Single(x) => {
            out.push('@');
            print(x, out);
        }
        Expr::Bin(op, a, b) => {
            print(a, out);
            out.push_str(op.text());
            print(b, out);
        }
        Expr::Call(name, args) if name == "_FV" && args.len() == 2 && matches!(&args[1], Expr::Str(_)) => {
            print(&args[0], out);
            out.push('.');
            if let Expr::Str(s) = &args[1] {
                if s.chars().all(|c| c.is_alphanumeric() || c == '_') {
                    out.push_str(s);
                } else {
                    out.push('[');
                    out.push_str(s);
                    out.push(']');
                }
            }
        }
        Expr::Call(name, args) => {
            out.push_str(name);
            print_args(args, out);
        }
        Expr::Invoke(f, args) => {
            print(f, out);
            print_args(args, out);
        }
        Expr::Paren(x) => {
            out.push('(');
            print(x, out);
            out.push(')');
        }
        Expr::Array(rows) => {
            out.push('{');
            for (i, r) in rows.iter().enumerate() {
                if i > 0 {
                    out.push(';');
                }
                for (j, x) in r.iter().enumerate() {
                    if j > 0 {
                        out.push(',');
                    }
                    print(x, out);
                }
            }
            out.push('}');
        }
        Expr::Range(a, b) => {
            print(a, out);
            out.push(':');
            print(b, out);
        }
        Expr::Intersect(a, b) => {
            print(a, out);
            out.push(' ');
            print(b, out);
        }
        Expr::Union(parts) => {
            out.push('(');
            for (i, x) in parts.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                print(x, out);
            }
            out.push(')');
        }
    }
}

fn print_args(args: &[Expr], out: &mut String) {
    out.push('(');
    for (i, a) in args.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        print(a, out);
    }
    out.push(')');
}

pub(crate) fn children(e: &Expr) -> Vec<&Expr> {
    match e {
        Expr::Neg(x) | Expr::Pos(x) | Expr::Pct(x) | Expr::Paren(x) | Expr::Spill(x) | Expr::Single(x) => vec![x],
        Expr::Bin(_, a, b) | Expr::Range(a, b) | Expr::Intersect(a, b) => vec![a, b],
        Expr::Call(_, args) | Expr::Union(args) => args.iter().collect(),
        Expr::Invoke(f, args) => std::iter::once(&**f).chain(args).collect(),
        Expr::Array(rows) => rows.iter().flatten().collect(),
        _ => Vec::new(),
    }
}

pub fn names(e: &Expr, f: &mut dyn FnMut(&str)) {
    match e {
        Expr::Name(n) | Expr::Call(n, _) => {
            f(n);
            for c in children(e) {
                names(c, f);
            }
        }
        o => {
            for c in children(o) {
                names(c, f);
            }
        }
    }
}

pub fn valid_name(n: &str) -> bool {
    valid_local(n) && !n.eq_ignore_ascii_case("C") && !n.eq_ignore_ascii_case("R")
}

pub fn valid_local(n: &str) -> bool {
    let mut cs = n.chars();
    let Some(first) = cs.next() else { return false };
    let upper = n.to_ascii_uppercase();
    (first.is_alphabetic() || first == '_' || first == '\\')
        && cs.all(|c| c.is_alphanumeric() || c == '_' || c == '.')
        && n.chars().count() <= 255
        && !matches!(upper.as_str(), "TRUE" | "FALSE")
        && parse_cell(n).is_none()
        && (upper.len() == 1 || !is_r1c1(&upper))
}

fn is_r1c1(u: &str) -> bool {
    let Some(rest) = u.strip_prefix('R') else { return false };
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    let rest = &rest[digits..];
    (rest.is_empty() && digits > 0) || rest.strip_prefix('C').is_some_and(|c| c.chars().all(|d| d.is_ascii_digit()))
}

pub fn to_text(e: &Expr) -> String {
    let mut s = String::new();
    print(e, &mut s);
    s
}

pub fn walk_mut(e: &mut Expr, f: &mut dyn FnMut(&mut Expr)) {
    match e {
        Expr::Neg(x) | Expr::Pos(x) | Expr::Pct(x) | Expr::Paren(x) | Expr::Spill(x) | Expr::Single(x) => walk_mut(x, f),
        Expr::Bin(_, a, b) | Expr::Range(a, b) | Expr::Intersect(a, b) => {
            walk_mut(a, f);
            walk_mut(b, f);
        }
        Expr::Call(_, args) | Expr::Union(args) => {
            for a in args {
                walk_mut(a, f);
            }
        }
        Expr::Invoke(g, args) => {
            walk_mut(g, f);
            for a in args {
                walk_mut(a, f);
            }
        }
        Expr::Array(rows) => {
            for x in rows.iter_mut().flatten() {
                walk_mut(x, f);
            }
        }
        _ => {}
    }
    f(e);
}

pub fn is_volatile(e: &Expr) -> bool {
    match e {
        Expr::Call(n, _) if matches!(n.as_str(), "TODAY" | "NOW" | "RAND" | "RANDBETWEEN" | "RANDARRAY" | "OFFSET" | "INDIRECT") => true,
        o => children(o).into_iter().any(is_volatile),
    }
}

pub fn refs(e: &Expr, f: &mut dyn FnMut(Option<&str>, Area)) {
    match e {
        Expr::Ref(s, k) => f(s.as_deref(), k.area()),
        o => {
            for c in children(o) {
                refs(c, f);
            }
        }
    }
}

pub(crate) fn shift_index(i: u32, at: u32, delta: i64, limit: u32) -> Option<u32> {
    let (i, at) = (i64::from(i), i64::from(at));
    if delta >= 0 {
        let n = if i >= at { i + delta } else { i };
        return (n < i64::from(limit)).then_some(n as u32);
    }
    let n = -delta;
    if i >= at && i < at + n {
        return None;
    }
    Some(if i >= at + n { (i - n) as u32 } else { i as u32 })
}

pub(crate) fn shift_span(lo: u32, hi: u32, at: u32, delta: i64, limit: u32) -> Option<(u32, u32)> {
    if delta >= 0 {
        let a = shift_index(lo, at, delta, limit)?;
        let b = shift_index(hi, at, delta, limit).unwrap_or(limit - 1);
        return Some((a, b));
    }
    let (lo64, hi64, at64, n) = (i64::from(lo), i64::from(hi), i64::from(at), -delta);
    let a = if lo64 >= at64 + n { lo64 - n } else if lo64 >= at64 { at64 } else { lo64 };
    let b = if hi64 >= at64 + n { hi64 - n } else if hi64 >= at64 { at64 - 1 } else { hi64 };
    (b >= a && b >= 0).then_some((a as u32, b as u32))
}

pub fn shift_refs(e: &mut Expr, own: &str, target: &str, rows: bool, at: u32, delta: i64) -> bool {
    let mut changed = false;
    let limit = if rows { MAX_ROWS } else { MAX_COLS };
    walk_mut(e, &mut |node| {
        let Expr::Ref(sheet, kind) = node else { return };
        let on = sheet.as_deref().unwrap_or(own);
        if !on.eq_ignore_ascii_case(target) {
            return;
        }
        let before = *kind;
        let next: Option<RefKind> = match *kind {
            RefKind::Cell(c) => shift_index(if rows { c.row } else { c.col }, at, delta, limit).map(|n| {
                let mut c = c;
                if rows {
                    c.row = n;
                } else {
                    c.col = n;
                }
                RefKind::Cell(c)
            }),
            RefKind::Area(mut a, mut b) => {
                let (pa, pb) = if rows { (a.row, b.row) } else { (a.col, b.col) };
                let (lo, hi) = (pa.min(pb), pa.max(pb));
                shift_span(lo, hi, at, delta, limit).map(|(nl, nh)| {
                    let (first, second) = if pa <= pb { (&mut a, &mut b) } else { (&mut b, &mut a) };
                    if rows {
                        first.row = nl;
                        second.row = nh;
                    } else {
                        first.col = nl;
                        second.col = nh;
                    }
                    RefKind::Area(a, b)
                })
            }
            RefKind::Cols(a, aa, b, ab) if !rows => shift_span(a.min(b), a.max(b), at, delta, limit).map(|(l, h)| RefKind::Cols(l, aa, h, ab)),
            RefKind::Rows(a, aa, b, ab) if rows => shift_span(a.min(b), a.max(b), at, delta, limit).map(|(l, h)| RefKind::Rows(l, aa, h, ab)),
            k => Some(k),
        };
        match next {
            Some(k) => {
                if k != before {
                    *kind = k;
                    changed = true;
                }
            }
            None => {
                *node = Expr::Err(ErrKind::Ref);
                changed = true;
            }
        }
    });
    changed
}

pub fn rename_refs(e: &mut Expr, old: &str, new: &str) -> bool {
    let mut changed = false;
    walk_mut(e, &mut |node| {
        if let Expr::Ref(Some(s), _) = node {
            if s.eq_ignore_ascii_case(old) {
                *s = new.to_string();
                changed = true;
            }
        }
    });
    changed
}

fn move_by(i: u32, abs: bool, d: i64, limit: u32) -> Option<u32> {
    if abs {
        return Some(i);
    }
    let n = i64::from(i) + d;
    (n >= 0 && n < i64::from(limit)).then_some(n as u32)
}

pub fn offset(e: &mut Expr, dr: i64, dc: i64) {
    walk_mut(e, &mut |node| {
        let Expr::Ref(_, kind) = node else { return };
        let cell = |c: CellRef| -> Option<CellRef> {
            Some(CellRef { row: move_by(c.row, c.abs_row, dr, MAX_ROWS)?, col: move_by(c.col, c.abs_col, dc, MAX_COLS)?, ..c })
        };
        let next = match *kind {
            RefKind::Cell(c) => cell(c).map(RefKind::Cell),
            RefKind::Area(a, b) => cell(a).zip(cell(b)).map(|(a, b)| RefKind::Area(a, b)),
            RefKind::Cols(a, aa, b, ab) => move_by(a, aa, dc, MAX_COLS).zip(move_by(b, ab, dc, MAX_COLS)).map(|(a, b)| RefKind::Cols(a, aa, b, ab)),
            RefKind::Rows(a, aa, b, ab) => move_by(a, aa, dr, MAX_ROWS).zip(move_by(b, ab, dr, MAX_ROWS)).map(|(a, b)| RefKind::Rows(a, aa, b, ab)),
        };
        match next {
            Some(k) => *kind = k,
            None => *node = Expr::Err(ErrKind::Ref),
        }
    });
}

pub fn offset_text(src: &str, dr: i64, dc: i64) -> String {
    let body = src.trim_start().strip_prefix('=').unwrap_or(src);
    match parse(body) {
        Some(mut e) => {
            offset(&mut e, dr, dc);
            format!("={}", to_text(&e))
        }
        None => src.to_string(),
    }
}
