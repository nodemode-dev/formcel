use super::*;

#[derive(Clone, Copy, PartialEq)]
enum Group {
    Weight,
    Distance,
    Time,
    Pressure,
    Force,
    Energy,
    Power,
    Magnetism,
    Temperature,
    Volume,
    Area,
    Speed,
    Information,
}

struct Unit {
    names: &'static [&'static str],
    group: Group,
    factor: f64,
    metric: bool,
    power: i32,
}

const fn u(names: &'static [&'static str], group: Group, factor: f64, metric: bool, power: i32) -> Unit {
    Unit { names, group, factor, metric, power }
}

const UNITS: &[Unit] = &[
    u(&["g"], Group::Weight, 1.0, true, 1),
    u(&["sg"], Group::Weight, 14.59390294, false, 1),
    u(&["lbm"], Group::Weight, 453.59237, false, 1),
    u(&["u"], Group::Weight, 1.660_538_782e-24, true, 1),
    u(&["ozm"], Group::Weight, 28.349_523_125, false, 1),
    u(&["grain"], Group::Weight, 0.064_798_91, false, 1),
    u(&["cwt", "shweight"], Group::Weight, 45_359.237, false, 1),
    u(&["uk_cwt", "hweight"], Group::Weight, 50_802.345_44, false, 1),
    u(&["stone"], Group::Weight, 6350.293_18, false, 1),
    u(&["ton"], Group::Weight, 907_184.74, false, 1),
    u(&["uk_ton", "LTON"], Group::Weight, 1_016_046.908_8, false, 1),
    u(&["m"], Group::Distance, 1.0, true, 1),
    u(&["mi"], Group::Distance, 1609.344, false, 1),
    u(&["Nmi"], Group::Distance, 1852.0, false, 1),
    u(&["in"], Group::Distance, 0.0254, false, 1),
    u(&["ft"], Group::Distance, 0.3048, false, 1),
    u(&["yd"], Group::Distance, 0.9144, false, 1),
    u(&["ang"], Group::Distance, 1e-10, true, 1),
    u(&["ell"], Group::Distance, 1.143, false, 1),
    u(&["ly"], Group::Distance, 9.460_730_472_580_8e15, false, 1),
    u(&["parsec", "pc"], Group::Distance, 3.085_677_581_491_37e16, false, 1),
    u(&["Pica"], Group::Distance, 0.000_352_777_777_8, false, 1),
    u(&["pica"], Group::Distance, 0.004_233_333_333, false, 1),
    u(&["survey_mi"], Group::Distance, 1609.347_218_694_4, false, 1),
    u(&["yr"], Group::Time, 31_557_600.0, false, 1),
    u(&["day", "d"], Group::Time, 86_400.0, false, 1),
    u(&["hr"], Group::Time, 3600.0, false, 1),
    u(&["mn", "min"], Group::Time, 60.0, false, 1),
    u(&["sec", "s"], Group::Time, 1.0, true, 1),
    u(&["Pa", "p"], Group::Pressure, 1.0, true, 1),
    u(&["atm", "at"], Group::Pressure, 101_325.0, true, 1),
    u(&["mmHg"], Group::Pressure, 133.322, true, 1),
    u(&["psi"], Group::Pressure, 6894.757_293_168, false, 1),
    u(&["Torr"], Group::Pressure, 133.322_368_421_052_6, false, 1),
    u(&["N"], Group::Force, 1.0, true, 1),
    u(&["dyn", "dy"], Group::Force, 1e-5, true, 1),
    u(&["lbf"], Group::Force, 4.448_221_615_260_5, false, 1),
    u(&["pond"], Group::Force, 0.009_806_65, true, 1),
    u(&["J"], Group::Energy, 1.0, true, 1),
    u(&["e"], Group::Energy, 1e-7, true, 1),
    u(&["c"], Group::Energy, 4.184, true, 1),
    u(&["cal"], Group::Energy, 4.1868, true, 1),
    u(&["eV", "ev"], Group::Energy, 1.602_176_487e-19, true, 1),
    u(&["HPh", "hh"], Group::Energy, 2_684_519.537_696_173, false, 1),
    u(&["Wh", "wh"], Group::Energy, 3600.0, true, 1),
    u(&["flb"], Group::Energy, 1.355_817_948_331_4, false, 1),
    u(&["BTU", "btu"], Group::Energy, 1055.055_852_62, false, 1),
    u(&["W", "w"], Group::Power, 1.0, true, 1),
    u(&["HP", "h"], Group::Power, 745.699_871_582_270_2, false, 1),
    u(&["PS"], Group::Power, 735.498_75, false, 1),
    u(&["T"], Group::Magnetism, 1.0, true, 1),
    u(&["ga"], Group::Magnetism, 1e-4, true, 1),
    u(&["C", "cel"], Group::Temperature, 1.0, false, 1),
    u(&["F", "fah"], Group::Temperature, 1.0, false, 1),
    u(&["K", "kel"], Group::Temperature, 1.0, true, 1),
    u(&["Rank"], Group::Temperature, 1.0, false, 1),
    u(&["Reau"], Group::Temperature, 1.0, false, 1),
    u(&["tsp"], Group::Volume, 4.928_921_593_75e-6, false, 1),
    u(&["tspm"], Group::Volume, 5e-6, false, 1),
    u(&["tbs"], Group::Volume, 1.478_676_478_125e-5, false, 1),
    u(&["oz"], Group::Volume, 2.957_352_956_25e-5, false, 1),
    u(&["cup"], Group::Volume, 2.365_882_365e-4, false, 1),
    u(&["pt", "us_pt"], Group::Volume, 4.731_764_73e-4, false, 1),
    u(&["uk_pt"], Group::Volume, 5.682_612_5e-4, false, 1),
    u(&["qt"], Group::Volume, 9.463_529_46e-4, false, 1),
    u(&["uk_qt"], Group::Volume, 1.136_522_5e-3, false, 1),
    u(&["gal"], Group::Volume, 3.785_411_784e-3, false, 1),
    u(&["uk_gal"], Group::Volume, 4.546_09e-3, false, 1),
    u(&["l", "L", "lt"], Group::Volume, 1e-3, true, 1),
    u(&["m3"], Group::Volume, 1.0, true, 3),
    u(&["ang3"], Group::Volume, 1e-30, true, 3),
    u(&["barrel"], Group::Volume, 0.158_987_294_928, false, 1),
    u(&["bushel"], Group::Volume, 0.035_239_070_166_88, false, 1),
    u(&["ft3"], Group::Volume, 0.028_316_846_592, false, 1),
    u(&["in3"], Group::Volume, 1.638_706_4e-5, false, 1),
    u(&["yd3"], Group::Volume, 0.764_554_857_984, false, 1),
    u(&["GRT", "regton"], Group::Volume, 2.831_684_659_2, false, 1),
    u(&["MTON"], Group::Volume, 1.132_673_863_68, false, 1),
    u(&["m2"], Group::Area, 1.0, true, 2),
    u(&["ft2"], Group::Area, 0.092_903_04, false, 1),
    u(&["in2"], Group::Area, 6.4516e-4, false, 1),
    u(&["yd2"], Group::Area, 0.836_127_36, false, 1),
    u(&["mi2"], Group::Area, 2_589_988.110_336, false, 1),
    u(&["ha"], Group::Area, 10_000.0, true, 1),
    u(&["ar"], Group::Area, 100.0, true, 1),
    u(&["us_acre"], Group::Area, 4046.872_609_874_252, false, 1),
    u(&["uk_acre"], Group::Area, 4046.856_422_4, false, 1),
    u(&["Morgen"], Group::Area, 2500.0, false, 1),
    u(&["ang2"], Group::Area, 1e-20, true, 2),
    u(&["m/s", "m/sec"], Group::Speed, 1.0, true, 1),
    u(&["m/h", "m/hr"], Group::Speed, 1.0 / 3600.0, true, 1),
    u(&["mph"], Group::Speed, 0.447_04, false, 1),
    u(&["kn"], Group::Speed, 0.514_444_444_444_444, false, 1),
    u(&["admkn"], Group::Speed, 0.514_773_333, false, 1),
    u(&["bit"], Group::Information, 1.0, true, 1),
    u(&["byte"], Group::Information, 8.0, true, 1),
];

const PREFIXES: &[(&str, f64)] = &[
    ("Y", 1e24),
    ("Z", 1e21),
    ("E", 1e18),
    ("P", 1e15),
    ("T", 1e12),
    ("G", 1e9),
    ("M", 1e6),
    ("k", 1e3),
    ("h", 1e2),
    ("da", 10.0),
    ("e", 10.0),
    ("d", 0.1),
    ("c", 0.01),
    ("m", 1e-3),
    ("u", 1e-6),
    ("n", 1e-9),
    ("p", 1e-12),
    ("f", 1e-15),
    ("a", 1e-18),
    ("z", 1e-21),
    ("y", 1e-24),
];

const BINARY: &[(&str, f64)] = &[
    ("Yi", 1_208_925_819_614_629_174_706_176.0),
    ("Zi", 1_180_591_620_717_411_303_424.0),
    ("Ei", 1_152_921_504_606_846_976.0),
    ("Pi", 1_125_899_906_842_624.0),
    ("Ti", 1_099_511_627_776.0),
    ("Gi", 1_073_741_824.0),
    ("Mi", 1_048_576.0),
    ("ki", 1024.0),
];

fn lookup(name: &str) -> Option<(Group, f64, usize)> {
    let find = |n: &str| UNITS.iter().position(|x| x.names.contains(&n));
    if let Some(i) = find(name) {
        return Some((UNITS[i].group, UNITS[i].factor, i));
    }
    for (p, f) in BINARY {
        if let Some(rest) = name.strip_prefix(p) {
            if let Some(i) = find(rest).filter(|&i| UNITS[i].group == Group::Information) {
                return Some((Group::Information, UNITS[i].factor * f, i));
            }
        }
    }
    for (p, f) in PREFIXES {
        if let Some(rest) = name.strip_prefix(p) {
            if let Some(i) = find(rest).filter(|&i| UNITS[i].metric) {
                return Some((UNITS[i].group, UNITS[i].factor * f.powi(UNITS[i].power), i));
            }
        }
    }
    None
}

fn kelvin(name: &str, v: f64) -> Option<f64> {
    let (_, f, i) = lookup(name)?;
    Some(match UNITS[i].names[0] {
        "C" => v + 273.15,
        "F" => (v - 32.0) * 5.0 / 9.0 + 273.15,
        "Rank" => v * 5.0 / 9.0,
        "Reau" => v * 1.25 + 273.15,
        _ => v * f,
    })
}

fn from_kelvin(name: &str, k: f64) -> Option<f64> {
    let canon = UNITS[lookup(name)?.2].names[0];
    Some(match canon {
        "C" => k - 273.15,
        "F" => (k - 273.15) * 9.0 / 5.0 + 32.0,
        "Rank" => k * 9.0 / 5.0,
        "Reau" => (k - 273.15) * 0.8,
        _ => k / lookup(name)?.1,
    })
}

fn convert(v: f64, from: &str, to: &str) -> Result<f64, ErrKind> {
    let (g1, f1, _) = lookup(from).ok_or(ErrKind::Na)?;
    let (g2, f2, _) = lookup(to).ok_or(ErrKind::Na)?;
    if g1 != g2 {
        return Err(ErrKind::Na);
    }
    if g1 == Group::Temperature {
        return from_kelvin(to, kelvin(from, v).ok_or(ErrKind::Na)?).ok_or(ErrKind::Na);
    }
    Ok(v * f1 / f2)
}

#[derive(Clone, Copy)]
struct Cx {
    re: f64,
    im: f64,
    suffix: char,
}

fn parse_complex(s: &str) -> Result<Cx, ErrKind> {
    let s = s.trim();
    if s.is_empty() {
        return Ok(Cx { re: 0.0, im: 0.0, suffix: 'i' });
    }
    let last = s.chars().last().unwrap_or('0');
    let plain = |t: &str| -> Result<f64, ErrKind> { t.parse::<f64>().map_err(|_| ErrKind::Num) };
    if last != 'i' && last != 'j' {
        return Ok(Cx { re: plain(s)?, im: 0.0, suffix: 'i' });
    }
    let body = &s[..s.len() - 1];
    let bytes: Vec<char> = body.chars().collect();
    let mut split = None;
    for i in (1..bytes.len()).rev() {
        if (bytes[i] == '+' || bytes[i] == '-') && !matches!(bytes[i - 1], 'e' | 'E') {
            split = Some(i);
            break;
        }
    }
    let imag = |t: &str| -> Result<f64, ErrKind> {
        match t {
            "" | "+" => Ok(1.0),
            "-" => Ok(-1.0),
            o => plain(o),
        }
    };
    match split {
        Some(i) => {
            let re: String = bytes[..i].iter().collect();
            let im: String = bytes[i..].iter().collect();
            Ok(Cx { re: plain(&re)?, im: imag(&im)?, suffix: last })
        }
        None => Ok(Cx { re: 0.0, im: imag(body)?, suffix: last }),
    }
}

fn show(c: Cx) -> String {
    let n = |x: f64| Value::Number(x).to_string();
    let (re, im) = (c.re, c.im);
    if im == 0.0 {
        return n(re);
    }
    let imag = if im == 1.0 {
        format!("{}", c.suffix)
    } else if im == -1.0 {
        format!("-{}", c.suffix)
    } else {
        format!("{}{}", n(im), c.suffix)
    };
    if re == 0.0 {
        imag
    } else if im > 0.0 {
        format!("{}+{}", n(re), imag)
    } else {
        format!("{}{}", n(re), imag)
    }
}

pub(crate) fn complex_parts(s: &str) -> Option<(f64, f64)> {
    parse_complex(s).ok().map(|c| (c.re, c.im))
}

pub(crate) fn complex_text(re: f64, im: f64) -> String {
    show(Cx { re, im, suffix: 'i' })
}

fn digits_of(v: &Value) -> Result<String, ErrKind> {
    match v {
        Value::Error(k) => Err(*k),
        Value::Bool(_) => Err(ErrKind::Value),
        Value::Empty => Ok(String::new()),
        o => Ok(o.to_string().trim().to_string()),
    }
}

fn parse_base(s: &str, base: u32) -> Result<i64, ErrKind> {
    if s.is_empty() {
        return Ok(0);
    }
    if s.chars().count() > 10 {
        return Err(ErrKind::Num);
    }
    let mut v: i64 = 0;
    for c in s.chars() {
        v = v * i64::from(base) + i64::from(c.to_digit(base).ok_or(ErrKind::Num)?);
    }
    let full = i64::from(base).pow(10);
    Ok(if s.chars().count() == 10 && v >= full / 2 { v - full } else { v })
}

fn write_base(n: i64, base: u32, places: Option<i64>) -> Result<String, ErrKind> {
    let full = i64::from(base).pow(10);
    if n < -full / 2 || n >= full / 2 {
        return Err(ErrKind::Num);
    }
    let digit = |mut v: i64| -> String {
        if v == 0 {
            return "0".to_string();
        }
        let mut out = Vec::new();
        while v > 0 {
            out.push(std::char::from_digit((v % i64::from(base)) as u32, base).unwrap_or('0').to_ascii_uppercase());
            v /= i64::from(base);
        }
        out.iter().rev().collect()
    };
    if n < 0 {
        return Ok(digit(n + full));
    }
    let s = digit(n);
    match places {
        Some(p) if p < s.len() as i64 || p > 10 => Err(ErrKind::Num),
        Some(p) => Ok(format!("{}{}", "0".repeat(p as usize - s.len()), s)),
        None => Ok(s),
    }
}

fn erf_series(x: f64) -> f64 {
    let mut term = x;
    let mut sum = x;
    let mut n = 0.0;
    while term.abs() > 1e-17 * sum.abs() && n < 500.0 {
        n += 1.0;
        term *= 2.0 * x * x / (2.0 * n + 1.0);
        sum += term;
    }
    2.0 / std::f64::consts::PI.sqrt() * (-x * x).exp() * sum
}

fn erfc_fraction(x: f64) -> f64 {
    let mut f = 0.0;
    for k in (1..=200).rev() {
        f = f64::from(k) / 2.0 / (x + f);
    }
    (-x * x).exp() / std::f64::consts::PI.sqrt() / (x + f)
}

pub(super) fn erf(x: f64) -> f64 {
    if x < 0.0 {
        return -erf(-x);
    }
    if x < 2.0 {
        erf_series(x)
    } else {
        1.0 - erfc_fraction(x)
    }
}

pub(super) fn erfc(x: f64) -> f64 {
    if x < 0.0 {
        return 2.0 - erfc(-x);
    }
    if x < 2.0 {
        1.0 - erf_series(x)
    } else {
        erfc_fraction(x)
    }
}

fn bessel_j(x: f64, n: i64) -> f64 {
    let steps = 128 + 4 * (x.abs().ceil() as usize + n as usize);
    let mut sum = 0.0;
    for k in 0..steps {
        let t = 2.0 * std::f64::consts::PI * k as f64 / steps as f64;
        sum += (n as f64 * t - x * t.sin()).cos();
    }
    sum / steps as f64
}

impl Eval<'_> {
    fn cx(&self, a: &[Expr], i: usize) -> Result<Cx, ErrKind> {
        match self.scalar(a.get(i).ok_or(ErrKind::Na)?) {
            Value::Error(k) => Err(k),
            Value::Bool(_) => Err(ErrKind::Value),
            Value::Number(n) => Ok(Cx { re: n, im: 0.0, suffix: 'i' }),
            o => parse_complex(&o.to_string()),
        }
    }

    fn cx_all(&self, a: &[Expr]) -> Result<Vec<Cx>, ErrKind> {
        let mut out = Vec::new();
        for e in a {
            for v in self.grid(self.arg(e))?.data {
                out.push(match v {
                    Value::Error(k) => return Err(k),
                    Value::Bool(_) => return Err(ErrKind::Value),
                    Value::Number(n) => Cx { re: n, im: 0.0, suffix: 'i' },
                    o => parse_complex(&o.to_string())?,
                });
            }
        }
        Ok(out)
    }

    fn places(&self, a: &[Expr], i: usize) -> Result<Option<i64>, ErrKind> {
        match fx_text::given(a, i) {
            None => Ok(None),
            Some(e) => {
                let p = number_of(&self.scalar(e))?.trunc();
                if p < 1.0 {
                    return Err(ErrKind::Num);
                }
                Ok(Some(p as i64))
            }
        }
    }

    fn bits(&self, a: &[Expr], i: usize) -> Result<u64, ErrKind> {
        let x = self.n(a, i)?;
        if x < 0.0 || x.fract() != 0.0 || x >= 281_474_976_710_656.0 {
            return Err(ErrKind::Num);
        }
        Ok(x as u64)
    }

    pub(super) fn call_eng(&self, name: &str, a: &[Expr]) -> Option<Result<Value, ErrKind>> {
        if !NAMES.contains(&name) {
            return None;
        }
        Some((|| {
            Ok(match name {
                "BIN2DEC" | "BIN2HEX" | "BIN2OCT" | "DEC2BIN" | "DEC2HEX" | "DEC2OCT" | "HEX2BIN" | "HEX2DEC" | "HEX2OCT" | "OCT2BIN" | "OCT2DEC" | "OCT2HEX" => {
                    let (from, to) = (&name[..3], &name[4..]);
                    if a.is_empty() || a.len() > if to == "DEC" { 1 } else { 2 } {
                        return Err(ErrKind::Na);
                    }
                    let base = |s: &str| match s {
                        "BIN" => 2,
                        "OCT" => 8,
                        "DEC" => 10,
                        _ => 16,
                    };
                    let n = if from == "DEC" {
                        let x = self.n(a, 0)?.trunc();
                        if x.abs() > 1e12 {
                            return Err(ErrKind::Num);
                        }
                        x as i64
                    } else {
                        parse_base(&digits_of(&self.scalar(&a[0]))?, base(from))?
                    };
                    if to == "DEC" {
                        return Ok(Value::Number(n as f64));
                    }
                    Value::Text(write_base(n, base(to), self.places(a, 1)?)?)
                }
                "BITAND" | "BITOR" | "BITXOR" => {
                    if a.len() != 2 {
                        return Err(ErrKind::Na);
                    }
                    let (x, y) = (self.bits(a, 0)?, self.bits(a, 1)?);
                    Value::Number(match name {
                        "BITAND" => x & y,
                        "BITOR" => x | y,
                        _ => x ^ y,
                    } as f64)
                }
                "BITLSHIFT" | "BITRSHIFT" => {
                    if a.len() != 2 {
                        return Err(ErrKind::Na);
                    }
                    let x = self.bits(a, 0)?;
                    let s = self.n(a, 1)?.trunc();
                    if s.abs() > 53.0 {
                        return Err(ErrKind::Num);
                    }
                    let left = (name == "BITLSHIFT") == (s >= 0.0);
                    let k = s.abs() as u32;
                    let r = if left { x.checked_shl(k).unwrap_or(u64::MAX) } else { x >> k };
                    if r >= 1 << 48 {
                        return Err(ErrKind::Num);
                    }
                    Value::Number(r as f64)
                }
                "DELTA" => Value::Number(f64::from(u8::from(self.n(a, 0)? == self.n(a, 1)?))),
                "GESTEP" => Value::Number(f64::from(u8::from(self.n(a, 0)? >= self.n(a, 1)?))),
                "ERF" => {
                    if a.is_empty() || a.len() > 2 {
                        return Err(ErrKind::Na);
                    }
                    let lo = self.n(a, 0)?;
                    num(if a.len() == 2 { erf(self.n(a, 1)?) - erf(lo) } else { erf(lo) })
                }
                "ERF.PRECISE" => num(erf(self.n(a, 0)?)),
                "ERFC" | "ERFC.PRECISE" => num(erfc(self.n(a, 0)?)),
                "CONVERT" => {
                    if a.len() != 3 {
                        return Err(ErrKind::Na);
                    }
                    num(convert(self.n(a, 0)?, &self.t(a, 1)?, &self.t(a, 2)?)?)
                }
                "BESSELJ" => {
                    if a.len() != 2 {
                        return Err(ErrKind::Na);
                    }
                    let (x, n) = (self.n(a, 0)?, self.n(a, 1)?.trunc());
                    if n < 0.0 {
                        return Err(ErrKind::Num);
                    }
                    num(bessel_j(x, n as i64))
                }
                "COMPLEX" => {
                    if a.len() < 2 || a.len() > 3 {
                        return Err(ErrKind::Na);
                    }
                    let suffix = if fx_text::given(a, 2).is_some() { self.t(a, 2)? } else { "i".to_string() };
                    if suffix != "i" && suffix != "j" {
                        return Err(ErrKind::Value);
                    }
                    Value::Text(show(Cx { re: self.n(a, 0)?, im: self.n(a, 1)?, suffix: suffix.chars().next().unwrap_or('i') }))
                }
                "IMREAL" => num(self.cx(a, 0)?.re),
                "IMAGINARY" => num(self.cx(a, 0)?.im),
                "IMABS" => num(self.cx(a, 0).map(|c| c.re.hypot(c.im))?),
                "IMSUM" | "IMPRODUCT" => {
                    let list = self.cx_all(a)?;
                    if list.is_empty() {
                        return Err(ErrKind::Na);
                    }
                    let mut seen = list.iter().filter(|x| x.im != 0.0).map(|x| x.suffix);
                    let suffix = seen.next().unwrap_or('i');
                    if seen.any(|s| s != suffix) {
                        return Err(ErrKind::Value);
                    }
                    let mut acc = Cx { re: if name == "IMSUM" { 0.0 } else { 1.0 }, im: 0.0, suffix };
                    for c in &list {
                        acc =if name == "IMSUM" { Cx { re: acc.re + c.re, im: acc.im + c.im, suffix: acc.suffix } } else { Cx { re: acc.re * c.re - acc.im * c.im, im: acc.re * c.im + acc.im * c.re, suffix: acc.suffix } };
                    }
                    Value::Text(show(acc))
                }
                "IMSUB" => {
                    let (x, y) = (self.cx(a, 0)?, self.cx(a, 1)?);
                    Value::Text(show(Cx { re: x.re - y.re, im: x.im - y.im, suffix: if x.im != 0.0 { x.suffix } else { y.suffix } }))
                }
                "IMDIV" => {
                    let (x, y) = (self.cx(a, 0)?, self.cx(a, 1)?);
                    let d = y.re * y.re + y.im * y.im;
                    if d == 0.0 {
                        return Err(ErrKind::Num);
                    }
                    Value::Text(show(Cx { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d, suffix: if x.im != 0.0 { x.suffix } else { y.suffix } }))
                }
                _ => return Err(ErrKind::Name),
            })
        })())
    }
}

pub(super) const NAMES: [&str; 33] = [
    "BIN2DEC", "BIN2HEX", "BIN2OCT", "DEC2BIN", "DEC2HEX", "DEC2OCT", "HEX2BIN", "HEX2DEC", "HEX2OCT", "OCT2BIN", "OCT2DEC", "OCT2HEX", "BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT", "DELTA", "GESTEP", "ERF", "ERF.PRECISE",
    "ERFC", "ERFC.PRECISE", "CONVERT", "BESSELJ", "COMPLEX", "IMREAL", "IMAGINARY", "IMABS", "IMSUM", "IMSUB", "IMPRODUCT", "IMDIV",
];
