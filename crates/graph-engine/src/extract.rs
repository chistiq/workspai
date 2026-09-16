//! Deterministic matrix declaration scan.
//!
//! This primitive owns no Graph identity, proof or authority semantics. The
//! TypeScript extractor remains the product authority; this implementation
//! exists only as a parity-gated acceleration candidate.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Language {
    Unspecified,
    Node,
    Python,
    Go,
    Java,
    Dotnet,
    Rust,
    CCpp,
    ObjectiveCMatlab,
    Php,
    Ruby,
    Swift,
    Elixir,
    Kotlin,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DeclarationKind {
    Function,
    Type,
    Value,
    Method,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Declaration {
    pub name: String,
    pub kind: DeclarationKind,
    pub line: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExtractError {
    InvalidLanguage,
    SourceTooLarge,
    TooManyDeclarations,
}

pub const MAX_DECLARATION_SOURCE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_DECLARATIONS: usize = 16_384;
pub const LANGUAGE_UNSPECIFIED: u32 = 255;

const HASH_COMMENT_LANGUAGES: &[Language] = &[Language::Python, Language::Ruby, Language::Elixir];
const CONTROL_START: &[&str] = &[
    "alignof",
    "assert",
    "case",
    "catch",
    "delete",
    "elif",
    "else",
    "ensure",
    "for",
    "goto",
    "if",
    "new",
    "offsetof",
    "rescue",
    "return",
    "sizeof",
    "static_assert",
    "switch",
    "throw",
    "typedef",
    "unless",
    "until",
    "using",
    "when",
    "while",
];

impl Language {
    pub fn from_abi(code: u32) -> Result<Self, ExtractError> {
        Ok(match code {
            LANGUAGE_UNSPECIFIED => Self::Unspecified,
            0 => Self::Node,
            1 => Self::Python,
            2 => Self::Go,
            3 => Self::Java,
            4 => Self::Dotnet,
            5 => Self::Rust,
            6 => Self::CCpp,
            7 => Self::ObjectiveCMatlab,
            8 => Self::Php,
            9 => Self::Ruby,
            10 => Self::Swift,
            11 => Self::Elixir,
            12 => Self::Kotlin,
            _ => return Err(ExtractError::InvalidLanguage),
        })
    }

    pub const fn abi_code(self) -> u32 {
        match self {
            Self::Unspecified => LANGUAGE_UNSPECIFIED,
            Self::Node => 0,
            Self::Python => 1,
            Self::Go => 2,
            Self::Java => 3,
            Self::Dotnet => 4,
            Self::Rust => 5,
            Self::CCpp => 6,
            Self::ObjectiveCMatlab => 7,
            Self::Php => 8,
            Self::Ruby => 9,
            Self::Swift => 10,
            Self::Elixir => 11,
            Self::Kotlin => 12,
        }
    }

    fn uses_hash_comments(self) -> bool {
        HASH_COMMENT_LANGUAGES.contains(&self)
    }

    fn uses_typed_functions(self) -> bool {
        matches!(self, Self::CCpp | Self::Java | Self::Dotnet)
    }
}

impl DeclarationKind {
    pub const fn abi_code(self) -> u32 {
        match self {
            Self::Function => 0,
            Self::Type => 1,
            Self::Value => 2,
            Self::Method => 3,
        }
    }
}

impl ExtractError {
    #[cfg(target_arch = "wasm32")]
    pub const fn abi_code(self) -> i32 {
        match self {
            Self::InvalidLanguage => -11,
            Self::SourceTooLarge => -12,
            Self::TooManyDeclarations => -13,
        }
    }
}

/// Line-oriented declaration scan matching the TypeScript matrix extractor.
pub fn extract_declarations(
    source: &str,
    language: Language,
) -> Result<Vec<Declaration>, ExtractError> {
    if source.len() > MAX_DECLARATION_SOURCE_BYTES {
        return Err(ExtractError::SourceTooLarge);
    }
    let stripped = strip_comments(source, language);
    let mut findings = Vec::new();
    for (index, line) in split_js_lines(&stripped).into_iter().enumerate() {
        let line_number = u32::try_from(index + 1).unwrap_or(u32::MAX);
        if let Some((name, kind)) = match_keyword_declaration(line) {
            findings.push(Declaration {
                name,
                kind,
                line: line_number,
            });
            continue;
        }
        if language.uses_typed_functions() {
            if let Some(name) = match_typed_function(line) {
                findings.push(Declaration {
                    name,
                    kind: DeclarationKind::Function,
                    line: line_number,
                });
            }
        }
    }
    if findings.len() > MAX_DECLARATIONS {
        return Err(ExtractError::TooManyDeclarations);
    }
    Ok(findings)
}

fn strip_comments(source: &str, language: Language) -> String {
    let without_blocks = if language.uses_hash_comments() {
        source.to_owned()
    } else {
        strip_c_block_comments(source)
    };
    split_js_lines(&without_blocks)
        .into_iter()
        .map(|line| {
            let trimmed = ltrim_js(line);
            if language.uses_hash_comments() && trimmed.starts_with('#') {
                ""
            } else if !language.uses_hash_comments() && trimmed.starts_with("//") {
                ""
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn strip_c_block_comments(source: &str) -> String {
    let bytes = source.as_bytes();
    let mut output = String::with_capacity(source.len());
    let mut index = 0;
    while index < bytes.len() {
        if index + 1 < bytes.len() && bytes[index] == b'/' && bytes[index + 1] == b'*' {
            if let Some(close) = find_block_comment_end(bytes, index + 2) {
                index = close + 2;
                continue;
            }
            output.push_str(&source[index..]);
            break;
        }
        let next = source[index..].chars().next().expect("valid utf-8");
        output.push(next);
        index += next.len_utf8();
    }
    output
}

fn find_block_comment_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut index = start;
    while index + 1 < bytes.len() {
        if bytes[index] == b'*' && bytes[index + 1] == b'/' {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn split_js_lines(source: &str) -> Vec<&str> {
    let bytes = source.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\n' {
            let end = if index > start && bytes[index - 1] == b'\r' {
                index - 1
            } else {
                index
            };
            lines.push(&source[start..end]);
            index += 1;
            start = index;
        } else {
            index += 1;
        }
    }
    lines.push(&source[start..]);
    lines
}

fn match_keyword_declaration(line: &str) -> Option<(String, DeclarationKind)> {
    let rest = ltrim_js(line);
    if let Some(name) = match_export_async_function(rest) {
        return Some((last_identifier(&name), DeclarationKind::Function));
    }
    if let Some(name) = match_export_abstract_type(rest) {
        return Some((last_identifier(&name), DeclarationKind::Type));
    }
    if let Some(name) = match_export_declare_value(rest) {
        return Some((last_identifier(&name), DeclarationKind::Value));
    }
    if let Some(name) = match_def(rest) {
        return Some((last_identifier(&name), DeclarationKind::Function));
    }
    if let Some(name) = match_defmodule(rest) {
        return Some((last_identifier(&name), DeclarationKind::Type));
    }
    if let Some(name) = match_go_func(rest) {
        return Some((last_identifier(&name), DeclarationKind::Function));
    }
    if let Some(name) = match_kotlin_fun(rest) {
        return Some((last_identifier(&name), DeclarationKind::Function));
    }
    if let Some(name) = match_swift_func(rest) {
        return Some((last_identifier(&name), DeclarationKind::Function));
    }
    if let Some(name) = match_rust_fn(rest) {
        return Some((last_identifier(&name), DeclarationKind::Function));
    }
    if let Some(name) = match_rust_type(rest) {
        return Some((last_identifier(&name), DeclarationKind::Type));
    }
    if let Some(name) = match_nominal_type(rest) {
        return Some((last_identifier(&name), DeclarationKind::Type));
    }
    if let Some(name) = match_objc_type(rest) {
        return Some((last_identifier(&name), DeclarationKind::Type));
    }
    if let Some(name) = match_objc_method(rest) {
        return Some((last_identifier(&name), DeclarationKind::Method));
    }
    if let Some(name) = match_php_function(rest) {
        return Some((last_identifier(&name), DeclarationKind::Function));
    }
    None
}

fn match_export_async_function(rest: &str) -> Option<String> {
    let rest = optional_keyword_ws(rest, "export")?;
    let rest = optional_keyword_ws(rest, "async")?;
    let rest = require_keyword_ws(rest, "function")?;
    take_ident_dollar(rest).map(|(name, _)| name.to_owned())
}

fn match_export_abstract_type(rest: &str) -> Option<String> {
    let rest = optional_keyword_ws(rest, "export")?;
    let rest = optional_keyword_ws(rest, "abstract")?;
    let rest = require_one_keyword_ws(rest, &["class", "interface", "enum", "type"])?;
    take_ident_dollar(rest).map(|(name, _)| name.to_owned())
}

fn match_export_declare_value(rest: &str) -> Option<String> {
    let rest = optional_keyword_ws(rest, "export")?;
    let rest = optional_keyword_ws(rest, "declare")?;
    let rest = require_one_keyword_ws(rest, &["const", "let", "var"])?;
    take_ident_dollar(rest).map(|(name, _)| name.to_owned())
}

fn match_def(rest: &str) -> Option<String> {
    let rest = optional_keyword_ws(rest, "async")?;
    let rest = require_keyword_ws(rest, "def")?;
    let (name, tail) = take_ident(rest)?;
    let mut name = name.to_owned();
    if let Some(mark) = tail.chars().next() {
        if mark == '!' || mark == '?' {
            name.push(mark);
        }
    }
    Some(name)
}

fn match_defmodule(rest: &str) -> Option<String> {
    let rest = require_keyword_ws(rest, "defmodule")?;
    take_elixir_module(rest).map(|(name, _)| name.to_owned())
}

fn match_go_func(rest: &str) -> Option<String> {
    let rest = require_keyword_ws(rest, "func")?;
    let rest = ltrim_js(optional_paren_group(rest));
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_kotlin_fun(rest: &str) -> Option<String> {
    let rest = zero_or_more_keywords_ws(
        rest,
        &[
            "public",
            "private",
            "internal",
            "protected",
            "open",
            "override",
        ],
    );
    let rest = require_keyword_ws(rest, "fun")?;
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_swift_func(rest: &str) -> Option<String> {
    let rest =
        zero_or_more_keywords_ws(rest, &["public", "private", "internal", "open", "override"]);
    let rest = require_keyword_ws(rest, "func")?;
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_rust_fn(rest: &str) -> Option<String> {
    let rest = optional_rust_visibility(rest);
    let rest = optional_keyword_ws(rest, "async")?;
    let rest = require_keyword_ws(rest, "fn")?;
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_rust_type(rest: &str) -> Option<String> {
    let rest = optional_rust_visibility(rest);
    let rest = require_one_keyword_ws(rest, &["struct", "trait", "enum", "type"])?;
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_nominal_type(rest: &str) -> Option<String> {
    let rest = zero_or_more_keywords_ws(
        rest,
        &[
            "public",
            "private",
            "protected",
            "internal",
            "abstract",
            "final",
            "open",
            "data",
            "sealed",
            "value",
        ],
    );
    let rest = require_one_keyword_ws(
        rest,
        &[
            "class",
            "interface",
            "record",
            "enum",
            "object",
            "struct",
            "protocol",
            "actor",
            "mixin",
            "module",
        ],
    )?;
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_objc_type(rest: &str) -> Option<String> {
    if !rest.starts_with('@') {
        return None;
    }
    let rest = &rest[1..];
    let rest = require_one_keyword_ws(rest, &["interface", "implementation", "protocol"])?;
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_objc_method(rest: &str) -> Option<String> {
    let rest = ltrim_js(rest);
    let first = rest.chars().next()?;
    if first != '-' && first != '+' {
        return None;
    }
    let rest = ltrim_js(&rest[first.len_utf8()..]);
    let rest = require_paren_group(rest)?;
    let rest = ltrim_js(rest);
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_php_function(rest: &str) -> Option<String> {
    let rest = if let Some(after) = require_keyword_ws(rest, "public") {
        after
    } else if let Some(after) = require_keyword_ws(rest, "private") {
        after
    } else if let Some(after) = require_keyword_ws(rest, "protected") {
        after
    } else {
        rest
    };
    let rest = require_keyword_ws(rest, "function")?;
    take_ident(rest).map(|(name, _)| name.to_owned())
}

fn match_typed_function(line: &str) -> Option<String> {
    let trimmed = ltrim_js(line);
    if matches_control_start(trimmed) {
        return None;
    }
    let rest = optional_template(trimmed).unwrap_or(trimmed);
    let mut cursor = rest;
    let mut tokens = 0;
    while tokens < 8 {
        let Some((_token, after_token)) = take_type_token(cursor) else {
            break;
        };
        let Some(after_ws) = take_required_ws(after_token) else {
            break;
        };
        tokens += 1;
        cursor = after_ws;
        if let Some(name) = finish_typed_name(cursor) {
            return Some(name);
        }
    }
    None
}

fn finish_typed_name(rest: &str) -> Option<String> {
    let (name, after_name) = take_qualified_ident(rest)?;
    let after_ws = ltrim_js(after_name);
    if !after_ws.starts_with('(') {
        return None;
    }
    if matches_control_start(&name) {
        return None;
    }
    Some(last_identifier(&name))
}

fn optional_template(rest: &str) -> Option<&str> {
    let Some(after) = consume_keyword(rest, "template") else {
        return Some(rest);
    };
    let after = ltrim_js(after);
    if !after.starts_with('<') {
        return None;
    }
    let bytes = after.as_bytes();
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b';' | b'{' | b'}' => return None,
            b'>' => {
                let close = index + 1;
                return Some(ltrim_js(&after[close..]));
            }
            _ => index += 1,
        }
    }
    None
}

fn optional_rust_visibility(rest: &str) -> &str {
    let Some(after) = consume_keyword(rest, "pub") else {
        return rest;
    };
    let after_parens = optional_paren_group(after);
    take_required_ws(after_parens).unwrap_or(rest)
}

fn optional_paren_group(rest: &str) -> &str {
    require_paren_group(rest).unwrap_or(rest)
}

fn require_paren_group(rest: &str) -> Option<&str> {
    if !rest.starts_with('(') {
        return None;
    }
    let close = rest.find(')')?;
    Some(&rest[close + 1..])
}

fn optional_keyword_ws<'a>(rest: &'a str, keyword: &str) -> Option<&'a str> {
    match consume_keyword(rest, keyword) {
        Some(after) => Some(take_required_ws(after).unwrap_or(rest)),
        None => Some(rest),
    }
}

fn require_keyword_ws<'a>(rest: &'a str, keyword: &str) -> Option<&'a str> {
    take_required_ws(consume_keyword(rest, keyword)?)
}

fn require_one_keyword_ws<'a>(rest: &'a str, keywords: &[&str]) -> Option<&'a str> {
    for keyword in keywords {
        if let Some(after) = require_keyword_ws(rest, keyword) {
            return Some(after);
        }
    }
    None
}

fn zero_or_more_keywords_ws<'a>(mut rest: &'a str, keywords: &[&str]) -> &'a str {
    loop {
        let mut matched = false;
        for keyword in keywords {
            if let Some(after) = require_keyword_ws(rest, keyword) {
                rest = after;
                matched = true;
                break;
            }
        }
        if !matched {
            return rest;
        }
    }
}

fn consume_keyword<'a>(rest: &'a str, keyword: &str) -> Option<&'a str> {
    if !rest.starts_with(keyword) {
        return None;
    }
    let after = &rest[keyword.len()..];
    if after
        .chars()
        .next()
        .is_some_and(|char| is_word(char) || char == '$')
    {
        return None;
    }
    Some(after)
}

fn matches_control_start(rest: &str) -> bool {
    CONTROL_START
        .iter()
        .any(|keyword| consume_keyword(rest, keyword).is_some())
}

fn take_ident(rest: &str) -> Option<(&str, &str)> {
    take_ident_with(rest, false)
}

fn take_ident_dollar(rest: &str) -> Option<(&str, &str)> {
    take_ident_with(rest, true)
}

fn take_ident_with(rest: &str, dollar: bool) -> Option<(&str, &str)> {
    let mut chars = rest.char_indices();
    let (_, first) = chars.next()?;
    if !first.is_ascii_alphabetic() && first != '_' && !(dollar && first == '$') {
        return None;
    }
    let mut end = first.len_utf8();
    for (index, char) in chars {
        if is_word(char) || (dollar && char == '$') {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    Some((&rest[..end], &rest[end..]))
}

fn take_qualified_ident(rest: &str) -> Option<(String, &str)> {
    let (first, mut tail) = take_ident(rest)?;
    let mut name = first.to_owned();
    while tail.starts_with("::") {
        let after = &tail[2..];
        let Some((next, rest_after)) = take_ident(after) else {
            break;
        };
        name.push_str("::");
        name.push_str(next);
        tail = rest_after;
    }
    Some((name, tail))
}

fn take_elixir_module(rest: &str) -> Option<(&str, &str)> {
    let mut chars = rest.char_indices();
    let (_, first) = chars.next()?;
    if !first.is_ascii_uppercase() {
        return None;
    }
    let mut end = first.len_utf8();
    for (index, char) in chars {
        if is_word(char) || char == '.' {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    Some((&rest[..end], &rest[end..]))
}

fn take_type_token(rest: &str) -> Option<(&str, &str)> {
    let mut chars = rest.char_indices();
    let (_, first) = chars.next()?;
    if !is_type_token_char(first) {
        return None;
    }
    let mut end = first.len_utf8();
    for (index, char) in chars {
        if is_type_token_char(char) {
            end = index + char.len_utf8();
        } else {
            break;
        }
    }
    Some((&rest[..end], &rest[end..]))
}

fn is_type_token_char(char: char) -> bool {
    is_word(char)
        || matches!(
            char,
            ':' | '@' | '*' | '&' | '<' | '>' | ',' | '.' | '[' | ']' | '?'
        )
}

fn take_required_ws(rest: &str) -> Option<&str> {
    let trimmed = ltrim_js(rest);
    if trimmed.len() == rest.len() {
        None
    } else {
        Some(trimmed)
    }
}

fn ltrim_js(value: &str) -> &str {
    value.trim_start_matches(is_js_whitespace)
}

fn last_identifier(name: &str) -> String {
    name.rsplit("::").next().unwrap_or(name).to_owned()
}

fn is_word(char: char) -> bool {
    char.is_ascii_alphanumeric() || char == '_'
}

fn is_js_whitespace(char: char) -> bool {
    matches!(
        char,
        '\t' | '\n' | '\u{000B}' | '\u{000C}' | '\r' | ' ' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(source: &str, language: Language) -> Vec<String> {
        extract_declarations(source, language)
            .expect("valid source")
            .into_iter()
            .map(|item| item.name)
            .collect()
    }

    #[test]
    fn extracts_one_declaration_per_official_offline_language() {
        assert!(
            names("export function listItems(): void {}\n", Language::Node)
                .contains(&"listItems".into())
        );
        assert!(names("def list_items():\n    return 1\n", Language::Python)
            .contains(&"list_items".into()));
        assert!(
            names("package a\nfunc ListItems() {}\n", Language::Go).contains(&"ListItems".into())
        );
        assert!(names(
            "class ListItems {\n    String health() { return \"ok\"; }\n}\n",
            Language::Java
        )
        .contains(&"ListItems".into()));
        assert!(names(
            "class ListItems {\n    public static string Status() => \"ok\";\n}\n",
            Language::Dotnet
        )
        .contains(&"ListItems".into()));
        assert!(names("fn list_items() {}\n", Language::Rust).contains(&"list_items".into()));
        assert!(names("int list_items() { return 0; }\n", Language::CCpp)
            .contains(&"list_items".into()));
        assert!(names(
            "@interface ListItems : NSObject\n- (NSString *)health;\n@end\n",
            Language::ObjectiveCMatlab
        )
        .contains(&"ListItems".into()));
        assert!(names(
            "<?php\nfunction list_items(): string { return \"ok\"; }\n",
            Language::Php
        )
        .contains(&"list_items".into()));
        assert!(
            names("def list_items\n  'ok'\nend\n", Language::Ruby).contains(&"list_items".into())
        );
        assert!(
            names("func listItems() -> String { \"ok\" }\n", Language::Swift)
                .contains(&"listItems".into())
        );
        assert!(names(
            "defmodule ListItems do\n  def health(), do: :ok\nend\n",
            Language::Elixir
        )
        .contains(&"ListItems".into()));
        assert!(names(
            "class ListItems {\n  fun health() = \"ok\"\n}\n",
            Language::Kotlin
        )
        .contains(&"ListItems".into()));
    }

    #[test]
    fn does_not_invent_control_flow_or_unspecified_imports() {
        assert_eq!(
            names(
                "int ready() { return 1; }\nif (ready()) { return; }\n",
                Language::CCpp
            ),
            vec!["ready".to_owned()]
        );
        assert_eq!(
            extract_declarations(
                "import 'package:billing/core.dart';\n",
                Language::Unspecified
            )
            .expect("valid source"),
            Vec::new()
        );
        assert_eq!(
            names(
                "export function startStorefront(): void {\n  return {\n    catalog: handleCatalogRequest('storefront'),\n  };\n}\n",
                Language::Node
            ),
            vec!["startStorefront".to_owned()]
        );
    }

    #[test]
    fn rejects_oversized_source() {
        let source = "a".repeat(MAX_DECLARATION_SOURCE_BYTES + 1);
        assert_eq!(
            extract_declarations(&source, Language::Node),
            Err(ExtractError::SourceTooLarge)
        );
    }

    #[test]
    fn language_abi_codes_match_the_official_offline_matrix_order() {
        assert_eq!(
            Language::from_abi(LANGUAGE_UNSPECIFIED).unwrap(),
            Language::Unspecified
        );
        assert_eq!(Language::Node.abi_code(), 0);
        assert_eq!(Language::Kotlin.abi_code(), 12);
        assert_eq!(DeclarationKind::Function.abi_code(), 0);
        assert_eq!(DeclarationKind::Method.abi_code(), 3);
        assert!(Language::from_abi(99).is_err());
    }
}
