use super::*;

pub(super) const ARRAY_MORE: [&str; 9] = ["COLUMN", "INDIRECT", "OFFSET", "QUERY", "REGEXEXTRACT", "ROW", "SORTN", "SPLIT", "XLOOKUP"];

impl Eval<'_> {
    pub(super) fn call_more(&self, name: &str, a: &[Expr]) -> Result<Value, ErrKind> {
        if let Some(r) = self.call_text(name, a) {
            return r;
        }
        if let Some(r) = self.call_regex(name, a) {
            return r;
        }
        if let Some(r) = self.call_date(name, a) {
            return r;
        }
        if let Some(r) = self.call_lookup(name, a) {
            return r;
        }
        if let Some(r) = self.call_info(name, a) {
            return r;
        }
        if let Some(r) = self.call_info2(name, a) {
            return r;
        }
        if let Some(r) = self.call_eng(name, a) {
            return r;
        }
        if let Some(r) = self.call_cube(name, a) {
            return r;
        }
        Err(ErrKind::Name)
    }

    pub(super) fn call_arg_more(&self, name: &str, a: &[Expr]) -> Result<Arg, ErrKind> {
        match name {
            "REGEXEXTRACT" => self.extract(a),
            "SPLIT" => self.split_text(a),
            "XLOOKUP" => self.xlookup(a),
            "QUERY" => self.query(a),
            "SORTN" => self.sortn(a),
            _ => self.call_ref(name, a).unwrap_or(Err(ErrKind::Name)),
        }
    }
}
