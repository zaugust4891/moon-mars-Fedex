//! Minimal JSON writer. Output-only; inputs to the engine are scalars across FFI,
//! so no parser is needed. Numbers are written with enough precision for
//! engineering use while keeping trajectory payloads compact.

pub fn num(x: f64) -> String {
    if !x.is_finite() {
        return "null".into();
    }
    // 6 significant-ish digits via shortest reasonable form
    let a = x.abs();
    let s = if a == 0.0 {
        "0".to_string()
    } else if a >= 1e7 || a < 1e-4 {
        format!("{:e}", x)
    } else {
        let s = format!("{:.6}", x);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    };
    if s.is_empty() { "0".into() } else { s }
}

pub fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

pub fn arr_f(xs: &[f64]) -> String {
    let mut out = String::from("[");
    for (i, x) in xs.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&num(*x));
    }
    out.push(']');
    out
}

/// Array of [x, y] points
pub fn arr_xy(pts: &[(f64, f64)]) -> String {
    let mut out = String::from("[");
    for (i, p) in pts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&format!("[{},{}]", num(p.0), num(p.1)));
    }
    out.push(']');
    out
}

pub fn arr_s(items: &[String]) -> String {
    let mut out = String::from("[");
    for (i, s) in items.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(s);
    }
    out.push(']');
    out
}

pub fn arr_str(items: &[String]) -> String {
    let strs: Vec<String> = items.iter().map(|s| esc(s)).collect();
    arr_s(&strs)
}

/// Build an object from (key, already-serialized-value) pairs
pub fn obj(fields: &[(&str, String)]) -> String {
    let mut out = String::from("{");
    for (i, (k, v)) in fields.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&esc(k));
        out.push(':');
        out.push_str(v);
    }
    out.push('}');
    out
}
