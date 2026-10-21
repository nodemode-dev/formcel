use super::*;
use crate::locale::{self, Locale};
use crate::fmtcode;

const US: [(&str, &str); 4] = [
    ("Zip Code", "00000"),
    ("Zip Code + 4", "00000-0000"),
    ("Phone Number", "[<=9999999]###-####;(###) ###-####"),
    ("Social Security Number", "000-00-0000"),
];
const GB: [(&str, &str); 3] = [("Postcode", "@"), ("Phone Number (11 digits)", "00000 000000"), ("Phone Number (10 digits)", "000 0000 0000")];
const DE: [(&str, &str); 3] = [("Postleitzahl", "00000"), ("Telefonnummer", "0000 0000000"), ("Steueridentifikationsnummer", "00 000 000 000")];
const FR: [(&str, &str); 3] = [("Code postal", "00000"), ("Numero de telephone", "00 00 00 00 00"), ("Numero de securite sociale", "0 00 00 00 000 000 00")];
const JP: [(&str, &str); 3] = [("Yubin bango", "000-0000"), ("Denwa bango (10 digits)", "00-0000-0000"), ("Keitai denwa (11 digits)", "000-0000-0000")];

impl Workbook {
    pub(super) fn t_fmtpreview(&mut self, _sheet: usize, p: &[String]) -> Out {
        let code = arg(p, 1);
        let sample = Value::parse_input(arg(p, 2));
        if fmtcode::parse(code).is_none() && !code.is_empty() {
            return bad("That is not a number format code.");
        }
        let shown = if code.is_empty() { sample.to_string() } else { fmtcode::text(&sample, code).unwrap_or_else(|| sample.to_string()) };
        Ok((Effect::default(), say(&shown)))
    }

    pub(super) fn t_fmtspecials(&mut self, _sheet: usize, _p: &[String]) -> Out {
        let list: &[(&str, &str)] = match locale::current() {
            Locale::EnUs => &US,
            Locale::EnGb => &GB,
            Locale::DeDe => &DE,
            Locale::FrFr => &FR,
            Locale::JaJp => &JP,
        };
        let lines: Vec<String> = list.iter().map(|(n, c)| format!("{n}\t{c}")).collect();
        Ok((Effect::default(), say(&lines.join("\n"))))
    }
}
