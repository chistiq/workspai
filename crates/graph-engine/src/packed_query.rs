//! Paged queries over a published WGP1 snapshot.
//!
//! The query process owns the packed bytes. Each response is one bounded page.
//! A page that cannot hold the next complete record returns `response-limit`
//! instead of omitting that record.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

use crate::sha256::{hex32, Sha256};

const NONE: u32 = 0xffff_ffff;
const MAX_FRAME: u32 = 16 * 1024 * 1024;
const MAX_PAGE: u32 = 4096;
const MAX_RESPONSE_BYTES: u32 = 1024 * 1024;

const KIND_OPEN: u8 = 1;
const KIND_QUERY: u8 = 2;
const KIND_CLOSE: u8 = 3;

const CODE_OK: u32 = 0;
const CODE_IO: u32 = 1;
const CODE_PROTOCOL: u32 = 2;
const CODE_UNSUPPORTED: u32 = 3;
const CODE_CURSOR: u32 = 4;
const CODE_MISMATCH: u32 = 5;
const CODE_STALE: u32 = 6;
const CODE_LIMIT: u32 = 7;
const CODE_NOT_OPEN: u32 = 8;
const CODE_CLOSED: u32 = 9;
const CODE_CANCELLED: u32 = 10;

struct EdgeHead {
    at: usize,
    from: u32,
    to: u32,
    relation: u32,
}

struct PackedGraph {
    bytes: SnapshotBytes,
    strings: Option<SnapshotBytes>,
    nodes: Option<SnapshotBytes>,
    edge_bytes: Option<SnapshotBytes>,
    unresolved_bytes: Option<SnapshotBytes>,
    decision_bytes: Option<SnapshotBytes>,
    adjacency: Option<SnapshotBytes>,
    adjacency_offsets: Vec<u64>,
    string_offsets: Vec<u32>,
    node_offsets: Vec<u32>,
    edges: Vec<EdgeHead>,
    unresolved_offsets: Vec<u32>,
    decision_offsets: Vec<u32>,
    digest: String,
}

struct Cursor {
    ptr: *const u8,
    len: usize,
    at: usize,
}

impl Cursor {
    fn new(bytes: &[u8], at: usize) -> Self {
        Self {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
            at,
        }
    }

    fn bytes(&self) -> &[u8] {
        if self.len == 0 || self.ptr.is_null() {
            return &[];
        }
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }

    fn rest(&self) -> usize {
        self.len.saturating_sub(self.at)
    }

    fn u32(&mut self) -> Result<u32, ()> {
        if self.rest() < 4 {
            return Err(());
        }
        let value = {
            let bytes = self.bytes();
            u32::from_le_bytes(bytes[self.at..self.at + 4].try_into().unwrap())
        };
        self.at += 4;
        Ok(value)
    }

    fn u8(&mut self) -> Result<u8, ()> {
        let value = {
            let bytes = self.bytes();
            *bytes.get(self.at).ok_or(())?
        };
        self.at += 1;
        Ok(value)
    }

    fn f64(&mut self) -> Result<f64, ()> {
        if self.rest() < 8 {
            return Err(());
        }
        let value = {
            let bytes = self.bytes();
            f64::from_le_bytes(bytes[self.at..self.at + 8].try_into().unwrap())
        };
        self.at += 8;
        Ok(value)
    }

    fn raw(&mut self, length: usize) -> Result<&[u8], ()> {
        if self.rest() < length {
            return Err(());
        }
        let start = self.at;
        self.at += length;
        let bytes = self.bytes();
        Ok(&bytes[start..start + length])
    }

    fn text(&mut self) -> Result<String, ()> {
        let length = self.u32()? as usize;
        let bytes = self.raw(length)?;
        String::from_utf8(bytes.to_vec()).map_err(|_| ())
    }

    fn skip_u32_list(&mut self) -> Result<(), ()> {
        let count = self.u32()? as usize;
        self.raw(count.saturating_mul(4)).map(|_| ())
    }

    fn skip_string_list(&mut self) -> Result<(), ()> {
        let count = self.u32()?;
        for _ in 0..count {
            let length = self.u32()? as usize;
            self.raw(length)?;
        }
        Ok(())
    }

    fn skip_evidence(&mut self) -> Result<(), ()> {
        let count = self.u32()?;
        for _ in 0..count {
            self.raw(24)?;
        }
        Ok(())
    }

    fn skip_edge_tail(&mut self) -> Result<(), ()> {
        self.u8()?;
        self.f64()?;
        self.skip_u32_list()?;
        self.skip_u32_list()?;
        self.skip_u32_list()?;
        self.u8()?;
        let explanation = self.u32()? as usize;
        self.raw(explanation)?;
        let proof = self.u32()? as usize;
        self.raw(proof)?;
        self.skip_string_list()?;
        self.skip_evidence()?;
        let groups = self.u32()?;
        for _ in 0..groups {
            self.u32()?;
            self.skip_evidence()?;
        }
        self.u32()?;
        self.u32()?;
        let digest = self.u32()? as usize;
        self.raw(digest)?;
        self.u32()?;
        self.u32()?;
        self.u32()?;
        Ok(())
    }
}

enum SnapshotBytes {
    Owned(Vec<u8>),
    #[cfg_attr(not(unix), allow(dead_code))]
    Mapped(MappedFile),
}

impl SnapshotBytes {
    fn as_slice(&self) -> &[u8] {
        match self {
            Self::Owned(bytes) => bytes,
            Self::Mapped(mapped) => mapped.as_slice(),
        }
    }
}

struct MappedFile {
    ptr: *mut u8,
    len: usize,
}

impl MappedFile {
    fn as_slice(&self) -> &[u8] {
        if self.len == 0 || self.ptr.is_null() {
            return &[];
        }
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }
}

impl Drop for MappedFile {
    fn drop(&mut self) {
        if self.len > 0 && !self.ptr.is_null() {
            unsafe {
                munmap(self.ptr, self.len);
            }
        }
    }
}

unsafe impl Send for MappedFile {}

#[cfg(unix)]
const PROT_READ: i32 = 1;
#[cfg(unix)]
const MAP_PRIVATE: i32 = 2;

#[cfg(unix)]
extern "C" {
    fn mmap(addr: *mut u8, len: usize, prot: i32, flags: i32, fd: i32, offset: i64) -> *mut u8;
    fn munmap(addr: *mut u8, len: usize) -> i32;
}

#[cfg(not(unix))]
unsafe fn munmap(_addr: *mut u8, _len: usize) -> i32 {
    0
}

fn map_snapshot(path: &str) -> Result<SnapshotBytes, ()> {
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        let file = std::fs::File::open(path).map_err(|_| ())?;
        let len = usize::try_from(file.metadata().map_err(|_| ())?.len()).map_err(|_| ())?;
        if len == 0 {
            return Ok(SnapshotBytes::Owned(Vec::new()));
        }
        let ptr = unsafe {
            mmap(
                std::ptr::null_mut(),
                len,
                PROT_READ,
                MAP_PRIVATE,
                file.as_raw_fd(),
                0,
            )
        };
        if ptr == usize::MAX as *mut u8 {
            return Err(());
        }
        Ok(SnapshotBytes::Mapped(MappedFile { ptr, len }))
    }
    #[cfg(not(unix))]
    {
        Ok(SnapshotBytes::Owned(std::fs::read(path).map_err(|_| ())?))
    }
}

fn digest_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex32(&hasher.finish())
}

fn open_packed(bytes: SnapshotBytes) -> Result<PackedGraph, ()> {
    let digest = digest_bytes(bytes.as_slice());
    let mut cursor = Cursor::new(bytes.as_slice(), 0);
    if cursor.raw(4)? != b"WGP1" || cursor.u32()? != 1 {
        return Err(());
    }
    let string_count = cursor.u32()? as usize;
    let mut string_offsets = Vec::with_capacity(string_count);
    for _ in 0..string_count {
        let at = cursor.at;
        let length = cursor.u32()? as usize;
        let text = cursor.raw(length)?;
        if std::str::from_utf8(text).is_err() {
            return Err(());
        }
        string_offsets.push(u32::try_from(at).map_err(|_| ())?);
    }
    let node_count = cursor.u32()? as usize;
    let mut node_offsets = Vec::with_capacity(node_count);
    for _ in 0..node_count {
        let at = cursor.at;
        cursor.raw(16)?;
        let alias_count = cursor.u32()? as usize;
        cursor.raw(alias_count.saturating_mul(8))?;
        node_offsets.push(u32::try_from(at).map_err(|_| ())?);
    }
    let edge_count = cursor.u32()? as usize;
    let mut edges = Vec::with_capacity(edge_count);
    for _ in 0..edge_count {
        let at = cursor.at;
        let id_len = cursor.u32()? as usize;
        cursor.raw(id_len)?;
        let relation = cursor.u32()?;
        let _semantics = cursor.u32()?;
        let from = cursor.u32()?;
        let to = cursor.u32()?;
        cursor.skip_edge_tail()?;
        edges.push(EdgeHead {
            at,
            from,
            to,
            relation,
        });
    }
    let unresolved_count = cursor.u32()? as usize;
    let mut unresolved_offsets = Vec::with_capacity(unresolved_count);
    for _ in 0..unresolved_count {
        let at = cursor.at;
        let id = cursor.u32()? as usize;
        cursor.raw(id)?;
        cursor.skip_string_list()?;
        unresolved_offsets.push(u32::try_from(at).map_err(|_| ())?);
    }
    let decision_count = cursor.u32()? as usize;
    let mut decision_offsets = Vec::with_capacity(decision_count);
    for _ in 0..decision_count {
        let at = cursor.at;
        let key = cursor.u32()? as usize;
        cursor.raw(key)?;
        cursor.u8()?;
        cursor.u8()?;
        cursor.skip_u32_list()?;
        let code = cursor.u32()? as usize;
        cursor.raw(code)?;
        cursor.skip_string_list()?;
        decision_offsets.push(u32::try_from(at).map_err(|_| ())?);
    }
    if cursor.at != bytes.as_slice().len() {
        return Err(());
    }
    Ok(PackedGraph {
        bytes,
        strings: None,
        nodes: None,
        edge_bytes: None,
        unresolved_bytes: None,
        decision_bytes: None,
        adjacency: None,
        adjacency_offsets: Vec::new(),
        string_offsets,
        node_offsets,
        edges,
        unresolved_offsets,
        decision_offsets,
        digest,
    })
}

fn region<'a>(fallback: &'a SnapshotBytes, part: Option<&'a SnapshotBytes>) -> &'a [u8] {
    part.unwrap_or(fallback).as_slice()
}

fn segment_path(snapshot: &str, digest: &str) -> Option<std::path::PathBuf> {
    let path = Path::new(snapshot);
    let direct = path.parent()?.join("segments").join(digest);
    if direct.is_file() {
        return Some(direct);
    }
    let shared = path.parent()?.parent()?.join("segments").join(digest);
    if shared.is_file() {
        return Some(shared);
    }
    None
}

fn take_part(parts: &mut Vec<(u8, SnapshotBytes)>, kind: u8) -> Result<SnapshotBytes, ()> {
    let index = parts.iter().position(|(id, _)| *id == kind).ok_or(())?;
    Ok(parts.swap_remove(index).1)
}

fn open_segmented(path: &str, manifest: SnapshotBytes) -> Result<PackedGraph, ()> {
    let bytes = manifest.as_slice();
    if bytes.len() < 12 || &bytes[..4] != b"WGP2" {
        return Err(());
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let count = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if version != 1 || count != 6 || bytes.len() != 12 + count * 41 {
        return Err(());
    }
    let digest = digest_bytes(bytes);
    let mut parts = Vec::new();
    for index in 0..count {
        let at = 12 + index * 41;
        let kind = bytes[at];
        let len = u64::from_le_bytes(bytes[at + 1..at + 9].try_into().unwrap());
        let expected: [u8; 32] = bytes[at + 9..at + 41].try_into().unwrap();
        let name = hex32(&expected);
        let file = segment_path(path, &name).ok_or(())?;
        let mapped = map_snapshot(file.to_str().ok_or(())?).map_err(|_| ())?;
        if mapped.as_slice().len() as u64 != len || digest_bytes(mapped.as_slice()) != name {
            return Err(());
        }
        parts.push((kind, mapped));
    }
    let strings = take_part(&mut parts, 1)?;
    let nodes = take_part(&mut parts, 2)?;
    let edge_bytes = take_part(&mut parts, 3)?;
    let adjacency = take_part(&mut parts, 4)?;
    let unresolved_bytes = take_part(&mut parts, 5)?;
    let decision_bytes = take_part(&mut parts, 6)?;
    let string_offsets = record_offsets(strings.as_slice(), true)?;
    let node_offsets = node_record_offsets(nodes.as_slice())?;
    let edges = edge_heads(edge_bytes.as_slice())?;
    let unresolved_offsets = tail_offsets(unresolved_bytes.as_slice(), true)?;
    let decision_offsets = tail_offsets(decision_bytes.as_slice(), false)?;
    let adjacency_offsets = adjacency_table(adjacency.as_slice())?;
    Ok(PackedGraph {
        bytes: manifest,
        strings: Some(strings),
        nodes: Some(nodes),
        edge_bytes: Some(edge_bytes),
        unresolved_bytes: Some(unresolved_bytes),
        decision_bytes: Some(decision_bytes),
        adjacency: Some(adjacency),
        adjacency_offsets,
        string_offsets,
        node_offsets,
        edges,
        unresolved_offsets,
        decision_offsets,
        digest,
    })
}

fn record_offsets(bytes: &[u8], _strings: bool) -> Result<Vec<u32>, ()> {
    let mut cursor = Cursor::new(bytes, 0);
    let count = cursor.u32()? as usize;
    let mut offsets = Vec::with_capacity(count);
    for _ in 0..count {
        let at = cursor.at;
        let length = cursor.u32()? as usize;
        let text = cursor.raw(length)?;
        if std::str::from_utf8(text).is_err() {
            return Err(());
        }
        offsets.push(u32::try_from(at).map_err(|_| ())?);
    }
    if cursor.at != bytes.len() {
        return Err(());
    }
    Ok(offsets)
}

fn node_record_offsets(bytes: &[u8]) -> Result<Vec<u32>, ()> {
    let mut cursor = Cursor::new(bytes, 0);
    let count = cursor.u32()? as usize;
    let mut offsets = Vec::with_capacity(count);
    for _ in 0..count {
        let at = cursor.at;
        cursor.raw(16)?;
        let alias_count = cursor.u32()? as usize;
        cursor.raw(alias_count.saturating_mul(8))?;
        offsets.push(u32::try_from(at).map_err(|_| ())?);
    }
    if cursor.at != bytes.len() {
        return Err(());
    }
    Ok(offsets)
}

fn edge_heads(bytes: &[u8]) -> Result<Vec<EdgeHead>, ()> {
    let mut cursor = Cursor::new(bytes, 0);
    let count = cursor.u32()? as usize;
    let mut edges = Vec::with_capacity(count);
    for _ in 0..count {
        let at = cursor.at;
        let id_len = cursor.u32()? as usize;
        cursor.raw(id_len)?;
        let relation = cursor.u32()?;
        let _semantics = cursor.u32()?;
        let from = cursor.u32()?;
        let to = cursor.u32()?;
        cursor.skip_edge_tail()?;
        edges.push(EdgeHead {
            at,
            from,
            to,
            relation,
        });
    }
    if cursor.at != bytes.len() {
        return Err(());
    }
    Ok(edges)
}

fn tail_offsets(bytes: &[u8], unresolved: bool) -> Result<Vec<u32>, ()> {
    let mut cursor = Cursor::new(bytes, 0);
    let count = cursor.u32()? as usize;
    let mut offsets = Vec::with_capacity(count);
    for _ in 0..count {
        let at = cursor.at;
        let length = cursor.u32()? as usize;
        cursor.raw(length)?;
        if unresolved {
            cursor.skip_string_list()?;
        } else {
            cursor.u8()?;
            cursor.u8()?;
            cursor.skip_u32_list()?;
            let code = cursor.u32()? as usize;
            cursor.raw(code)?;
            cursor.skip_string_list()?;
        }
        offsets.push(u32::try_from(at).map_err(|_| ())?);
    }
    if cursor.at != bytes.len() {
        return Err(());
    }
    Ok(offsets)
}

fn adjacency_table(bytes: &[u8]) -> Result<Vec<u64>, ()> {
    if bytes.len() < 4 {
        return Err(());
    }
    let count = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    if bytes.len() < 4 + count.saturating_mul(8) {
        return Err(());
    }
    let mut offsets = Vec::with_capacity(count);
    for index in 0..count {
        let at = 4 + index * 8;
        offsets.push(u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap()));
    }
    Ok(offsets)
}

fn push_string(out: &mut String, value: &str) {
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", control as u32));
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

fn json_value(value: &str) -> String {
    let trimmed = value.trim_start();
    let raw = trimmed.starts_with('{')
        || trimmed.starts_with('[')
        || trimmed.starts_with('"')
        || trimmed == "true"
        || trimmed == "false"
        || trimmed == "null"
        || trimmed.starts_with('-')
        || trimmed
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit());
    if raw {
        value.to_owned()
    } else {
        let mut out = String::new();
        push_string(&mut out, value);
        out
    }
}

fn alias_reason(value: &str) -> Result<&'static str, ()> {
    match value {
        "rename" => Ok("rename"),
        "move" => Ok("move"),
        "canonicalization" => Ok("canonicalization"),
        "provider-alias" => Ok("provider-alias"),
        _ => Err(()),
    }
}

impl PackedGraph {
    fn string(&self, id: u32) -> Result<&str, ()> {
        let start = *self.string_offsets.get(id as usize).ok_or(())? as usize;
        let bytes = region(&self.bytes, self.strings.as_ref());
        if start.saturating_add(4) > bytes.len() {
            return Err(());
        }
        let length = u32::from_le_bytes(bytes[start..start + 4].try_into().unwrap()) as usize;
        let data = bytes.get(start + 4..start + 4 + length).ok_or(())?;
        std::str::from_utf8(data).map_err(|_| ())
    }

    fn find_string(&self, value: &str) -> Result<u32, ()> {
        for index in 0..self.string_offsets.len() {
            if self.string(index as u32)? == value {
                return Ok(index as u32);
            }
        }
        Err(())
    }

    fn node_json(&self, index: usize) -> Result<String, ()> {
        let at = *self.node_offsets.get(index).ok_or(())? as usize;
        let mut cursor = Cursor::new(region(&self.bytes, self.nodes.as_ref()), at);
        let id = cursor.u32()?;
        let kind = cursor.u32()?;
        let scheme = cursor.u32()?;
        let scope = cursor.u32()?;
        let alias_count = cursor.u32()?;
        let mut aliases = Vec::with_capacity(alias_count as usize);
        for _ in 0..alias_count {
            aliases.push((cursor.u32()?, cursor.u32()?));
        }
        let mut out = String::new();
        out.push('{');
        out.push_str("\"id\":");
        push_string(&mut out, self.string(id)?);
        out.push_str(",\"identityScheme\":");
        out.push_str(&json_value(self.string(scheme)?));
        out.push_str(",\"kind\":");
        push_string(&mut out, self.string(kind)?);
        out.push_str(",\"scope\":");
        out.push_str(&json_value(self.string(scope)?));
        if !aliases.is_empty() {
            out.push_str(",\"aliases\":[");
            for (alias_index, (alias_id, reason)) in aliases.iter().enumerate() {
                if alias_index > 0 {
                    out.push(',');
                }
                out.push_str("{\"id\":");
                push_string(&mut out, self.string(*alias_id)?);
                out.push_str(",\"reason\":");
                push_string(&mut out, alias_reason(self.string(*reason)?)?);
                out.push('}');
            }
            out.push(']');
        }
        out.push('}');
        Ok(out)
    }

    fn orphan_indexes(&self) -> Vec<usize> {
        let mut endpoints = vec![false; self.string_offsets.len()];
        for edge in &self.edges {
            if let Some(flag) = endpoints.get_mut(edge.from as usize) {
                *flag = true;
            }
            if let Some(flag) = endpoints.get_mut(edge.to as usize) {
                *flag = true;
            }
        }
        let mut orphans = Vec::new();
        for (index, offset) in self.node_offsets.iter().enumerate() {
            let mut cursor =
                Cursor::new(region(&self.bytes, self.nodes.as_ref()), *offset as usize);
            let id = cursor.u32().unwrap_or(u32::MAX);
            if endpoints.get(id as usize).copied() != Some(true) {
                orphans.push(index);
            }
        }
        orphans
    }

    fn edge_json(&self, index: usize) -> Result<String, ()> {
        let at = self.edges.get(index).ok_or(())?.at;
        let mut cursor = Cursor::new(region(&self.bytes, self.edge_bytes.as_ref()), at);
        let id = cursor.text()?;
        let relation = self.string(cursor.u32()?)?;
        let semantics = self.string(cursor.u32()?)?;
        let from = self.string(cursor.u32()?)?;
        let to = self.string(cursor.u32()?)?;
        let state = edge_state(cursor.u8()?)?;
        let confidence = cursor.f64()?;
        let facts = self.string_ids(&mut cursor)?;
        let derivations = self.string_ids(&mut cursor)?;
        let authorities = self.string_ids(&mut cursor)?;
        let proof = proof_state(cursor.u8()?)?;
        let explanation = cursor.text()?;
        let proof_code = cursor.text()?;
        let drivers = self.read_string_list(&mut cursor)?;
        let evidence = self.evidence_json(&mut cursor)?;
        let groups = cursor.u32()?;
        let mut corroboration = String::from("[");
        for group_index in 0..groups {
            if group_index > 0 {
                corroboration.push(',');
            }
            let root = self.string(cursor.u32()?)?;
            let group_evidence = self.evidence_json(&mut cursor)?;
            corroboration.push_str("{\"root\":");
            push_string(&mut corroboration, root);
            corroboration.push_str(",\"evidence\":");
            corroboration.push_str(&group_evidence);
            corroboration.push('}');
        }
        corroboration.push(']');
        let policy_id = self.string(cursor.u32()?)?;
        let policy_version = self.string(cursor.u32()?)?;
        let input_digest = cursor.text()?;
        let freshness = self.string(cursor.u32()?)?;
        let valid_until = cursor.u32()?;
        let evaluated = self.string(cursor.u32()?)?;
        let mut out = String::new();
        out.push('{');
        out.push_str("\"id\":");
        push_string(&mut out, &id);
        out.push_str(",\"relation\":");
        push_string(&mut out, relation);
        out.push_str(",\"semantics\":");
        push_string(&mut out, semantics);
        out.push_str(",\"from\":");
        push_string(&mut out, from);
        out.push_str(",\"to\":");
        push_string(&mut out, to);
        out.push_str(",\"state\":");
        push_string(&mut out, state);
        out.push_str(",\"facts\":");
        push_string_array(&mut out, &facts);
        out.push_str(",\"derivations\":");
        push_string_array(&mut out, &derivations);
        out.push_str(",\"proof\":{\"policy\":{\"id\":");
        push_string(&mut out, policy_id);
        out.push_str(",\"version\":");
        push_string(&mut out, policy_version);
        out.push_str("},\"state\":");
        push_string(&mut out, proof);
        out.push_str(",\"evidence\":");
        out.push_str(&evidence);
        out.push_str(",\"authorities\":");
        push_string_array(&mut out, &authorities);
        out.push_str(",\"corroborationGroups\":");
        out.push_str(&corroboration);
        out.push_str(",\"counterEvidence\":[],\"missingRequirements\":[],\"evaluatedAt\":");
        push_string(&mut out, evaluated);
        out.push_str(
            ",\"inputDigest\":{\"algorithm\":\"sha256\",\"canonicalization\":\"workspai.graph.canonical-json.v1\",\"value\":",
        );
        push_string(&mut out, &input_digest);
        out.push_str("},\"explanationCode\":");
        push_string(&mut out, &proof_code);
        out.push_str("},\"freshness\":{\"status\":");
        push_string(&mut out, freshness);
        if valid_until != NONE {
            out.push_str(",\"validUntil\":");
            push_string(&mut out, self.string(valid_until)?);
        }
        out.push_str("},\"confidence\":");
        out.push_str(&format!("{confidence}"));
        out.push_str(",\"explanation\":{\"code\":");
        push_string(&mut out, &explanation);
        out.push_str(",\"drivers\":");
        push_string_array(&mut out, &drivers);
        out.push_str("}}");
        Ok(out)
    }

    fn proof_record(&self, index: usize) -> Result<String, ()> {
        let edge = self.edge_json(index)?;
        let id_end = edge.find(",\"relation\":").ok_or(())?;
        let proof_at = edge.find(",\"proof\":").ok_or(())?;
        let fresh_at = edge.rfind(",\"freshness\":").ok_or(())?;
        Ok(format!(
            "{{{}}}",
            format!("{},{}", &edge[1..id_end], &edge[proof_at + 1..fresh_at])
        ))
    }

    fn string_ids(&self, cursor: &mut Cursor) -> Result<Vec<String>, ()> {
        let count = cursor.u32()?;
        let mut values = Vec::with_capacity(count as usize);
        for _ in 0..count {
            values.push(self.string(cursor.u32()?)?.to_owned());
        }
        Ok(values)
    }

    fn read_string_list(&self, cursor: &mut Cursor) -> Result<Vec<String>, ()> {
        let count = cursor.u32()?;
        let mut values = Vec::with_capacity(count as usize);
        for _ in 0..count {
            values.push(cursor.text()?);
        }
        Ok(values)
    }

    fn evidence_json(&self, cursor: &mut Cursor) -> Result<String, ()> {
        let count = cursor.u32()?;
        let mut out = String::from("[");
        for index in 0..count {
            if index > 0 {
                out.push(',');
            }
            let algorithm = self.string(cursor.u32()?)?;
            let canonicalization = cursor.u32()?;
            let value = self.string(cursor.u32()?)?;
            let id = self.string(cursor.u32()?)?;
            let locator = self.string(cursor.u32()?)?;
            let source_kind = self.string(cursor.u32()?)?;
            out.push_str("{\"digest\":{\"algorithm\":");
            push_string(&mut out, algorithm);
            if canonicalization != NONE {
                out.push_str(",\"canonicalization\":");
                push_string(&mut out, self.string(canonicalization)?);
            }
            out.push_str(",\"value\":");
            push_string(&mut out, value);
            out.push_str("},\"id\":");
            push_string(&mut out, id);
            out.push_str(",\"relativeLocator\":");
            push_string(&mut out, locator);
            out.push_str(",\"sourceKind\":");
            push_string(&mut out, source_kind);
            out.push('}');
        }
        out.push(']');
        Ok(out)
    }

    fn unresolved_json(&self, index: u32) -> Result<String, ()> {
        let at = *self.unresolved_offsets.get(index as usize).ok_or(())? as usize;
        let mut cursor = Cursor::new(region(&self.bytes, self.unresolved_bytes.as_ref()), at);
        let id = cursor.text()?;
        let candidates = self.read_string_list(&mut cursor)?;
        let mut out = String::from("{\"id\":");
        push_string(&mut out, &id);
        out.push_str(",\"candidates\":");
        push_string_array(&mut out, &candidates);
        out.push('}');
        Ok(out)
    }

    fn decision_json(&self, index: u32) -> Result<String, ()> {
        let at = *self.decision_offsets.get(index as usize).ok_or(())? as usize;
        let mut cursor = Cursor::new(region(&self.bytes, self.decision_bytes.as_ref()), at);
        let edge_key = cursor.text()?;
        let state = edge_state(cursor.u8()?)?;
        let included = cursor.u8()? == 1;
        let fact_ids = self.string_ids(&mut cursor)?;
        let code = cursor.text()?;
        let drivers = self.read_string_list(&mut cursor)?;
        let mut out = String::from("{\"edgeKey\":");
        push_string(&mut out, &edge_key);
        out.push_str(",\"state\":");
        push_string(&mut out, state);
        out.push_str(",\"includedInGraph\":");
        out.push_str(if included { "true" } else { "false" });
        out.push_str(",\"factIds\":");
        push_string_array(&mut out, &fact_ids);
        out.push_str(",\"explanation\":{\"code\":");
        push_string(&mut out, &code);
        out.push_str(",\"drivers\":");
        push_string_array(&mut out, &drivers);
        out.push_str("}}");
        Ok(out)
    }
}

fn push_string_array(out: &mut String, values: &[String]) {
    out.push('[');
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        push_string(out, value);
    }
    out.push(']');
}

fn edge_state(code: u8) -> Result<&'static str, ()> {
    match code {
        0 => Ok("accepted"),
        1 => Ok("disputed"),
        2 => Ok("rejected"),
        3 => Ok("unresolved"),
        _ => Err(()),
    }
}

fn proof_state(code: u8) -> Result<&'static str, ()> {
    match code {
        0 => Ok("supported"),
        1 => Ok("corroborated"),
        2 => Ok("verified"),
        3 => Ok("disputed"),
        4 => Ok("insufficient"),
        5 => Ok("unresolved"),
        _ => Err(()),
    }
}

struct PageRequest {
    kind: String,
    index: u64,
    extra: String,
    page_size: u32,
    max_bytes: u32,
    deadline: Option<Instant>,
}

fn parse_cursor(
    graph: &PackedGraph,
    cursor: &str,
    requested_kind: &str,
) -> Result<(u64, String), u32> {
    if cursor.is_empty() {
        return Ok((0, String::new()));
    }
    let mut parts = cursor.split('\t');
    let version = parts.next().ok_or(CODE_CURSOR)?;
    let digest = parts.next().ok_or(CODE_CURSOR)?;
    let kind = parts.next().ok_or(CODE_CURSOR)?;
    let index = parts.next().ok_or(CODE_CURSOR)?;
    let extra = parts.next().unwrap_or("");
    if version != "v1" || digest != graph.digest || kind != requested_kind {
        return Err(CODE_CURSOR);
    }
    let index = index.parse::<u64>().map_err(|_| CODE_CURSOR)?;
    Ok((index, extra.to_owned()))
}

fn cursor_text(graph: &PackedGraph, kind: &str, index: u64, extra: &str) -> String {
    format!("v1\t{}\t{kind}\t{index}\t{extra}", graph.digest)
}

fn dependency_match(relation: &str, filter: &str) -> bool {
    if filter.is_empty() {
        return matches!(relation, "imports" | "depends-on" | "references");
    }
    relation == filter
}

fn page(graph: &PackedGraph, request: &PageRequest) -> Result<(String, String, bool), u32> {
    let mut items = Vec::new();
    let mut bytes = 2usize;
    let mut index = request.index;
    let limit = request.page_size as u64;
    let max_bytes = request.max_bytes as usize;
    let kind = request.kind.as_str();
    let extra = if request.extra.is_empty() && index == 0 {
        String::new()
    } else {
        request.extra.clone()
    };
    loop {
        if items.len() as u64 >= limit {
            break;
        }
        if request
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err(CODE_CANCELLED);
        }
        let next = match kind {
            "nodes" => {
                if index >= graph.node_offsets.len() as u64 {
                    None
                } else {
                    Some(graph.node_json(index as usize).map_err(|_| CODE_PROTOCOL)?)
                }
            }
            "edges" | "proofs" => {
                if index >= graph.edges.len() as u64 {
                    None
                } else if kind == "proofs" {
                    Some(
                        graph
                            .proof_record(index as usize)
                            .map_err(|_| CODE_PROTOCOL)?,
                    )
                } else {
                    Some(graph.edge_json(index as usize).map_err(|_| CODE_PROTOCOL)?)
                }
            }
            "dependencies" => {
                let mut found = None;
                while (index as usize) < graph.edges.len() {
                    let relation = graph
                        .string(graph.edges[index as usize].relation)
                        .map_err(|_| CODE_PROTOCOL)?;
                    if dependency_match(relation, &extra) {
                        found = Some(graph.edge_json(index as usize).map_err(|_| CODE_PROTOCOL)?);
                        break;
                    }
                    index += 1;
                }
                found
            }
            "unresolved" => {
                if index >= graph.unresolved_offsets.len() as u64 {
                    None
                } else {
                    Some(
                        graph
                            .unresolved_json(index as u32)
                            .map_err(|_| CODE_PROTOCOL)?,
                    )
                }
            }
            "decisions" => {
                if index >= graph.decision_offsets.len() as u64 {
                    None
                } else {
                    Some(
                        graph
                            .decision_json(index as u32)
                            .map_err(|_| CODE_PROTOCOL)?,
                    )
                }
            }
            "orphans" => {
                let orphans = graph.orphan_indexes();
                let slot = orphans.get(index as usize).copied();
                slot.map(|node| graph.node_json(node).map_err(|_| CODE_PROTOCOL))
                    .transpose()?
            }
            "traverse" => return Err(CODE_PROTOCOL),
            "export" => {
                return page_export(graph, request);
            }
            _ => return Err(CODE_UNSUPPORTED),
        };
        let Some(record) = next else {
            break;
        };
        let addition = record.len() + usize::from(!items.is_empty());
        if bytes + addition > max_bytes {
            if items.is_empty() {
                return Err(CODE_LIMIT);
            }
            break;
        }
        bytes += addition;
        items.push(record);
        index += 1;
    }
    let exhausted = match kind {
        "nodes" => index >= graph.node_offsets.len() as u64,
        "edges" | "proofs" | "dependencies" => index >= graph.edges.len() as u64,
        "unresolved" => index >= graph.unresolved_offsets.len() as u64,
        "decisions" => index >= graph.decision_offsets.len() as u64,
        "orphans" => index >= graph.orphan_indexes().len() as u64,
        _ => true,
    };
    Ok((
        format!("[{}]", items.join(",")),
        cursor_text(graph, kind, index, &extra),
        exhausted,
    ))
}

fn page_export(graph: &PackedGraph, request: &PageRequest) -> Result<(String, String, bool), u32> {
    let phase = if request.extra.is_empty() {
        "nodes"
    } else {
        request.extra.as_str()
    };
    let forwarded = PageRequest {
        kind: if phase == "edges" {
            "edges".to_owned()
        } else {
            "nodes".to_owned()
        },
        index: request.index,
        extra: String::new(),
        page_size: request.page_size,
        max_bytes: request.max_bytes,
        deadline: request.deadline,
    };
    let (json, inner, exhausted_phase) = page(graph, &forwarded)?;
    let next_index = inner.split('\t').nth(3).unwrap_or("0");
    if phase != "edges" && exhausted_phase {
        if graph.edges.is_empty() {
            return Ok((json, cursor_text(graph, "export", 0, "edges"), true));
        }
        return Ok((json, cursor_text(graph, "export", 0, "edges"), false));
    }
    let exhausted = phase == "edges" && exhausted_phase;
    Ok((
        json,
        cursor_text(graph, "export", next_index.parse().unwrap_or(0), phase),
        exhausted,
    ))
}

const MAX_OPEN_TRAVERSALS: usize = 32;
const MAX_RETAINED_TRAVERSAL_NODES: u32 = 100_000;

struct TraverseState {
    depth_limit: u32,
    relation: String,
    direction: String,
    origin: String,
    queue: VecDeque<(u32, u32, usize)>,
    visited: HashSet<u32>,
    emitted: HashSet<usize>,
    nodes_seen: u32,
    edges_seen: u32,
    touched: Instant,
}

fn sweep_traversals(states: &mut HashMap<u64, TraverseState>) {
    let ttl = Duration::from_secs(30);
    states.retain(|_, state| state.touched.elapsed() < ttl);
}

fn traversal_token(graph: &PackedGraph, id: u64, state: &TraverseState) -> String {
    let mut hasher = Sha256::new();
    hasher.update(graph.digest.as_bytes());
    hasher.update(state.origin.as_bytes());
    hasher.update(state.relation.as_bytes());
    hasher.update(state.direction.as_bytes());
    hasher.update(&state.depth_limit.to_le_bytes());
    hasher.update(&id.to_le_bytes());
    let digest = hex32(&hasher.finish());
    format!("state:{id}:{}", &digest[..16])
}

fn drop_traversal(
    states: &mut HashMap<u64, TraverseState>,
    id: u64,
    code: u32,
) -> Result<(String, String, bool), u32> {
    states.remove(&id);
    Err(code)
}

fn relation_keeps(graph: &PackedGraph, edge_index: usize, relation: &str) -> bool {
    if relation == "*" {
        return true;
    }
    graph
        .edges
        .get(edge_index)
        .and_then(|edge| graph.string(edge.relation).ok())
        .is_some_and(|name| name == relation)
}

fn adjacent_from_segment(
    graph: &PackedGraph,
    direction: &str,
    node: u32,
    relation: &str,
) -> Option<Vec<usize>> {
    let bytes = graph.adjacency.as_ref()?.as_slice();
    let offset = *graph.adjacency_offsets.get(node as usize)? as usize;
    let mut cursor = Cursor::new(bytes, offset);
    let out_count = cursor.u32().ok()?;
    let mut outgoing = Vec::with_capacity(out_count as usize);
    for _ in 0..out_count {
        outgoing.push(cursor.u32().ok()? as usize);
    }
    let in_count = cursor.u32().ok()?;
    let mut incoming = Vec::with_capacity(in_count as usize);
    for _ in 0..in_count {
        incoming.push(cursor.u32().ok()? as usize);
    }
    let mut indexes = Vec::new();
    if direction != "in" {
        indexes.extend(
            outgoing
                .into_iter()
                .filter(|index| relation_keeps(graph, *index, relation)),
        );
    }
    if direction != "out" {
        for index in incoming {
            if !indexes.contains(&index) && relation_keeps(graph, index, relation) {
                indexes.push(index);
            }
        }
    }
    Some(indexes)
}

fn adjacent(graph: &PackedGraph, direction: &str, node: u32, relation: &str) -> Vec<usize> {
    if let Some(indexes) = adjacent_from_segment(graph, direction, node, relation) {
        return indexes;
    }
    let mut indexes = Vec::new();
    for (index, edge) in graph.edges.iter().enumerate() {
        let matches_direction = if direction == "in" {
            edge.to == node
        } else if direction == "both" {
            edge.from == node || edge.to == node
        } else {
            edge.from == node
        };
        if !matches_direction {
            continue;
        }
        if relation != "*" {
            let name = graph.string(edge.relation).unwrap_or("");
            if name != relation {
                continue;
            }
        }
        indexes.push(index);
    }
    indexes
}

fn page_traverse(
    graph: &PackedGraph,
    request: &PageRequest,
    states: &mut HashMap<u64, TraverseState>,
    next_state: &mut u64,
) -> Result<(String, String, bool), u32> {
    let state_id = if let Some(rest) = request.extra.strip_prefix("state:") {
        let mut parts = rest.split(':');
        let id = parts
            .next()
            .unwrap_or("")
            .parse::<u64>()
            .map_err(|_| CODE_CURSOR)?;
        let mac = parts.next().unwrap_or("");
        if parts.next().is_some() {
            return Err(CODE_CURSOR);
        }
        let state = states.get(&id).ok_or(CODE_CURSOR)?;
        let expected = traversal_token(graph, id, state);
        let expected_mac = expected.rsplit(':').next().unwrap_or("");
        if mac != expected_mac {
            return Err(CODE_CURSOR);
        }
        id
    } else if request.extra.is_empty() {
        return Err(CODE_CURSOR);
    } else {
        sweep_traversals(states);
        if states.len() >= MAX_OPEN_TRAVERSALS {
            return Err(CODE_LIMIT);
        }
        let retained = states
            .values()
            .fold(0u32, |total, state| total.saturating_add(state.nodes_seen));
        if retained > MAX_RETAINED_TRAVERSAL_NODES {
            return Err(CODE_LIMIT);
        }
        let mut parts = request.extra.split('\n');
        let node_id = parts.next().unwrap_or("");
        let depth_limit = parts
            .next()
            .unwrap_or("1")
            .parse::<u32>()
            .unwrap_or(1)
            .clamp(1, 32);
        let relation = parts.next().unwrap_or("*").to_owned();
        let direction = match parts.next().unwrap_or("out") {
            "in" => "in",
            "both" => "both",
            _ => "out",
        };
        let node_intern = graph.find_string(node_id).map_err(|_| CODE_CURSOR)?;
        let id = *next_state;
        *next_state = next_state.wrapping_add(0x9E37_79B9_7F4A_7C15) | 1;
        let mut visited = HashSet::new();
        visited.insert(node_intern);
        let mut queue = VecDeque::new();
        queue.push_back((node_intern, 0u32, 0usize));
        states.insert(
            id,
            TraverseState {
                depth_limit,
                relation,
                direction: direction.to_owned(),
                origin: node_id.to_owned(),
                queue,
                visited,
                emitted: HashSet::new(),
                nodes_seen: 1,
                edges_seen: 0,
                touched: Instant::now(),
            },
        );
        id
    };
    let state = states.get_mut(&state_id).ok_or(CODE_CURSOR)?;
    state.touched = Instant::now();
    let mut items = Vec::new();
    let mut bytes = 2usize;
    let mut failure: Option<u32> = None;
    while items.len() < request.page_size as usize {
        if request
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            failure = Some(CODE_CANCELLED);
            break;
        }
        if state.nodes_seen > 10_000 || state.edges_seen > 50_000 {
            failure = Some(CODE_LIMIT);
            break;
        }
        let Some((node, depth, slot)) = state.queue.front().copied() else {
            break;
        };
        let neighbors = adjacent(graph, &state.direction, node, &state.relation);
        if slot >= neighbors.len() || depth >= state.depth_limit {
            state.queue.pop_front();
            continue;
        }
        let edge_index = neighbors[slot];
        state.queue.front_mut().map(|entry| entry.2 = slot + 1);
        let relation = graph
            .string(graph.edges[edge_index].relation)
            .map_err(|_| CODE_PROTOCOL)?;
        if state.relation != "*" && state.relation != relation {
            continue;
        }
        let destination = if state.direction == "in" {
            graph.edges[edge_index].from
        } else if state.direction == "both" {
            let edge = &graph.edges[edge_index];
            if edge.to == node {
                edge.from
            } else {
                edge.to
            }
        } else {
            graph.edges[edge_index].to
        };
        if depth + 1 < state.depth_limit && state.visited.insert(destination) {
            state.nodes_seen = state.nodes_seen.saturating_add(1);
            state.queue.push_back((destination, depth + 1, 0));
        }
        if !state.emitted.insert(edge_index) {
            continue;
        }
        let record = graph.edge_json(edge_index).map_err(|_| CODE_PROTOCOL)?;
        let addition = record.len() + usize::from(!items.is_empty());
        if bytes + addition > request.max_bytes as usize {
            state.emitted.remove(&edge_index);
            if items.is_empty() {
                failure = Some(CODE_LIMIT);
                break;
            }
            if let Some(entry) = state.queue.front_mut() {
                entry.2 = slot;
            }
            break;
        }
        bytes += addition;
        items.push(record);
        state.edges_seen = state.edges_seen.saturating_add(1);
    }
    if let Some(code) = failure {
        return drop_traversal(states, state_id, code);
    }
    let token = traversal_token(graph, state_id, states.get(&state_id).ok_or(CODE_CURSOR)?);
    let exhausted = states
        .get(&state_id)
        .map(|state| state.queue.is_empty())
        .unwrap_or(true);
    if exhausted {
        states.remove(&state_id);
    }
    Ok((
        format!("[{}]", items.join(",")),
        cursor_text(graph, "traverse", 0, &token),
        exhausted,
    ))
}

fn read_u32(input: &mut impl Read) -> io::Result<u32> {
    let mut bytes = [0u8; 4];
    input.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn write_frame(payload: &[u8]) -> Result<(), ()> {
    let mut stdout = io::stdout().lock();
    let length = u32::try_from(payload.len()).map_err(|_| ())?;
    stdout.write_all(&length.to_le_bytes()).map_err(|_| ())?;
    stdout.write_all(payload).map_err(|_| ())?;
    stdout.flush().map_err(|_| ())
}

fn write_response(
    status: u32,
    code: u32,
    exhausted: bool,
    cursor: &str,
    json: &str,
) -> Result<(), ()> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&status.to_le_bytes());
    payload.extend_from_slice(&code.to_le_bytes());
    payload.extend_from_slice(&(u32::from(exhausted)).to_le_bytes());
    let cursor_bytes = cursor.as_bytes();
    payload.extend_from_slice(&(cursor_bytes.len() as u32).to_le_bytes());
    payload.extend_from_slice(cursor_bytes);
    let json_bytes = json.as_bytes();
    payload.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    payload.extend_from_slice(json_bytes);
    write_frame(&payload)
}

fn query_kind(code: u8) -> Result<&'static str, u32> {
    match code {
        1 => Ok("nodes"),
        2 => Ok("edges"),
        3 => Ok("dependencies"),
        4 => Ok("proofs"),
        5 => Ok("unresolved"),
        6 => Ok("decisions"),
        7 => Ok("traverse"),
        8 => Ok("export"),
        9 => Ok("orphans"),
        _ => Err(CODE_UNSUPPORTED),
    }
}

struct OpenedQuery {
    graph: PackedGraph,
    path: String,
    len: u64,
    modified: SystemTime,
}

fn snapshot_stamp(path: &str) -> Result<(u64, SystemTime), u32> {
    let meta = std::fs::metadata(path).map_err(|_| CODE_IO)?;
    Ok((
        meta.len(),
        meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
    ))
}

pub fn serve_packed_queries() -> Result<(), ()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut opened: Option<OpenedQuery> = None;
    let mut closed = false;
    let mut traversals: HashMap<u64, TraverseState> = HashMap::new();
    let mut next_traversal = (std::process::id() as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    loop {
        let length = match read_u32(&mut input) {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(_) => return Err(()),
        };
        if length == 0 || length > MAX_FRAME {
            let _ = write_response(1, CODE_PROTOCOL, true, "", "");
            return Err(());
        }
        let mut payload = vec![0u8; length as usize];
        if input.read_exact(&mut payload).is_err() {
            return Err(());
        }
        let kind = *payload.first().ok_or(())?;
        let body = &payload[1..];
        match kind {
            KIND_OPEN => {
                if closed {
                    let _ = write_response(1, CODE_CLOSED, true, "", "");
                    continue;
                }
                if body.len() < 4 {
                    let _ = write_response(1, CODE_PROTOCOL, true, "", "");
                    continue;
                }
                let path_len = u32::from_le_bytes(body[0..4].try_into().unwrap()) as usize;
                if body.len() != 4 + path_len {
                    let _ = write_response(1, CODE_PROTOCOL, true, "", "");
                    continue;
                }
                let path = std::str::from_utf8(&body[4..]).map_err(|_| ())?;
                let file_name = Path::new(path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("");
                // Mapped pages replace an anonymous copy of the file. The node,
                // edge, and adjacency indexes built below are still resident for
                // the whole snapshot.
                let bytes = map_snapshot(path).map_err(|_| ())?;
                let (len, modified) = snapshot_stamp(path).map_err(|_| ())?;
                let graph = if bytes.as_slice().starts_with(b"WGP2") {
                    open_segmented(path, bytes).map_err(|_| ())?
                } else {
                    open_packed(bytes).map_err(|_| ())?
                };
                if file_name != graph.digest {
                    let _ = write_response(1, CODE_MISMATCH, true, "", "");
                    continue;
                }
                let digest = graph.digest.clone();
                traversals.clear();
                opened = Some(OpenedQuery {
                    graph,
                    path: path.to_owned(),
                    len,
                    modified,
                });
                let mut response = Vec::new();
                response.extend_from_slice(&0u32.to_le_bytes());
                response.extend_from_slice(&CODE_OK.to_le_bytes());
                response.extend_from_slice(digest.as_bytes());
                write_frame(&response)?;
            }
            KIND_QUERY => {
                let Some(opened_query) = opened.as_ref() else {
                    let _ = write_response(1, CODE_NOT_OPEN, true, "", "");
                    continue;
                };
                if closed {
                    let _ = write_response(1, CODE_CLOSED, true, "", "");
                    continue;
                }
                match snapshot_stamp(&opened_query.path) {
                    Ok((len, modified))
                        if len == opened_query.len && modified == opened_query.modified => {}
                    Ok(_) => {
                        let _ = write_response(1, CODE_STALE, true, "", "");
                        continue;
                    }
                    Err(code) => {
                        let _ = write_response(1, code, true, "", "");
                        continue;
                    }
                }
                let graph = &opened_query.graph;
                match decode_query(graph, body) {
                    Ok(request) if request.kind == "traverse" => {
                        match page_traverse(graph, &request, &mut traversals, &mut next_traversal) {
                            Ok((json, cursor, exhausted)) => {
                                write_response(0, CODE_OK, exhausted, &cursor, &json)?;
                            }
                            Err(code) => {
                                let _ = write_response(1, code, true, "", "");
                            }
                        }
                    }
                    Ok(request) => match page(graph, &request) {
                        Ok((json, cursor, exhausted)) => {
                            write_response(0, CODE_OK, exhausted, &cursor, &json)?;
                        }
                        Err(code) => {
                            let _ = write_response(1, code, true, "", "");
                        }
                    },
                    Err(code) => {
                        let _ = write_response(1, code, true, "", "");
                    }
                }
            }
            KIND_CLOSE => {
                closed = true;
                opened = None;
                traversals.clear();
                write_response(0, CODE_OK, true, "", "")?;
            }
            _ => {
                let _ = write_response(1, CODE_UNSUPPORTED, true, "", "");
            }
        }
    }
}

fn decode_query(graph: &PackedGraph, mut body: &[u8]) -> Result<PageRequest, u32> {
    if body.len() < 17 {
        return Err(CODE_PROTOCOL);
    }
    let kind = query_kind(body[0])?;
    body = &body[1..];
    let page_size = read_body_u32(&mut body)?;
    let max_bytes = read_body_u32(&mut body)?;
    let deadline_ms = read_body_u32(&mut body)?;
    if page_size == 0 || page_size > MAX_PAGE || max_bytes < 64 || max_bytes > MAX_RESPONSE_BYTES {
        return Err(CODE_PROTOCOL);
    }
    let cursor = read_body_text(&mut body)?;
    let extra = read_body_text(&mut body)?;
    if !body.is_empty() {
        return Err(CODE_PROTOCOL);
    }
    let (index, cursor_extra) = parse_cursor(graph, &cursor, kind)?;
    if !cursor.is_empty() && !extra.is_empty() && extra != cursor_extra && kind != "dependencies" {
        return Err(CODE_CURSOR);
    }
    let stored_extra = if cursor.is_empty() {
        extra
    } else {
        cursor_extra
    };
    Ok(PageRequest {
        kind: kind.to_owned(),
        index,
        extra: stored_extra,
        page_size,
        max_bytes,
        deadline: deadline(deadline_ms),
    })
}

fn deadline(milliseconds: u32) -> Option<Instant> {
    if milliseconds == 0 {
        None
    } else {
        Some(Instant::now() + Duration::from_millis(u64::from(milliseconds)))
    }
}

fn read_body_u32(body: &mut &[u8]) -> Result<u32, u32> {
    if body.len() < 4 {
        return Err(CODE_PROTOCOL);
    }
    let value = u32::from_le_bytes(body[0..4].try_into().unwrap());
    *body = &body[4..];
    Ok(value)
}

fn read_body_text(body: &mut &[u8]) -> Result<String, u32> {
    let length = read_body_u32(body)? as usize;
    if body.len() < length {
        return Err(CODE_PROTOCOL);
    }
    let text = std::str::from_utf8(&body[..length])
        .map_err(|_| CODE_PROTOCOL)?
        .to_owned();
    *body = &body[length..];
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::{open_packed, SnapshotBytes};

    #[test]
    fn empty_snapshot_has_no_pages() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"WGP1");
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        let graph = open_packed(SnapshotBytes::Owned(bytes)).expect("packed");
        assert!(graph.node_offsets.is_empty());
        assert!(graph.edges.is_empty());
        assert!(graph.orphan_indexes().is_empty());
    }
}
