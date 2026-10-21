use crate::style::{clean_name, Cats, Style};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Theme {
    pub name: String,
    pub colors: [u32; 10],
    pub heading: String,
    pub body: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NamedStyle {
    pub name: String,
    pub style: Style,
    pub code: Option<String>,
    pub cats: Cats,
    pub builtin: bool,
}

const THEMES: [(&str, [u32; 10], &str, &str); 5] = [
    ("FormCel", [0x000000, 0xffffff, 0x1f2937, 0xe5e7eb, 0xf97316, 0x3b82f6, 0x22c55e, 0xa855f7, 0xeab308, 0x14b8a6], "Inter", "Inter"),
    ("Slate", [0x000000, 0xffffff, 0x1e293b, 0xe2e8f0, 0x64748b, 0x0ea5e9, 0x6366f1, 0x10b981, 0xf43f5e, 0xf59e0b], "Georgia", "Inter"),
    ("Forest", [0x000000, 0xffffff, 0x14532d, 0xdcfce7, 0x15803d, 0x65a30d, 0x0f766e, 0xa16207, 0x9a3412, 0x4d7c0f], "Georgia", "Verdana"),
    ("Ember", [0x000000, 0xffffff, 0x431407, 0xffedd5, 0xdc2626, 0xea580c, 0xd97706, 0xbe123c, 0x9333ea, 0x0891b2], "Times New Roman", "Arial"),
    ("Mono", [0x000000, 0xffffff, 0x262626, 0xf5f5f5, 0x525252, 0x737373, 0xa3a3a3, 0x404040, 0x171717, 0xd4d4d4], "JetBrains Mono", "JetBrains Mono"),
];

impl Default for Theme {
    fn default() -> Self {
        Theme::builtin(0)
    }
}

impl Theme {
    pub fn builtin(i: usize) -> Theme {
        let (name, colors, heading, body) = THEMES[i.min(THEMES.len() - 1)];
        Theme { name: name.into(), colors, heading: heading.into(), body: body.into() }
    }

    pub fn names() -> Vec<&'static str> {
        THEMES.iter().map(|t| t.0).collect()
    }

    pub fn by_name(name: &str) -> Option<Theme> {
        THEMES.iter().position(|t| t.0.eq_ignore_ascii_case(name)).map(Theme::builtin)
    }

    pub fn text(&self) -> String {
        let cols: Vec<String> = self.colors.iter().map(|c| format!("{c:06x}")).collect();
        format!("{};{};{};{}", self.name, cols.join(","), self.heading, self.body)
    }

    pub fn parse(s: &str) -> Option<Theme> {
        let p: Vec<&str> = s.split(';').collect();
        if p.len() != 4 {
            return Theme::by_name(s.trim());
        }
        let cols: Vec<u32> = p[1].split(',').filter_map(|c| u32::from_str_radix(c.trim(), 16).ok()).collect();
        let colors: [u32; 10] = cols.try_into().ok()?;
        let font = |f: &str| clean_name(f);
        Some(Theme { name: clean_name(p[0]), colors, heading: font(p[2]), body: font(p[3]) })
    }
}

const BUILTIN: [(&str, &str, &str, &str); 23] = [
    ("Normal", "", "", "nafbp"),
    ("Good", "fc:006100;bg:c6efce", "", "fp"),
    ("Bad", "fc:9c0006;bg:ffc7ce", "", "fp"),
    ("Neutral", "fc:9c5700;bg:ffeb9c", "", "fp"),
    ("Title", "b;sz:18;ff:+heading;fc:t:dk2", "", "f"),
    ("Heading 1", "b;sz:15;fc:t:dk2;bb:thick:t:accent1", "", "fb"),
    ("Heading 2", "b;sz:13;fc:t:dk2;bb:thick:t:accent1:50", "", "fb"),
    ("Heading 3", "b;sz:11;fc:t:dk2;bb:medium:t:accent1:40", "", "fb"),
    ("Heading 4", "b;fc:t:dk2", "", "f"),
    ("Total", "b;bt:thin:t:accent1;bb:double:t:accent1", "", "fb"),
    ("Input", "fc:3f3f76;bg:ffcc99;bt:thin:7f7f7f;br:thin:7f7f7f;bb:thin:7f7f7f;bl:thin:7f7f7f", "", "fbp"),
    ("Output", "b;fc:3f3f3f;bg:f2f2f2;bt:thin:3f3f3f;br:thin:3f3f3f;bb:thin:3f3f3f;bl:thin:3f3f3f", "", "fbp"),
    ("Calculation", "b;fc:fa7d00;bg:f2f2f2;bt:thin:7f7f7f;br:thin:7f7f7f;bb:thin:7f7f7f;bl:thin:7f7f7f", "", "fbp"),
    ("Note", "bg:ffffcc;bt:thin:b2b2b2;br:thin:b2b2b2;bb:thin:b2b2b2;bl:thin:b2b2b2", "", "bp"),
    ("Warning Text", "fc:ff0000", "", "f"),
    ("Accent 1", "fc:t:lt1;bg:t:accent1", "", "fp"),
    ("Accent 2", "fc:t:lt1;bg:t:accent2", "", "fp"),
    ("Accent 3", "fc:t:lt1;bg:t:accent3", "", "fp"),
    ("Accent 4", "fc:t:lt1;bg:t:accent4", "", "fp"),
    ("Accent 5", "fc:t:lt1;bg:t:accent5", "", "fp"),
    ("Accent 6", "fc:t:lt1;bg:t:accent6", "", "fp"),
    ("Comma", "", "#,##0.00", "n"),
    ("Currency", "", "$#,##0.00", "n"),
];

pub fn builtin_styles() -> Vec<NamedStyle> {
    let mut out: Vec<NamedStyle> = BUILTIN
        .iter()
        .map(|(name, patch, code, cats)| NamedStyle {
            name: (*name).into(),
            style: Style::parse(patch).unwrap_or_default(),
            code: (!code.is_empty()).then(|| code.to_string()),
            cats: Cats::parse(cats),
            builtin: true,
        })
        .collect();
    out.push(NamedStyle { name: "Percent".into(), style: Style::default(), code: Some("0%".into()), cats: Cats::parse("n"), builtin: true });
    out
}

impl NamedStyle {
    pub fn line(&self) -> String {
        format!("{}\t{}\t{}\t{}\t{}", self.name, self.style.text(), self.code.clone().unwrap_or_default(), self.cats.text(), u8::from(self.builtin))
    }

    pub fn parse_line(l: &str) -> Option<NamedStyle> {
        let p: Vec<&str> = l.split('\t').collect();
        let name = clean_name(p.first()?);
        if name.is_empty() {
            return None;
        }
        Some(NamedStyle {
            name,
            style: Style::parse(p.get(1).copied().unwrap_or(""))?,
            code: p.get(2).filter(|c| !c.is_empty()).map(|c| c.to_string()),
            cats: Cats::parse(p.get(3).copied().unwrap_or("")),
            builtin: p.get(4) == Some(&"1"),
        })
    }
}
