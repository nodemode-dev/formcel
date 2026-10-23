use crate::chips::{self, Chip};
use crate::datatype::{field_value, DType};
use crate::wire::unescape;
use crate::{Effect, EngineError, Key, Tx, Workbook};

const MAX_PAYLOAD: usize = 16000;

#[derive(Clone, Debug, PartialEq)]
pub struct Record {
    pub kind: String,
    pub entity: String,
    pub provider: String,
    pub at: i64,
    pub fields: Vec<(String, String, String)>,
}

pub type RecChange = (String, Option<Record>, Option<Record>);

impl Record {
    pub fn parse(kind: &str, payload: &str) -> Option<Record> {
        if payload.chars().count() > MAX_PAYLOAD {
            return None;
        }
        let mut lines = payload.split('\n');
        let head: Vec<String> = lines.next()?.split('\t').map(unescape).collect();
        if head.len() < 4 || head[0] != "v1" || !chips::typed_kind(kind) {
            return None;
        }
        let mut fields = Vec::new();
        for l in lines.filter(|l| !l.is_empty()) {
            let p: Vec<String> = l.split('\t').map(unescape).collect();
            if p.len() >= 3 {
                fields.push((p[0].clone(), p[1].clone(), p[2].clone()));
            }
        }
        Some(Record { kind: kind.to_string(), entity: head[1].clone(), provider: head[2].clone(), at: head[3].parse().unwrap_or(0), fields })
    }

    pub fn payload(&self) -> String {
        let mut out = String::from("v1\t");
        crate::wire::escape(&self.entity, &mut out);
        out.push('\t');
        crate::wire::escape(&self.provider, &mut out);
        out.push('\t');
        out.push_str(&self.at.to_string());
        for (name, tag, body) in &self.fields {
            out.push('\n');
            crate::wire::escape(name, &mut out);
            out.push('\t');
            crate::wire::escape(tag, &mut out);
            out.push('\t');
            crate::wire::escape(body, &mut out);
        }
        out
    }

    pub fn id(&self) -> String {
        format!("{}:{}", self.kind, self.entity)
    }

    pub fn dtype(&self) -> DType {
        let fields = self.fields.iter().map(|(n, t, b)| {
            let (v, tag) = field_value(t, b);
            (n.clone(), v, tag)
        });
        DType { kind: self.kind.clone(), entity: self.entity.clone(), provider: self.provider.clone(), at: self.at, fields: fields.collect() }
    }
}

impl Workbook {
    pub fn record_of(&self, id: &str) -> Option<&Record> {
        self.records.get(id)
    }

    fn used_ids(&self, sheet: Option<usize>) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for ((s, _), line) in &self.chips {
            if sheet.is_some_and(|only| only != *s) {
                continue;
            }
            for c in chips::parse(line) {
                if chips::typed_kind(&c.kind) && self.records.contains_key(&c.value) && !ids.contains(&c.value) {
                    ids.push(c.value);
                }
            }
        }
        ids.sort();
        ids
    }

    pub fn records_list(&self, sheet: Option<usize>) -> Vec<(String, Record)> {
        self.used_ids(sheet).into_iter().filter_map(|id| self.records.get(&id).cloned().map(|r| (id, r))).collect()
    }

    pub fn take_record_changes(&mut self) -> Vec<(String, Record)> {
        let log = std::mem::take(&mut self.record_log);
        let mut out: Vec<(String, Record)> = Vec::new();
        for id in log {
            if out.iter().any(|(i, _)| *i == id) {
                continue;
            }
            if let Some(r) = self.records.get(&id) {
                out.push((id, r.clone()));
            }
        }
        out
    }

    pub(crate) fn referencing(&self, ids: &[String]) -> Vec<Key> {
        let mut out = Vec::new();
        for (k, line) in &self.chips {
            if chips::parse(line).iter().any(|c| chips::typed_kind(&c.kind) && ids.contains(&c.value)) {
                out.push(*k);
            }
        }
        out
    }

    pub(crate) fn apply_records(&mut self, changes: &[RecChange], forward: bool) -> Vec<String> {
        let mut ids = Vec::new();
        for (id, before, after) in changes {
            let to = if forward { after } else { before };
            match to {
                Some(r) => {
                    self.records.insert(id.clone(), r.clone());
                }
                None => {
                    self.records.remove(id);
                }
            }
            self.record_log.push(id.clone());
            ids.push(id.clone());
        }
        ids
    }

    pub(crate) fn intern(&self, list: Vec<Chip>, staged: &mut Vec<RecChange>, strict: bool) -> Vec<Chip> {
        let mut out = Vec::with_capacity(list.len());
        for mut c in list {
            if chips::typed_kind(&c.kind) {
                if c.value.starts_with("v1\t") || c.value == "v1" {
                    let rec = Record::parse(&c.kind, &c.value).filter(|r| !r.entity.is_empty());
                    match rec {
                        Some(r) => {
                            let id = r.id();
                            let current = staged.iter().rev().find(|s| s.0 == id).map(|s| s.2.clone()).unwrap_or_else(|| self.records.get(&id).cloned());
                            if current.as_ref().is_none_or(|cur| r.at >= cur.at) && current.as_ref() != Some(&r) {
                                staged.push((id.clone(), current, Some(r)));
                            }
                            c.value = id;
                        }
                        None => c.value = String::new(),
                    }
                } else if strict && !c.value.is_empty() && !self.records.contains_key(&c.value) && !staged.iter().any(|s| s.0 == c.value) {
                    c.value = String::new();
                }
            }
            out.push(c);
        }
        out
    }

    pub fn put_records(&mut self, items: &[(String, String, String)]) -> Result<Effect, EngineError> {
        let mut changes: Vec<RecChange> = Vec::new();
        for (id, kind, payload) in items {
            let Some(r) = Record::parse(kind, payload).filter(|r| !r.entity.is_empty()) else { continue };
            let before = self.records.get(id).cloned();
            if before.as_ref() == Some(&r) {
                continue;
            }
            changes.push((id.clone(), before, Some(r)));
        }
        if changes.is_empty() {
            return Ok(Effect::default());
        }
        let ids = self.apply_records(&changes, true);
        let seeds = self.referencing(&ids);
        let cells = self.recalc(&seeds);
        self.record(Tx::Records(changes));
        Ok(Effect { cells: self.present(cells), ..Effect::default() })
    }

    pub fn load_records(&mut self, items: &[(String, String, String)]) -> usize {
        let mut changes: Vec<RecChange> = Vec::new();
        for (id, kind, payload) in items {
            let Some(r) = Record::parse(kind, payload).filter(|r| !r.entity.is_empty()) else { continue };
            let before = changes.iter().rev().find(|c| c.0 == *id).map(|c| c.2.clone()).unwrap_or_else(|| self.records.get(id).cloned());
            if before.as_ref().is_none_or(|cur| r.at >= cur.at) && before.as_ref() != Some(&r) {
                changes.push((id.clone(), before, Some(r)));
            }
        }
        let n = changes.len();
        let ids = self.apply_records(&changes, true);
        let seeds = self.referencing(&ids);
        if !seeds.is_empty() {
            self.recalc(&seeds);
        }
        n
    }

    pub fn record_payload(&self, id: &str) -> Option<String> {
        self.records.get(id).map(Record::payload)
    }
}
