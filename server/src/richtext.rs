//! Sanitising of the rich text carried by titles and descriptions.
//!
//! These fields became rich text (bold/italic/underline/link/lists) edited in the
//! browser. A form is meant to be SHARED publicly, so unfiltered HTML would let
//! its owner run script in every respondent's page. Everything is therefore
//! cleaned on the way in — storing safe data means every renderer is safe, not
//! just the ones that remember to escape.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

fn cleaner() -> &'static ammonia::Builder<'static> {
    static C: OnceLock<ammonia::Builder<'static>> = OnceLock::new();
    C.get_or_init(|| {
        let mut b = ammonia::Builder::default();
        // Exactly what the editor's toolbar can produce.
        b.tags(HashSet::from(["b", "strong", "i", "em", "u", "a", "br", "ul", "ol", "li", "span"]));
        b.tag_attributes(HashMap::from([("a", HashSet::from(["href", "title"]))]));
        b.url_schemes(HashSet::from(["http", "https", "mailto"]));
        // Anything opened from a form must not keep a handle on it.
        b.link_rel(Some("noopener noreferrer nofollow"));
        b.strip_comments(true);
        b
    })
}

/// Clean a rich-text fragment. Returns None for an empty result, so a field
/// emptied in the editor is stored as NULL rather than as an empty tag soup.
pub fn clean(html: &str) -> Option<String> {
    let out = cleaner().clean(html).to_string();
    let bare = out.replace("<br>", "").replace("&nbsp;", " ");
    let text_only = bare
        .split(['<', '>'])
        .step_by(2)
        .collect::<String>();
    if text_only.trim().is_empty() && !out.contains("<li") { None } else { Some(out) }
}

/// Same, for a required field: never returns None, falls back to the raw text.
pub fn clean_required(html: &str, fallback: &str) -> String {
    clean(html).unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_formatting_and_links() {
        let out = clean("<b>Vos</b> <i>coordonnées</i> <a href=\"https://ex.fr\">ici</a>").unwrap();
        assert!(out.contains("<b>Vos</b>"));
        assert!(out.contains("<i>coordonnées</i>"));
        assert!(out.contains("href=\"https://ex.fr\""));
    }

    #[test]
    fn drops_script_and_handlers() {
        let out = clean("<b>ok</b><script>alert(1)</script><img src=x onerror=alert(1)>").unwrap();
        assert!(!out.contains("script"));
        assert!(!out.contains("onerror"));
        assert!(out.contains("<b>ok</b>"));
    }

    #[test]
    fn rejects_javascript_urls() {
        let out = clean("<a href=\"javascript:alert(1)\">x</a>").unwrap();
        assert!(!out.contains("javascript"));
    }

    #[test]
    fn empty_becomes_none() {
        assert!(clean("").is_none());
        assert!(clean("<br>").is_none());
        assert!(clean("   ").is_none());
    }
}
