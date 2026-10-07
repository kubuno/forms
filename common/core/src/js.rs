//! The few JavaScript coercions the conditional logic relies on, reproduced exactly so that the server and the
//! web client (`frontend/src/logic.ts`) reach the same verdicts: `String(v)`, `Array.prototype.join`,
//! `String.prototype.trim`, `Number(string)` and `Number.prototype.toString`.

use serde_json::Value;

/// `true` for the characters `String.prototype.trim` removes (ECMAScript WhiteSpace and LineTerminator).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// `s.trim()`.
pub fn trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// `Number(n).toString()` for a finite or non-finite double.
pub fn number_to_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x == 0.0 {
        return "0".into();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // Shortest round-trip digits, in scientific form: d[.ddd]e<exp>.
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = match sci.split_once('e') {
        Some(parts) => parts,
        None => return format!("{x}"),
    };
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let e: i64 = exp.parse().unwrap_or(0);
    let k = digits.len() as i64;
    let n = e + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let exp_sign = if n > 0 { "+" } else { "-" };
        if k == 1 {
            format!("{digits}e{exp_sign}{}", (n - 1).abs())
        } else {
            format!("{}.{}e{exp_sign}{}", &digits[..1], &digits[1..], (n - 1).abs())
        }
    };
    format!("{sign}{body}")
}

/// The double a JSON number denotes in JavaScript.
pub fn json_number(n: &serde_json::Number) -> f64 {
    n.as_f64().unwrap_or(f64::NAN)
}

/// `String(v)` (`null` -> `"null"`, arrays joined with `,`, objects -> `"[object Object]"`).
pub fn to_js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => number_to_string(json_number(n)),
        Value::String(s) => s.clone(),
        Value::Array(a) => join(a),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// `array.join(',')`: `null` elements become empty strings.
pub fn join(a: &[Value]) -> String {
    a.iter()
        .map(|v| match v {
            Value::Null => String::new(),
            other => to_js_string(other),
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// `Number(s)` for a string; `None` for `NaN`.
pub fn string_to_number(s: &str) -> Option<f64> {
    let t = trim(s);
    if t.is_empty() {
        return Some(0.0);
    }
    match t {
        "Infinity" | "+Infinity" => return Some(f64::INFINITY),
        "-Infinity" => return Some(f64::NEG_INFINITY),
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(rest) = t.strip_prefix(prefix) {
            if rest.is_empty() || !rest.chars().all(|c| c.is_digit(radix)) {
                return None;
            }
            let mut value = 0f64;
            for c in rest.chars() {
                value = value * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0));
            }
            return Some(value);
        }
    }
    // StrDecimalLiteral: [+-] (digits [. digits?] | . digits) [(e|E) [+-] digits]
    let bytes = t.as_bytes();
    let mut i = 0;
    if matches!(bytes.first(), Some(b'+' | b'-')) {
        i += 1;
    }
    let int_start = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    let mut mantissa_digits = i - int_start;
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        let frac_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        mantissa_digits += i - frac_start;
    }
    if mantissa_digits == 0 {
        return None;
    }
    if i < bytes.len() && matches!(bytes[i], b'e' | b'E') {
        i += 1;
        if i < bytes.len() && matches!(bytes[i], b'+' | b'-') {
            i += 1;
        }
        let exp_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == exp_start {
            return None;
        }
    }
    if i != bytes.len() {
        return None;
    }
    t.parse::<f64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn numbers_print_like_javascript() {
        let cases: &[(f64, &str)] = &[
            (1.0, "1"),
            (-1.5, "-1.5"),
            (0.1, "0.1"),
            (100.0, "100"),
            (1e21, "1e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e-7, "1e-7"),
            (0.000001, "0.000001"),
            (1.5e-7, "1.5e-7"),
            (2.5e25, "2.5e+25"),
            (-0.0, "0"),
        ];
        for (x, s) in cases {
            assert_eq!(number_to_string(*x), *s, "{x}");
        }
    }

    #[test]
    fn strings_parse_like_number() {
        assert_eq!(string_to_number(" 12 "), Some(12.0));
        assert_eq!(string_to_number("1e3"), Some(1000.0));
        assert_eq!(string_to_number(".5"), Some(0.5));
        assert_eq!(string_to_number("5."), Some(5.0));
        assert_eq!(string_to_number("0x1F"), Some(31.0));
        assert_eq!(string_to_number("-Infinity"), Some(f64::NEG_INFINITY));
        assert_eq!(string_to_number("inf"), None);
        assert_eq!(string_to_number("NaN"), None);
        assert_eq!(string_to_number("1_000"), None);
        assert_eq!(string_to_number("-0x10"), None);
        assert_eq!(string_to_number("12abc"), None);
        assert_eq!(string_to_number("\u{00A0}7\u{FEFF}"), Some(7.0));
    }

    #[test]
    fn string_conversion() {
        assert_eq!(to_js_string(&json!(null)), "null");
        assert_eq!(to_js_string(&json!([1, null, "a", [2, 3]])), "1,,a,2,3");
        assert_eq!(to_js_string(&json!({ "a": 1 })), "[object Object]");
        assert_eq!(to_js_string(&json!(2.0)), "2");
        assert_eq!(trim("\u{3000} a \u{2028}"), "a");
        assert_eq!(trim("\u{0085}a"), "\u{0085}a");
    }
}
