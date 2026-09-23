//! Compact fact canonicalization.
//!
//! The binary input is `workspai.graph-compact-fact.v1`. This kernel emits the
//! same JSON string the TypeScript reference builds for one semantic fact. It
//! does not sort facts: JavaScript `localeCompare` remains the digest order.

use std::str;

pub const COMPACT_FACT_MAGIC: &[u8; 4] = b"WGF1";
pub const COMPACT_FACT_VERSION: u32 = 1;
pub const MAX_COMPACT_FACTS: usize = 8_192;
pub const MAX_COMPACT_STRINGS: usize = 262_144;
pub const MAX_COMPACT_STRING_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_COMPACT_INPUT_BYTES: usize = 24 * 1024 * 1024;
pub const MAX_COMPACT_EVIDENCE: usize = 64;
pub const MAX_COMPACT_EXTENSIONS: usize = 16;
pub const MAX_COMPACT_LIFECYCLE: usize = 8;

const FLAG_EXTENSIONS: u32 = 1;
const FLAG_LITERAL_OBJECT: u32 = 2;
const FLAG_FRESHNESS_RENEWAL: u32 = 4;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ComposeError {
    Truncated,
    Limit,
    Invalid,
}

impl ComposeError {
    pub const fn abi_code(self) -> i32 {
        match self {
            Self::Truncated => -21,
            Self::Limit => -22,
            Self::Invalid => -23,
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub const COMPOSE_OUTPUT_TOO_SMALL: i32 = -26;

struct Reader<'a> {
    input: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn rest(&self) -> usize {
        self.input.len().saturating_sub(self.at)
    }

    fn u32(&mut self) -> Result<u32, ComposeError> {
        if self.rest() < 4 {
            return Err(ComposeError::Truncated);
        }
        let bytes: [u8; 4] = self.input[self.at..self.at + 4]
            .try_into()
            .map_err(|_| ComposeError::Truncated)?;
        self.at += 4;
        Ok(u32::from_le_bytes(bytes))
    }

    fn bytes(&mut self, length: usize) -> Result<&'a [u8], ComposeError> {
        if self.rest() < length {
            return Err(ComposeError::Truncated);
        }
        let slice = &self.input[self.at..self.at + length];
        self.at += length;
        Ok(slice)
    }
}

pub fn compose_fact_canonical(input: &[u8]) -> Result<Vec<String>, ComposeError> {
    if input.len() > MAX_COMPACT_INPUT_BYTES {
        return Err(ComposeError::Limit);
    }
    let mut reader = Reader { input, at: 0 };
    let magic = reader.bytes(4)?;
    if magic != COMPACT_FACT_MAGIC {
        return Err(ComposeError::Invalid);
    }
    if reader.u32()? != COMPACT_FACT_VERSION {
        return Err(ComposeError::Invalid);
    }
    let fact_count = reader.u32()? as usize;
    let string_count = reader.u32()? as usize;
    if fact_count > MAX_COMPACT_FACTS || string_count == 0 || string_count > MAX_COMPACT_STRINGS {
        return Err(ComposeError::Limit);
    }
    let mut strings = Vec::with_capacity(string_count);
    let mut string_bytes = 0usize;
    for _ in 0..string_count {
        let length = reader.u32()? as usize;
        string_bytes = string_bytes.saturating_add(length);
        if string_bytes > MAX_COMPACT_STRING_BYTES {
            return Err(ComposeError::Limit);
        }
        let bytes = reader.bytes(length)?;
        strings.push(str::from_utf8(bytes).map_err(|_| ComposeError::Invalid)?);
    }
    if strings.first() != Some(&"") {
        return Err(ComposeError::Invalid);
    }

    let mut facts = Vec::with_capacity(fact_count);
    for _ in 0..fact_count {
        facts.push(render_fact(&mut reader, &strings)?);
    }
    if reader.rest() != 0 {
        return Err(ComposeError::Invalid);
    }
    Ok(facts)
}

fn render_fact(reader: &mut Reader<'_>, strings: &[&str]) -> Result<String, ComposeError> {
    let flags = reader.u32()?;
    let mut out = String::with_capacity(384);
    out.push('{');
    push_field(&mut out, "authority", true);
    push_json_string(&mut out, required(strings, reader.u32()?)?);
    push_field(&mut out, "confidence", false);
    out.push_str(required_token(strings, reader.u32()?)?);
    push_field(&mut out, "derivation", false);
    push_json_string(&mut out, required(strings, reader.u32()?)?);
    push_field(&mut out, "evidence", false);
    render_evidence(&mut out, reader, strings)?;
    if flags & FLAG_EXTENSIONS != 0 {
        push_field(&mut out, "extensions", false);
        render_extensions(&mut out, reader, strings)?;
    }
    push_field(&mut out, "factId", false);
    push_json_string(&mut out, required(strings, reader.u32()?)?);
    push_field(&mut out, "factType", false);
    push_json_string(&mut out, required(strings, reader.u32()?)?);
    push_field(&mut out, "freshness", false);
    let status = required(strings, reader.u32()?)?;
    if flags & FLAG_FRESHNESS_RENEWAL != 0 {
        let renewal = required(strings, reader.u32()?)?;
        out.push_str("{\"renewal\":");
        push_json_string(&mut out, renewal);
        out.push_str(",\"status\":");
        push_json_string(&mut out, status);
        out.push('}');
    } else {
        out.push_str("{\"status\":");
        push_json_string(&mut out, status);
        out.push('}');
    }
    push_field(&mut out, "inputDigest", false);
    out.push_str(required_object(strings, reader.u32()?)?);
    push_field(&mut out, "object", false);
    if flags & FLAG_LITERAL_OBJECT != 0 {
        render_literal(&mut out, reader, strings)?;
    } else {
        render_entity(&mut out, reader, strings)?;
    }
    push_field(&mut out, "predicate", false);
    push_json_string(&mut out, required(strings, reader.u32()?)?);
    push_field(&mut out, "provenance", false);
    out.push_str("{\"id\":");
    push_json_string(&mut out, required(strings, reader.u32()?)?);
    out.push_str(",\"version\":");
    push_json_string(&mut out, required(strings, reader.u32()?)?);
    out.push('}');
    push_field(&mut out, "scope", false);
    out.push_str(required_object(strings, reader.u32()?)?);
    push_field(&mut out, "subject", false);
    render_entity(&mut out, reader, strings)?;
    push_field(&mut out, "truthLifecycle", false);
    render_lifecycle(&mut out, reader, strings)?;
    out.push_str(",\"unknownZones\":[]}");
    Ok(out)
}

fn render_evidence(
    out: &mut String,
    reader: &mut Reader<'_>,
    strings: &[&str],
) -> Result<(), ComposeError> {
    let count = reader.u32()? as usize;
    if count > MAX_COMPACT_EVIDENCE {
        return Err(ComposeError::Limit);
    }
    out.push('[');
    for index in 0..count {
        if index > 0 {
            out.push(',');
        }
        let digest_flags = reader.u32()?;
        out.push_str("{\"digest\":{\"algorithm\":");
        push_json_string(out, required(strings, reader.u32()?)?);
        if digest_flags & 1 != 0 {
            out.push_str(",\"canonicalization\":");
            push_json_string(out, required(strings, reader.u32()?)?);
        }
        out.push_str(",\"value\":");
        push_json_string(out, required(strings, reader.u32()?)?);
        out.push_str("},\"id\":");
        push_json_string(out, required(strings, reader.u32()?)?);
        out.push_str(",\"relativeLocator\":");
        push_json_string(out, required(strings, reader.u32()?)?);
        out.push_str(",\"sourceKind\":");
        push_json_string(out, required(strings, reader.u32()?)?);
        out.push('}');
    }
    out.push(']');
    Ok(())
}

fn render_extensions(
    out: &mut String,
    reader: &mut Reader<'_>,
    strings: &[&str],
) -> Result<(), ComposeError> {
    let count = reader.u32()? as usize;
    if count == 0 || count > MAX_COMPACT_EXTENSIONS {
        return Err(ComposeError::Limit);
    }
    let mut pairs = Vec::with_capacity(count);
    for _ in 0..count {
        pairs.push((
            required(strings, reader.u32()?)?,
            required(strings, reader.u32()?)?,
        ));
    }
    pairs.sort_by(|left, right| left.0.cmp(right.0));
    out.push('{');
    for (index, (key, value)) in pairs.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_json_string(out, key);
        out.push(':');
        push_json_string(out, value);
    }
    out.push('}');
    Ok(())
}

fn render_entity(
    out: &mut String,
    reader: &mut Reader<'_>,
    strings: &[&str],
) -> Result<(), ComposeError> {
    out.push_str("{\"id\":");
    push_json_string(out, required(strings, reader.u32()?)?);
    out.push_str(",\"identityScheme\":");
    out.push_str(required_object(strings, reader.u32()?)?);
    out.push_str(",\"kind\":");
    push_json_string(out, required(strings, reader.u32()?)?);
    out.push_str(",\"scope\":");
    out.push_str(required_object(strings, reader.u32()?)?);
    out.push('}');
    Ok(())
}

fn render_literal(
    out: &mut String,
    reader: &mut Reader<'_>,
    strings: &[&str],
) -> Result<(), ComposeError> {
    out.push_str("{\"kind\":");
    push_json_string(out, required(strings, reader.u32()?)?);
    out.push_str(",\"value\":");
    out.push_str(required_token(strings, reader.u32()?)?);
    out.push('}');
    Ok(())
}

fn render_lifecycle(
    out: &mut String,
    reader: &mut Reader<'_>,
    strings: &[&str],
) -> Result<(), ComposeError> {
    let count = reader.u32()? as usize;
    if count > MAX_COMPACT_LIFECYCLE {
        return Err(ComposeError::Limit);
    }
    out.push_str("{\"invalidatedBy\":[");
    for index in 0..count {
        if index > 0 {
            out.push(',');
        }
        push_json_string(out, required(strings, reader.u32()?)?);
    }
    out.push_str("]}");
    Ok(())
}

fn required<'a>(strings: &[&'a str], id: u32) -> Result<&'a str, ComposeError> {
    strings
        .get(id as usize)
        .copied()
        .ok_or(ComposeError::Invalid)
        .and_then(|value| {
            if value.is_empty() {
                Err(ComposeError::Invalid)
            } else {
                Ok(value)
            }
        })
}

fn required_object<'a>(strings: &[&'a str], id: u32) -> Result<&'a str, ComposeError> {
    let value = required(strings, id)?;
    if value.starts_with('{') && value.ends_with('}') {
        Ok(value)
    } else {
        Err(ComposeError::Invalid)
    }
}

fn required_token<'a>(strings: &[&'a str], id: u32) -> Result<&'a str, ComposeError> {
    let value = required(strings, id)?;
    let bytes = value.as_bytes();
    let ok = match bytes.first() {
        Some(b'"' | b'-' | b't' | b'f' | b'n') => true,
        Some(byte) => byte.is_ascii_digit(),
        None => false,
    };
    if ok {
        Ok(value)
    } else {
        Err(ComposeError::Invalid)
    }
}

fn push_field(out: &mut String, name: &str, first: bool) {
    if !first {
        out.push(',');
    }
    push_json_string(out, name);
    out.push(':');
}

fn push_json_string(out: &mut String, value: &str) {
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            other if (other as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", other as u32));
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

pub fn pack_fact_canonical(facts: &[String]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&(facts.len() as u32).to_le_bytes());
    for fact in facts {
        let encoded = fact.as_bytes();
        bytes.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
        bytes.extend_from_slice(encoded);
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn push_u32(bytes: &mut Vec<u8>, value: u32) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn push_string(table: &mut Vec<String>, value: &str) -> u32 {
        table.push(value.to_owned());
        (table.len() - 1) as u32
    }

    #[test]
    fn canonical_entity_fact_matches_sorted_reference_json() {
        let mut table = vec![String::new()];
        let authority = push_string(&mut table, "observed");
        let confidence = push_string(&mut table, "1");
        let derivation = push_string(&mut table, "extracted");
        let algorithm = push_string(&mut table, "sha256");
        let digest_value = push_string(&mut table, "ab");
        let evidence_id = push_string(&mut table, "evidence:1");
        let locator = push_string(&mut table, "src/a.ts");
        let source_kind = push_string(&mut table, "source-file");
        let fact_id = push_string(&mut table, "fact:1");
        let fact_type = push_string(&mut table, "source.static-import");
        let freshness = push_string(&mut table, "current");
        let input_digest = push_string(&mut table, "{\"algorithm\":\"sha256\",\"value\":\"ab\"}");
        let object_id = push_string(&mut table, "module:left");
        let scheme = push_string(
            &mut table,
            "{\"id\":\"workspai.graph.portable-entity\",\"version\":\"1\"}",
        );
        let object_kind = push_string(&mut table, "module");
        let scope = push_string(
            &mut table,
            "{\"kind\":\"project\",\"projectIds\":[\"app\"]}",
        );
        let predicate = push_string(&mut table, "imports");
        let provider = push_string(&mut table, "provider");
        let version = push_string(&mut table, "1");
        let subject_id = push_string(&mut table, "file:src/a.ts");
        let subject_kind = push_string(&mut table, "file");
        let lifecycle = push_string(&mut table, "input-change");
        let extension_key = push_string(&mut table, "moduleSpecifier");
        let extension_value = push_string(&mut table, "./left");

        let mut bytes = Vec::new();
        bytes.extend_from_slice(COMPACT_FACT_MAGIC);
        push_u32(&mut bytes, COMPACT_FACT_VERSION);
        push_u32(&mut bytes, 1);
        push_u32(&mut bytes, table.len() as u32);
        for value in &table {
            push_u32(&mut bytes, value.len() as u32);
            bytes.extend_from_slice(value.as_bytes());
        }
        push_u32(&mut bytes, FLAG_EXTENSIONS);
        for id in [authority, confidence, derivation] {
            push_u32(&mut bytes, id);
        }
        push_u32(&mut bytes, 1);
        push_u32(&mut bytes, 0);
        for id in [algorithm, digest_value, evidence_id, locator, source_kind] {
            push_u32(&mut bytes, id);
        }
        push_u32(&mut bytes, 1);
        push_u32(&mut bytes, extension_key);
        push_u32(&mut bytes, extension_value);
        for id in [fact_id, fact_type, freshness, input_digest] {
            push_u32(&mut bytes, id);
        }
        for id in [
            object_id,
            scheme,
            object_kind,
            scope,
            predicate,
            provider,
            version,
            scope,
        ] {
            push_u32(&mut bytes, id);
        }
        for id in [subject_id, scheme, subject_kind, scope] {
            push_u32(&mut bytes, id);
        }
        push_u32(&mut bytes, 1);
        push_u32(&mut bytes, lifecycle);

        let rendered = compose_fact_canonical(&bytes).expect("fact");
        assert_eq!(rendered.len(), 1);
        assert!(rendered[0].contains("\"moduleSpecifier\":\"./left\""));
        assert!(rendered[0].contains("\"unknownZones\":[]"));
        assert!(rendered[0].starts_with("{\"authority\":\"observed\""));
        assert!(rendered[0].ends_with("\"unknownZones\":[]}"));
    }

    #[test]
    fn rejects_truncated_input() {
        assert_eq!(compose_fact_canonical(b"WGF"), Err(ComposeError::Truncated));
    }
}
