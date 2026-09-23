//! Structured graph composition.
//!
//! Facts live in an interned table. Canonical JSON is spilled in bounded runs
//! for the fact-set digest and is not retained. The publication stream is the
//! only long-lived JSON.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[path = "resident_engine.rs"]
mod resident;
pub use resident::{ResidentEngine, ResidentFact, ResidentPartition};

use crate::collate::compare_canonical_key;
use crate::compose::{
    compose_fact_canonical, ComposeError, COMPACT_FACT_MAGIC, COMPACT_FACT_VERSION,
};
use crate::sha256::{hex32, Sha256};

const CANONICAL_NAME: &str = "workspai.graph.canonical-json.v1";
const MAX_FACTS: usize = 1_000_000;
const SPILL_LIMIT: usize = 8 * 1024 * 1024;
const NONE: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ComposeFailure {
    Limit,
    Index,
    Parse,
    Io,
    Protocol,
}

#[derive(Clone, Debug)]
pub struct RelationSpec {
    pub kind: String,
    pub semantics: String,
    pub subject_families: Vec<String>,
    pub object_families: Vec<String>,
    pub authorities: Vec<String>,
    pub policy_id: String,
    pub policy_version: String,
}

#[derive(Clone, Debug)]
pub struct LineageSpec {
    pub fact_id: String,
    pub derivation: String,
    pub roots: Vec<String>,
    pub parents: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ComposeRequest {
    pub fact_count: u32,
    pub ranges: Vec<(u32, u32)>,
    pub minimum_confidence: f64,
    pub inferred_reject: bool,
    pub unknown_freshness_reject: bool,
    pub max_edges: u32,
    pub evaluated_at: String,
    pub architecture_epoch: String,
    pub graph_version: String,
    pub schema_id: String,
    pub schema_version: String,
    pub ontology_id: String,
    pub ontology_version: String,
    pub entities: Vec<(String, String)>,
    pub relations: Vec<RelationSpec>,
    pub functional: Vec<String>,
    pub digests: [String; 5],
    pub lineages: Vec<LineageSpec>,
    pub canonical_path: String,
    pub packed_path: String,
}

#[derive(Clone, Debug)]
pub struct ComposeOutput {
    pub fact_digest: String,
    pub content_digest: String,
    pub facts: u64,
    pub nodes: u64,
    pub edges: u64,
    pub packed_bytes: u64,
    pub canonical_bytes: u64,
    pub spill_bytes: u64,
    pub retained_canonical_bytes: u64,
    pub decisions: u32,
    pub unresolved: u32,
    pub proof_supported: u32,
    pub proof_corroborated: u32,
    pub proof_verified: u32,
    pub proof_disputed: u32,
    pub proof_insufficient: u32,
    pub proof_unresolved: u32,
    pub decisions_accepted: u32,
    pub decisions_rejected: u32,
    pub decisions_disputed: u32,
    pub decisions_unresolved: u32,
    pub orphans: u32,
    pub orphan_truncated: u32,
    pub orphan_records: Vec<u8>,
    pub stale_facts: u32,
    pub ingest_ms: u64,
    pub digest_ms: u64,
    pub edge_ms: u64,
    pub publish_ms: u64,
    pub affected_facts: u64,
    pub parsed_facts: u64,
}

struct Interner {
    strings: Vec<String>,
    index: HashMap<String, u32>,
}

impl Interner {
    fn new() -> Self {
        let mut index = HashMap::new();
        index.insert(String::new(), 0);
        Self {
            strings: vec![String::new()],
            index,
        }
    }

    fn intern(&mut self, value: &str) -> Result<u32, ComposeFailure> {
        if let Some(id) = self.index.get(value) {
            return Ok(*id);
        }
        if self.strings.len() >= u32::MAX as usize {
            return Err(ComposeFailure::Limit);
        }
        let id = self.strings.len() as u32;
        self.strings.push(value.to_owned());
        self.index.insert(value.to_owned(), id);
        Ok(id)
    }

    fn get(&self, id: u32) -> &str {
        self.strings
            .get(id as usize)
            .map(String::as_str)
            .unwrap_or("")
    }

    fn id_of(&self, value: &str) -> Option<u32> {
        self.index.get(value).copied()
    }
}

#[derive(Clone, PartialEq)]
struct Evidence {
    algorithm: u32,
    canonicalization: u32,
    value: u32,
    id: u32,
    locator: u32,
    source_kind: u32,
}

#[derive(Clone, PartialEq)]
struct Entity {
    id: u32,
    scheme: u32,
    kind: u32,
    scope: u32,
    aliases: Vec<(u32, u32)>,
}

#[derive(Clone)]
struct Fact {
    authority: u32,
    confidence: f64,
    derivation: u32,
    evidence: Vec<Evidence>,
    fact_id: u32,
    freshness: u32,
    renewal: u32,
    valid_until: u32,
    input_digest: u32,
    predicate: u32,
    subject: Entity,
    object: Option<Entity>,
}

struct Store {
    intern: Interner,
    slots: Vec<Option<Fact>>,
}

impl Store {
    fn new(count: u32) -> Result<Self, ComposeFailure> {
        if count as usize > MAX_FACTS {
            return Err(ComposeFailure::Limit);
        }
        Ok(Self {
            intern: Interner::new(),
            slots: (0..count).map(|_| None).collect(),
        })
    }

    fn place(&mut self, index: u32, fact: Fact) -> Result<(), ComposeFailure> {
        let slot = self
            .slots
            .get_mut(index as usize)
            .ok_or(ComposeFailure::Index)?;
        if slot.is_some() {
            return Err(ComposeFailure::Index);
        }
        *slot = Some(fact);
        Ok(())
    }

    fn complete(&self) -> bool {
        self.slots.iter().all(Option::is_some)
    }
}

struct SpillSorter {
    dir: PathBuf,
    runs: Vec<PathBuf>,
    pending: Vec<(u32, String)>,
    pending_bytes: usize,
    spilled_bytes: u64,
}

impl SpillSorter {
    fn new() -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SPILL_SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "workspai-compose-{}-{}",
            std::process::id(),
            SPILL_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::create_dir_all(&dir);
        Self {
            dir,
            runs: Vec::new(),
            pending: Vec::new(),
            pending_bytes: 0,
            spilled_bytes: 0,
        }
    }

    fn push(&mut self, index: u32, key: String) -> Result<(), ComposeFailure> {
        self.pending_bytes += key.len();
        self.pending.push((index, key));
        if self.pending_bytes >= SPILL_LIMIT {
            self.flush()?;
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), ComposeFailure> {
        if self.pending.is_empty() {
            return Ok(());
        }
        self.pending.sort_by(|left, right| {
            compare_canonical_key(&left.1, &right.1).then(left.0.cmp(&right.0))
        });
        let path = self.dir.join(format!("run-{}", self.runs.len()));
        let mut file = File::create(&path).map_err(|_| ComposeFailure::Io)?;
        let count = self.pending.len() as u32;
        file.write_all(&count.to_le_bytes())
            .map_err(|_| ComposeFailure::Io)?;
        for (index, key) in &self.pending {
            let bytes = key.as_bytes();
            file.write_all(&index.to_le_bytes())
                .map_err(|_| ComposeFailure::Io)?;
            file.write_all(&(bytes.len() as u32).to_le_bytes())
                .map_err(|_| ComposeFailure::Io)?;
            file.write_all(bytes).map_err(|_| ComposeFailure::Io)?;
            self.spilled_bytes += bytes.len() as u64;
        }
        self.runs.push(path);
        self.pending.clear();
        self.pending_bytes = 0;
        Ok(())
    }

    fn digest(mut self) -> Result<(String, u64), ComposeFailure> {
        self.flush()?;
        let mut readers: Vec<RunCursor> = Vec::new();
        for path in &self.runs {
            readers.push(RunCursor::open(path)?);
        }
        if !self.pending.is_empty() {
            self.pending.sort_by(|left, right| {
                compare_canonical_key(&left.1, &right.1).then(left.0.cmp(&right.0))
            });
        }
        let memory = std::mem::take(&mut self.pending);
        let mut memory_at = 0usize;
        #[derive(Eq, PartialEq)]
        struct Item {
            key: String,
            index: u32,
            source: usize,
        }
        impl Ord for Item {
            fn cmp(&self, other: &Self) -> Ordering {
                compare_canonical_key(&other.key, &self.key)
                    .then(other.index.cmp(&self.index))
                    .then(other.source.cmp(&self.source))
            }
        }
        impl PartialOrd for Item {
            fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
                Some(self.cmp(other))
            }
        }
        let mut heap = BinaryHeap::new();
        for (source, reader) in readers.iter_mut().enumerate() {
            if let Some((index, key)) = reader.next_key()? {
                heap.push(Item { key, index, source });
            }
        }
        if memory_at < memory.len() {
            let (index, key) = memory[memory_at].clone();
            memory_at += 1;
            heap.push(Item {
                key,
                index,
                source: usize::MAX,
            });
        }
        let mut hasher = Sha256::new();
        hasher.update(b"[");
        let mut first = true;
        let spilled = self.spilled_bytes;
        while let Some(item) = heap.pop() {
            if !first {
                hasher.update(b",");
            }
            first = false;
            hasher.update(item.key.as_bytes());
            if item.source == usize::MAX {
                if memory_at < memory.len() {
                    let (index, key) = memory[memory_at].clone();
                    memory_at += 1;
                    heap.push(Item {
                        key,
                        index,
                        source: usize::MAX,
                    });
                }
            } else if let Some((index, key)) = readers[item.source].next_key()? {
                heap.push(Item {
                    key,
                    index,
                    source: item.source,
                });
            }
        }
        hasher.update(b"]");
        let digest = hex32(&hasher.finish());
        for path in &self.runs {
            let _ = fs::remove_file(path);
        }
        let _ = fs::remove_dir(&self.dir);
        Ok((digest, spilled))
    }
}

impl Drop for SpillSorter {
    fn drop(&mut self) {
        for path in &self.runs {
            let _ = fs::remove_file(path);
        }
        let _ = fs::remove_dir(&self.dir);
    }
}

struct RunCursor {
    reader: BufReader<File>,
    remaining: u32,
}

impl RunCursor {
    fn open(path: &PathBuf) -> Result<Self, ComposeFailure> {
        let mut reader = BufReader::new(File::open(path).map_err(|_| ComposeFailure::Io)?);
        let mut count = [0u8; 4];
        reader
            .read_exact(&mut count)
            .map_err(|_| ComposeFailure::Io)?;
        Ok(Self {
            reader,
            remaining: u32::from_le_bytes(count),
        })
    }

    fn next_key(&mut self) -> Result<Option<(u32, String)>, ComposeFailure> {
        if self.remaining == 0 {
            return Ok(None);
        }
        self.remaining -= 1;
        let mut index = [0u8; 4];
        let mut length = [0u8; 4];
        self.reader
            .read_exact(&mut index)
            .map_err(|_| ComposeFailure::Io)?;
        self.reader
            .read_exact(&mut length)
            .map_err(|_| ComposeFailure::Io)?;
        let mut bytes = vec![0u8; u32::from_le_bytes(length) as usize];
        self.reader
            .read_exact(&mut bytes)
            .map_err(|_| ComposeFailure::Io)?;
        let key = String::from_utf8(bytes).map_err(|_| ComposeFailure::Parse)?;
        Ok(Some((u32::from_le_bytes(index), key)))
    }
}

pub struct Composer {
    store: Store,
    sorter: SpillSorter,
    started: Instant,
}

impl Composer {
    pub fn new(fact_count: u32) -> Result<Self, ComposeFailure> {
        Ok(Self {
            store: Store::new(fact_count)?,
            sorter: SpillSorter::new(),
            started: Instant::now(),
        })
    }

    pub fn ingest_compact(&mut self, base: u32, bytes: &[u8]) -> Result<u32, ComposeFailure> {
        let rendered = compose_fact_canonical(bytes).map_err(map_compose)?;
        let parsed = parse_compact_facts(bytes, &mut self.store.intern)?;
        if rendered.len() != parsed.len() {
            return Err(ComposeFailure::Parse);
        }
        let facts = u32::try_from(parsed.len()).map_err(|_| ComposeFailure::Limit)?;
        for (offset, key) in rendered.into_iter().enumerate() {
            let index = base
                .checked_add(offset as u32)
                .ok_or(ComposeFailure::Index)?;
            self.sorter.push(index, key)?;
        }
        for (offset, fact) in parsed.into_iter().enumerate() {
            let index = base
                .checked_add(offset as u32)
                .ok_or(ComposeFailure::Index)?;
            self.store.place(index, fact)?;
        }
        Ok(facts)
    }

    pub fn ingest_canonical(&mut self, index: u32, json: &str) -> Result<(), ComposeFailure> {
        let fact = parse_canonical_fact(json, &mut self.store.intern)?;
        self.sorter.push(index, json.to_owned())?;
        self.store.place(index, fact)?;
        Ok(())
    }

    pub fn set_valid_until(&mut self, index: u32, value: &str) -> Result<(), ComposeFailure> {
        let fact = self
            .store
            .slots
            .get_mut(index as usize)
            .and_then(Option::as_mut)
            .ok_or(ComposeFailure::Index)?;
        fact.valid_until = self.store.intern.intern(value)?;
        Ok(())
    }

    pub fn finish(mut self, request: &ComposeRequest) -> Result<ComposeOutput, ComposeFailure> {
        let ingest_ms = self.started.elapsed().as_millis() as u64;
        if request.fact_count as usize != self.store.slots.len() || !self.store.complete() {
            return Err(ComposeFailure::Index);
        }
        validate_ranges(request)?;
        let _ = self.store.intern.intern(&request.evaluated_at)?;
        let Composer {
            mut store, sorter, ..
        } = self;
        let (fact_digest, spill_bytes, digest_ms, built, edge_ms) = std::thread::scope(|scope| {
            let digest_task = scope.spawn(|| {
                let digest_started = Instant::now();
                let digested = sorter.digest();
                (digested, digest_started.elapsed().as_millis() as u64)
            });
            let edge_started = Instant::now();
            let built = build_graph(
                &mut store,
                request,
                Selective {
                    only_slots: None,
                    previous: None,
                    touched_fact_ids: None,
                    identity: None,
                },
            );
            let edge_ms = edge_started.elapsed().as_millis() as u64;
            let (digested, digest_ms) = digest_task.join().map_err(|_| ComposeFailure::Io)?;
            let (fact_digest, spill_bytes) = digested?;
            Ok::<_, ComposeFailure>((fact_digest, spill_bytes, digest_ms, built?, edge_ms))
        })?;
        let affected = store.slots.len() as u64;
        complete_output(
            &store,
            request,
            fact_digest,
            spill_bytes,
            &built,
            ingest_ms,
            digest_ms,
            edge_ms,
            affected,
            affected,
        )
    }
}

fn complete_output(
    store: &Store,
    request: &ComposeRequest,
    fact_digest: String,
    spill_bytes: u64,
    built: &Built,
    ingest_ms: u64,
    digest_ms: u64,
    edge_ms: u64,
    affected_facts: u64,
    parsed_facts: u64,
) -> Result<ComposeOutput, ComposeFailure> {
    let quality = quality_counts(store, built);
    let (orphan_truncated, orphan_records) = encode_orphans(store, built);
    let publish_started = Instant::now();
    let published = publish(store, request, &fact_digest, built)?;
    let publish_ms = publish_started.elapsed().as_millis() as u64;
    Ok(ComposeOutput {
        fact_digest,
        content_digest: published.content_digest,
        facts: store.slots.len() as u64,
        nodes: built.nodes.len() as u64,
        edges: built.edges.len() as u64,
        packed_bytes: published.packed_bytes,
        canonical_bytes: published.canonical_bytes,
        spill_bytes,
        retained_canonical_bytes: 0,
        decisions: built.decisions.len() as u32,
        unresolved: built.unresolved.len() as u32,
        proof_supported: quality[0],
        proof_corroborated: quality[1],
        proof_verified: quality[2],
        proof_disputed: quality[3],
        proof_insufficient: quality[4],
        proof_unresolved: quality[5],
        decisions_accepted: quality[6],
        decisions_rejected: quality[7],
        decisions_disputed: quality[8],
        decisions_unresolved: quality[9],
        orphans: quality[10],
        orphan_truncated,
        orphan_records,
        stale_facts: quality[11],
        ingest_ms,
        digest_ms,
        edge_ms,
        publish_ms,
        affected_facts,
        parsed_facts,
    })
}

fn quality_counts(store: &Store, built: &Built) -> [u32; 12] {
    let mut counts = [0u32; 12];
    for edge in &built.edges {
        let slot = match edge.proof_state {
            "supported" => 0,
            "corroborated" => 1,
            "verified" => 2,
            "disputed" => 3,
            "insufficient" => 4,
            "unresolved" => 5,
            _ => continue,
        };
        counts[slot] = counts[slot].saturating_add(1);
    }
    for decision in &built.decisions {
        if decision.included {
            continue;
        }
        let slot = match decision.state {
            "accepted" => 6,
            "rejected" => 7,
            "disputed" => 8,
            "unresolved" => 9,
            _ => continue,
        };
        counts[slot] = counts[slot].saturating_add(1);
    }
    let mut endpoints = HashSet::<u32>::new();
    for edge in &built.edges {
        endpoints.insert(edge.from);
        endpoints.insert(edge.to);
    }
    counts[10] = built
        .nodes
        .iter()
        .filter(|node| !endpoints.contains(&node.id))
        .count() as u32;
    counts[11] = store
        .slots
        .iter()
        .filter(|slot| {
            slot.as_ref()
                .is_some_and(|fact| store.intern.get(fact.freshness) == "stale")
        })
        .count() as u32;
    counts
}

fn push_counted_str(out: &mut Vec<u8>, value: &str) -> bool {
    let bytes = value.as_bytes();
    let Ok(length) = u32::try_from(bytes.len()) else {
        return false;
    };
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(bytes);
    true
}

fn encode_orphans(store: &Store, built: &Built) -> (u32, Vec<u8>) {
    let mut endpoints = HashSet::<u32>::new();
    for edge in &built.edges {
        endpoints.insert(edge.from);
        endpoints.insert(edge.to);
    }
    let mut blob = Vec::new();
    for node in &built.nodes {
        if endpoints.contains(&node.id) {
            continue;
        }
        let before = blob.len();
        let encoded = push_counted_str(&mut blob, store.intern.get(node.id))
            && push_counted_str(&mut blob, store.intern.get(node.kind))
            && push_counted_str(&mut blob, store.intern.get(node.scheme))
            && push_counted_str(&mut blob, store.intern.get(node.scope));
        if !encoded {
            return (1, Vec::new());
        }
        let Ok(alias_count) = u32::try_from(node.aliases.len()) else {
            return (1, Vec::new());
        };
        blob.extend_from_slice(&alias_count.to_le_bytes());
        for (id, reason) in &node.aliases {
            if !push_counted_str(&mut blob, store.intern.get(*id))
                || !push_counted_str(&mut blob, store.intern.get(*reason))
            {
                return (1, Vec::new());
            }
        }
        if blob.len() > 8 * 1024 * 1024 {
            blob.truncate(before);
            return (1, Vec::new());
        }
    }
    (0, blob)
}

fn map_compose(error: ComposeError) -> ComposeFailure {
    match error {
        ComposeError::Limit => ComposeFailure::Limit,
        ComposeError::Truncated | ComposeError::Invalid => ComposeFailure::Parse,
    }
}

fn validate_ranges(request: &ComposeRequest) -> Result<(), ComposeFailure> {
    if request.fact_count == 0 {
        return if request.ranges.is_empty() {
            Ok(())
        } else {
            Err(ComposeFailure::Index)
        };
    }
    let mut cursor = 0u32;
    for (start, end) in &request.ranges {
        if *start != cursor || *end < *start || *end > request.fact_count {
            return Err(ComposeFailure::Index);
        }
        cursor = *end;
    }
    if cursor != request.fact_count {
        Err(ComposeFailure::Index)
    } else {
        Ok(())
    }
}

struct Reader<'a> {
    input: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn rest(&self) -> usize {
        self.input.len().saturating_sub(self.at)
    }
    fn u32(&mut self) -> Result<u32, ComposeFailure> {
        if self.rest() < 4 {
            return Err(ComposeFailure::Parse);
        }
        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(&self.input[self.at..self.at + 4]);
        self.at += 4;
        Ok(u32::from_le_bytes(bytes))
    }
    fn bytes(&mut self, length: usize) -> Result<&'a [u8], ComposeFailure> {
        if self.rest() < length {
            return Err(ComposeFailure::Parse);
        }
        let slice = &self.input[self.at..self.at + length];
        self.at += length;
        Ok(slice)
    }
}

fn parse_compact_facts(input: &[u8], intern: &mut Interner) -> Result<Vec<Fact>, ComposeFailure> {
    let mut reader = Reader { input, at: 0 };
    let magic = reader.bytes(4)?;
    if magic != COMPACT_FACT_MAGIC {
        return Err(ComposeFailure::Parse);
    }
    if reader.u32()? != COMPACT_FACT_VERSION {
        return Err(ComposeFailure::Parse);
    }
    let fact_count = reader.u32()? as usize;
    let string_count = reader.u32()? as usize;
    if string_count == 0 {
        return Err(ComposeFailure::Parse);
    }
    let mut strings = Vec::with_capacity(string_count);
    for _ in 0..string_count {
        let length = reader.u32()? as usize;
        let bytes = reader.bytes(length)?;
        strings.push(std::str::from_utf8(bytes).map_err(|_| ComposeFailure::Parse)?);
    }
    if strings.first() != Some(&"") {
        return Err(ComposeFailure::Parse);
    }
    let mut facts = Vec::with_capacity(fact_count);
    for _ in 0..fact_count {
        facts.push(parse_compact_fact(&mut reader, &strings, intern)?);
    }
    if reader.rest() != 0 {
        return Err(ComposeFailure::Parse);
    }
    Ok(facts)
}

fn required<'a>(strings: &[&'a str], id: u32) -> Result<&'a str, ComposeFailure> {
    strings
        .get(id as usize)
        .copied()
        .filter(|value| !value.is_empty())
        .ok_or(ComposeFailure::Parse)
}

fn parse_compact_fact(
    reader: &mut Reader<'_>,
    strings: &[&str],
    intern: &mut Interner,
) -> Result<Fact, ComposeFailure> {
    let flags = reader.u32()?;
    let authority = intern.intern(required(strings, reader.u32()?)?)?;
    let confidence = required(strings, reader.u32()?)?
        .parse::<f64>()
        .map_err(|_| ComposeFailure::Parse)?;
    let derivation = intern.intern(required(strings, reader.u32()?)?)?;
    let evidence = parse_compact_evidence(reader, strings, intern)?;
    if flags & 1 != 0 {
        skip_compact_extensions(reader)?;
    }
    let fact_id = intern.intern(required(strings, reader.u32()?)?)?;
    let _fact_type = required(strings, reader.u32()?)?;
    let freshness = intern.intern(required(strings, reader.u32()?)?)?;
    let renewal = if flags & 4 != 0 {
        intern.intern(required(strings, reader.u32()?)?)?
    } else {
        NONE
    };
    let input_digest = intern.intern(required(strings, reader.u32()?)?)?;
    let object = if flags & 2 != 0 {
        let _kind = required(strings, reader.u32()?)?;
        let _token = required(strings, reader.u32()?)?;
        None
    } else {
        Some(parse_compact_entity(reader, strings, intern)?)
    };
    let predicate = intern.intern(required(strings, reader.u32()?)?)?;
    let _provider = required(strings, reader.u32()?)?;
    let _version = required(strings, reader.u32()?)?;
    let _scope = required(strings, reader.u32()?)?;
    let subject = parse_compact_entity(reader, strings, intern)?;
    let lifecycle = reader.u32()? as usize;
    if lifecycle > 8 {
        return Err(ComposeFailure::Limit);
    }
    for _ in 0..lifecycle {
        let _id = required(strings, reader.u32()?)?;
    }
    Ok(Fact {
        authority,
        confidence,
        derivation,
        evidence,
        fact_id,
        freshness,
        renewal,
        valid_until: NONE,
        input_digest,
        predicate,
        subject,
        object,
    })
}

fn parse_compact_evidence(
    reader: &mut Reader<'_>,
    strings: &[&str],
    intern: &mut Interner,
) -> Result<Vec<Evidence>, ComposeFailure> {
    let count = reader.u32()? as usize;
    if count > 64 {
        return Err(ComposeFailure::Limit);
    }
    let mut items = Vec::with_capacity(count);
    for _ in 0..count {
        let digest_flags = reader.u32()?;
        let algorithm = intern.intern(required(strings, reader.u32()?)?)?;
        let canonicalization = if digest_flags & 1 != 0 {
            intern.intern(required(strings, reader.u32()?)?)?
        } else {
            NONE
        };
        let value = intern.intern(required(strings, reader.u32()?)?)?;
        let id = intern.intern(required(strings, reader.u32()?)?)?;
        let locator = intern.intern(required(strings, reader.u32()?)?)?;
        let source_kind = intern.intern(required(strings, reader.u32()?)?)?;
        items.push(Evidence {
            algorithm,
            canonicalization,
            value,
            id,
            locator,
            source_kind,
        });
    }
    Ok(items)
}

fn skip_compact_extensions(reader: &mut Reader<'_>) -> Result<(), ComposeFailure> {
    let count = reader.u32()? as usize;
    if count == 0 || count > 16 {
        return Err(ComposeFailure::Limit);
    }
    for _ in 0..count * 2 {
        let _id = reader.u32()?;
    }
    Ok(())
}

fn parse_compact_entity(
    reader: &mut Reader<'_>,
    strings: &[&str],
    intern: &mut Interner,
) -> Result<Entity, ComposeFailure> {
    let id = intern.intern(required(strings, reader.u32()?)?)?;
    let scheme = intern.intern(required(strings, reader.u32()?)?)?;
    let kind = intern.intern(required(strings, reader.u32()?)?)?;
    let scope = intern.intern(required(strings, reader.u32()?)?)?;
    Ok(Entity {
        id,
        scheme,
        kind,
        scope,
        aliases: Vec::new(),
    })
}

fn parse_canonical_fact(json: &str, intern: &mut Interner) -> Result<Fact, ComposeFailure> {
    let mut cursor = JsonCursor { input: json, at: 0 };
    let fields = cursor.parse_object()?;
    if cursor.at != json.len() {
        return Err(ComposeFailure::Parse);
    }
    let authority = intern.intern(field_string(&fields, "authority")?)?;
    let confidence = field_number(&fields, "confidence")?;
    let derivation = intern.intern(field_string(&fields, "derivation")?)?;
    let evidence = parse_evidence_json(field_raw(&fields, "evidence")?, intern)?;
    let fact_id = intern.intern(field_string(&fields, "factId")?)?;
    let freshness_raw = field_raw(&fields, "freshness")?;
    let freshness_fields = JsonCursor {
        input: freshness_raw,
        at: 0,
    }
    .parse_object()?;
    let freshness = intern.intern(field_string(&freshness_fields, "status")?)?;
    let renewal = match freshness_fields.iter().find(|(key, _)| key == "renewal") {
        Some((_, JsonValue::String(value))) => intern.intern(value)?,
        Some(_) => return Err(ComposeFailure::Parse),
        None => NONE,
    };
    let input_digest = intern.intern(field_raw(&fields, "inputDigest")?)?;
    let predicate = intern.intern(field_string(&fields, "predicate")?)?;
    let subject = parse_entity_json(field_raw(&fields, "subject")?, intern)?;
    let object_raw = field_raw(&fields, "object")?;
    let object = if object_raw.contains("\"identityScheme\"") {
        Some(parse_entity_json(object_raw, intern)?)
    } else {
        None
    };
    Ok(Fact {
        authority,
        confidence,
        derivation,
        evidence,
        fact_id,
        freshness,
        renewal,
        valid_until: NONE,
        input_digest,
        predicate,
        subject,
        object,
    })
}

fn parse_entity_json(json: &str, intern: &mut Interner) -> Result<Entity, ComposeFailure> {
    let fields = JsonCursor { input: json, at: 0 }.parse_object()?;
    let id = intern.intern(field_string(&fields, "id")?)?;
    let scheme = intern.intern(field_raw(&fields, "identityScheme")?)?;
    let kind = intern.intern(field_string(&fields, "kind")?)?;
    let scope = intern.intern(field_raw(&fields, "scope")?)?;
    let mut aliases = Vec::new();
    if let Some((_, JsonValue::Raw(raw))) = fields.iter().find(|(key, _)| key == "aliases") {
        for item in parse_array(raw)? {
            let alias_fields = JsonCursor { input: item, at: 0 }.parse_object()?;
            aliases.push((
                intern.intern(field_string(&alias_fields, "id")?)?,
                intern.intern(field_string(&alias_fields, "reason")?)?,
            ));
        }
    }
    Ok(Entity {
        id,
        scheme,
        kind,
        scope,
        aliases,
    })
}

fn parse_evidence_json(json: &str, intern: &mut Interner) -> Result<Vec<Evidence>, ComposeFailure> {
    let mut items = Vec::new();
    for item in parse_array(json)? {
        let fields = JsonCursor { input: item, at: 0 }.parse_object()?;
        let digest = field_raw(&fields, "digest")?;
        let digest_fields = JsonCursor {
            input: digest,
            at: 0,
        }
        .parse_object()?;
        let canonicalization = match digest_fields
            .iter()
            .find(|(key, _)| key == "canonicalization")
        {
            Some((_, JsonValue::String(value))) => intern.intern(value)?,
            Some(_) => return Err(ComposeFailure::Parse),
            None => NONE,
        };
        items.push(Evidence {
            algorithm: intern.intern(field_string(&digest_fields, "algorithm")?)?,
            canonicalization,
            value: intern.intern(field_string(&digest_fields, "value")?)?,
            id: intern.intern(field_string(&fields, "id")?)?,
            locator: intern.intern(field_string(&fields, "relativeLocator")?)?,
            source_kind: intern.intern(field_string(&fields, "sourceKind")?)?,
        });
    }
    Ok(items)
}

enum JsonValue {
    String(String),
    Number(f64),
    Raw(String),
}

struct JsonCursor<'a> {
    input: &'a str,
    at: usize,
}

impl<'a> JsonCursor<'a> {
    fn parse_object(&mut self) -> Result<Vec<(String, JsonValue)>, ComposeFailure> {
        self.expect(b'{')?;
        let mut fields = Vec::new();
        if self.peek() == Some(b'}') {
            self.at += 1;
            return Ok(fields);
        }
        loop {
            let key = self.parse_string()?;
            self.expect(b':')?;
            let value = self.parse_value()?;
            fields.push((key, value));
            match self.peek() {
                Some(b',') => self.at += 1,
                Some(b'}') => {
                    self.at += 1;
                    break;
                }
                _ => return Err(ComposeFailure::Parse),
            }
        }
        Ok(fields)
    }

    fn parse_value(&mut self) -> Result<JsonValue, ComposeFailure> {
        match self.peek() {
            Some(b'"') => Ok(JsonValue::String(self.parse_string()?)),
            Some(b'{') | Some(b'[') => {
                let start = self.at;
                self.skip_raw()?;
                Ok(JsonValue::Raw(self.input[start..self.at].to_owned()))
            }
            Some(b't') => {
                self.literal(b"true")?;
                Ok(JsonValue::Raw("true".to_owned()))
            }
            Some(b'f') => {
                self.literal(b"false")?;
                Ok(JsonValue::Raw("false".to_owned()))
            }
            Some(b'n') => {
                self.literal(b"null")?;
                Ok(JsonValue::Raw("null".to_owned()))
            }
            Some(b'-') | Some(b'0'..=b'9') => {
                let start = self.at;
                if self.peek() == Some(b'-') {
                    self.at += 1;
                }
                while matches!(
                    self.peek(),
                    Some(b'0'..=b'9' | b'.' | b'e' | b'E' | b'+' | b'-')
                ) {
                    self.at += 1;
                }
                let text = &self.input[start..self.at];
                let number = text.parse::<f64>().map_err(|_| ComposeFailure::Parse)?;
                Ok(JsonValue::Number(number))
            }
            _ => Err(ComposeFailure::Parse),
        }
    }

    fn skip_raw(&mut self) -> Result<(), ComposeFailure> {
        let start = self.peek().ok_or(ComposeFailure::Parse)?;
        if start != b'{' && start != b'[' {
            return Err(ComposeFailure::Parse);
        }
        let mut depth = 0i32;
        let bytes = self.input.as_bytes();
        while self.at < bytes.len() {
            let byte = bytes[self.at];
            if byte == b'"' {
                self.parse_string()?;
                continue;
            }
            self.at += 1;
            if byte == b'{' || byte == b'[' {
                depth += 1;
            } else if byte == b'}' || byte == b']' {
                depth -= 1;
                if depth == 0 {
                    return Ok(());
                }
            }
        }
        Err(ComposeFailure::Parse)
    }

    fn parse_string(&mut self) -> Result<String, ComposeFailure> {
        self.expect(b'"')?;
        let bytes = self.input.as_bytes();
        let mut out = String::new();
        while self.at < bytes.len() {
            let byte = bytes[self.at];
            if byte == b'"' {
                self.at += 1;
                return Ok(out);
            }
            if byte == b'\\' {
                self.at += 1;
                let escape = *bytes.get(self.at).ok_or(ComposeFailure::Parse)?;
                self.at += 1;
                match escape {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{0008}'),
                    b'f' => out.push('\u{000c}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => {
                        let hex = self
                            .input
                            .get(self.at..self.at + 4)
                            .ok_or(ComposeFailure::Parse)?;
                        self.at += 4;
                        let unit =
                            u16::from_str_radix(hex, 16).map_err(|_| ComposeFailure::Parse)?;
                        out.push(char::from_u32(unit as u32).unwrap_or('\u{FFFD}'));
                    }
                    _ => return Err(ComposeFailure::Parse),
                }
                continue;
            }
            if byte < 0x80 {
                out.push(byte as char);
                self.at += 1;
                continue;
            }
            let width = if byte < 0xE0 {
                2
            } else if byte < 0xF0 {
                3
            } else {
                4
            };
            let end = self.at + width;
            let slice = self.input.get(self.at..end).ok_or(ComposeFailure::Parse)?;
            out.push_str(slice);
            self.at = end;
            continue;
        }
        Err(ComposeFailure::Parse)
    }

    fn literal(&mut self, text: &[u8]) -> Result<(), ComposeFailure> {
        if !self.input.as_bytes()[self.at..].starts_with(text) {
            return Err(ComposeFailure::Parse);
        }
        self.at += text.len();
        Ok(())
    }

    fn expect(&mut self, byte: u8) -> Result<(), ComposeFailure> {
        if self.peek() != Some(byte) {
            return Err(ComposeFailure::Parse);
        }
        self.at += 1;
        Ok(())
    }

    fn peek(&self) -> Option<u8> {
        self.input.as_bytes().get(self.at).copied()
    }
}

fn parse_array(json: &str) -> Result<Vec<&str>, ComposeFailure> {
    let bytes = json.as_bytes();
    if bytes.first() != Some(&b'[') {
        return Err(ComposeFailure::Parse);
    }
    if bytes.get(1) == Some(&b']') {
        return Ok(Vec::new());
    }
    let mut items = Vec::new();
    let mut cursor = JsonCursor { input: json, at: 1 };
    loop {
        let start = cursor.at;
        let _ = cursor.parse_value()?;
        items.push(&json[start..cursor.at]);
        match cursor.peek() {
            Some(b',') => cursor.at += 1,
            Some(b']') => break,
            _ => return Err(ComposeFailure::Parse),
        }
    }
    Ok(items)
}

fn field_string<'a>(
    fields: &'a [(String, JsonValue)],
    name: &str,
) -> Result<&'a str, ComposeFailure> {
    match fields.iter().find(|(key, _)| key == name) {
        Some((_, JsonValue::String(value))) => Ok(value),
        _ => Err(ComposeFailure::Parse),
    }
}

fn field_number(fields: &[(String, JsonValue)], name: &str) -> Result<f64, ComposeFailure> {
    match fields.iter().find(|(key, _)| key == name) {
        Some((_, JsonValue::Number(value))) => Ok(*value),
        _ => Err(ComposeFailure::Parse),
    }
}

fn field_raw<'a>(fields: &'a [(String, JsonValue)], name: &str) -> Result<&'a str, ComposeFailure> {
    match fields.iter().find(|(key, _)| key == name) {
        Some((_, JsonValue::Raw(value))) => Ok(value),
        _ => Err(ComposeFailure::Parse),
    }
}

#[derive(Clone)]
struct NodeOut {
    id: u32,
    scheme: u32,
    kind: u32,
    scope: u32,
    aliases: Vec<(u32, u32)>,
}

#[derive(Clone)]
struct DecisionOut {
    edge_key: String,
    state: &'static str,
    included: bool,
    fact_ids: Vec<u32>,
    code: String,
    drivers: Vec<String>,
}

#[derive(Clone)]
struct EdgeOut {
    id: String,
    relation: u32,
    semantics: u32,
    from: u32,
    to: u32,
    state: &'static str,
    confidence: f64,
    fact_ids: Vec<u32>,
    derivations: Vec<u32>,
    authorities: Vec<u32>,
    proof_state: &'static str,
    evidence: Vec<Evidence>,
    groups: Vec<(u32, Vec<Evidence>)>,
    drivers: Vec<String>,
    explanation_code: &'static str,
    proof_code: String,
    input_digest: String,
    freshness: u32,
    valid_until: u32,
    policy_id: u32,
    policy_version: u32,
}

#[derive(Clone)]
struct UnresolvedOut {
    id: String,
    candidates: Vec<String>,
}

#[derive(Clone)]
struct Built {
    nodes: Vec<NodeOut>,
    edges: Vec<EdgeOut>,
    decisions: Vec<DecisionOut>,
    unresolved: Vec<UnresolvedOut>,
}

struct Selective<'a> {
    only_slots: Option<&'a HashSet<u32>>,
    previous: Option<&'a Built>,
    touched_fact_ids: Option<&'a HashSet<u32>>,
    identity: Option<Identity>,
}

fn build_graph(
    store: &mut Store,
    request: &ComposeRequest,
    selective: Selective<'_>,
) -> Result<Built, ComposeFailure> {
    let Selective {
        only_slots,
        previous,
        touched_fact_ids,
        identity,
    } = selective;
    let families: HashMap<u32, u32> = request
        .entities
        .iter()
        .map(|(kind, family)| Ok((store.intern.intern(kind)?, store.intern.intern(family)?)))
        .collect::<Result<_, ComposeFailure>>()?;
    let mut relations = Vec::new();
    let mut relation_by_kind: HashMap<u32, usize> = HashMap::new();
    for relation in &request.relations {
        let kind = store.intern.intern(&relation.kind)?;
        relation_by_kind.insert(kind, relations.len());
        relations.push((
            kind,
            store.intern.intern(&relation.semantics)?,
            relation
                .subject_families
                .iter()
                .map(|family| store.intern.intern(family))
                .collect::<Result<Vec<_>, _>>()?,
            relation
                .object_families
                .iter()
                .map(|family| store.intern.intern(family))
                .collect::<Result<Vec<_>, _>>()?,
            relation
                .authorities
                .iter()
                .map(|authority| store.intern.intern(authority))
                .collect::<Result<HashSet<_>, _>>()?,
            store.intern.intern(&relation.policy_id)?,
            store.intern.intern(&relation.policy_version)?,
        ));
    }
    let functional: HashSet<u32> = request
        .functional
        .iter()
        .map(|kind| store.intern.intern(kind))
        .collect::<Result<_, _>>()?;
    let identity = match identity {
        Some(identity) => identity,
        None => merge_entities(store)?,
    };
    let order = record_order(store, request);
    let mut fact_counts: HashMap<u32, u32> = HashMap::new();
    for index in &order {
        let fact = store.slots[*index as usize]
            .as_ref()
            .ok_or(ComposeFailure::Index)?;
        *fact_counts.entry(fact.fact_id).or_insert(0) += 1;
    }
    let node_by_id: HashMap<u32, usize> = identity
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    let mut reported_dupes = HashSet::new();
    let mut candidates: HashMap<(u32, u32, u32), Vec<u32>> = HashMap::new();
    let mut candidate_meta: HashMap<(u32, u32, u32), (u32, u32)> = HashMap::new();
    let mut decisions = Vec::new();
    for index in &order {
        if only_slots.is_some_and(|slots| !slots.contains(index)) {
            continue;
        }
        let fact = store.slots[*index as usize]
            .as_ref()
            .ok_or(ComposeFailure::Index)?;
        let subject_id = store.intern.get(fact.subject.id);
        let predicate = store.intern.get(fact.predicate);
        let object_label = fact
            .object
            .as_ref()
            .map(|object| store.intern.get(object.id))
            .unwrap_or("literal");
        let base_key = format!("{subject_id}|{predicate}|{object_label}");
        if fact_counts.get(&fact.fact_id).copied().unwrap_or(0) > 1 {
            if reported_dupes.insert(fact.fact_id) {
                decisions.push(DecisionOut {
                    edge_key: format!("{base_key}|duplicate:{}", store.intern.get(fact.fact_id)),
                    state: "unresolved",
                    included: false,
                    fact_ids: vec![fact.fact_id],
                    code: "GRAPH_FACT_ID_COLLISION".to_owned(),
                    drivers: vec![
                        "fact identity is not globally unique across admitted batches".to_owned(),
                    ],
                });
            }
            continue;
        }
        let Some(object) = fact.object.as_ref() else {
            decisions.push(DecisionOut {
                edge_key: base_key,
                state: "rejected",
                included: false,
                fact_ids: vec![fact.fact_id],
                code: "GRAPH_LITERAL_FACT_NOT_EDGE".to_owned(),
                drivers: vec!["literal facts do not materialize entity-to-entity edges".to_owned()],
            });
            continue;
        };
        if identity.invalid.contains(&fact.subject.id) || identity.invalid.contains(&object.id) {
            decisions.push(unresolved_endpoint(base_key, fact.fact_id));
            continue;
        }
        let Some(from_id) = identity.resolved.get(&fact.subject.id).copied() else {
            decisions.push(unresolved_endpoint(base_key, fact.fact_id));
            continue;
        };
        let Some(to_id) = identity.resolved.get(&object.id).copied() else {
            decisions.push(unresolved_endpoint(base_key, fact.fact_id));
            continue;
        };
        let from = node_by_id
            .get(&from_id)
            .map(|index| &identity.nodes[*index]);
        let to = node_by_id.get(&to_id).map(|index| &identity.nodes[*index]);
        let (Some(from), Some(to)) = (from, to) else {
            decisions.push(unresolved_endpoint(base_key, fact.fact_id));
            continue;
        };
        let group_key = (from.id, fact.predicate, to.id);
        let relation = relation_by_kind
            .get(&fact.predicate)
            .map(|index| &relations[*index]);
        let mut failures = Vec::new();
        if relation.is_none() {
            failures.push("relation is absent from the active ontology");
        }
        if let Some((_, _, subjects, objects, authorities, _, _)) = relation {
            let subject_family = families.get(&from.kind).copied();
            let object_family = families.get(&to.kind).copied();
            if let Some(family) = subject_family {
                if !subjects.contains(&family) {
                    failures.push("subject family is forbidden by the active ontology");
                }
            }
            if let Some(family) = object_family {
                if !objects.contains(&family) {
                    failures.push("object family is forbidden by the active ontology");
                }
            }
            if !authorities.contains(&fact.authority) {
                failures.push("claim authority is forbidden by the active ontology");
            }
        }
        if relation.is_none() || !failures.is_empty() {
            decisions.push(DecisionOut {
                edge_key: format!(
                    "{}|{}|{}",
                    store.intern.get(from.id),
                    predicate,
                    store.intern.get(to.id)
                ),
                state: "rejected",
                included: false,
                fact_ids: vec![fact.fact_id],
                code: "GRAPH_EDGE_ONTOLOGY_REJECTED".to_owned(),
                drivers: failures.into_iter().map(str::to_owned).collect(),
            });
            continue;
        }
        let (_, semantics, _, _, _, policy_id, policy_version) = relation.unwrap();
        candidate_meta
            .entry(group_key)
            .or_insert((*semantics, *policy_id));
        let _ = policy_version;
        candidates.entry(group_key).or_default().push(*index);
    }
    let mut keys: Vec<(u32, u32, u32)> = candidates.keys().copied().collect();
    keys.sort_by(|left, right| {
        compare_canonical_key(store.intern.get(left.0), store.intern.get(right.0))
            .then_with(|| {
                compare_canonical_key(store.intern.get(left.1), store.intern.get(right.1))
            })
            .then_with(|| {
                compare_canonical_key(store.intern.get(left.2), store.intern.get(right.2))
            })
    });
    let mut eligible: Vec<((u32, u32, u32), Vec<u32>)> = Vec::new();
    for key in keys {
        let indexes = candidates.remove(&key).unwrap_or_default();
        let mut kept = Vec::new();
        for index in indexes {
            let fact = store.slots[index as usize].as_ref().unwrap();
            if let Some(decision) = ineligible(store, fact, request) {
                decisions.push(DecisionOut {
                    edge_key: format!(
                        "{}|{}|{}|fact:{}",
                        store.intern.get(key.0),
                        store.intern.get(key.1),
                        store.intern.get(key.2),
                        store.intern.get(fact.fact_id)
                    ),
                    state: decision.0,
                    included: false,
                    fact_ids: vec![fact.fact_id],
                    code: decision.1.to_owned(),
                    drivers: vec![decision.2.to_owned()],
                });
            } else {
                kept.push(index);
            }
        }
        if !kept.is_empty() {
            eligible.push((key, kept));
        }
    }
    let lineage_by_fact = lineage_index(store, request)?;
    let mut proof_slots: Vec<Option<ProofEval>> = Vec::new();
    proof_slots.resize_with(eligible.len(), || None);
    let workers = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .clamp(1, 8);
    let proof_chunk = proof_slots.len().div_ceil(workers.max(1));
    std::thread::scope(|scope| {
        for (chunk_index, chunk) in proof_slots.chunks_mut(proof_chunk.max(1)).enumerate() {
            let eligible = &eligible;
            let store = &*store;
            let lineage_by_fact = &lineage_by_fact;
            scope.spawn(move || {
                let base = chunk_index * proof_chunk.max(1);
                for (offset, slot) in chunk.iter_mut().enumerate() {
                    let indexes = &eligible[base + offset].1;
                    *slot = Some(evaluate_proof(store, indexes, request, lineage_by_fact));
                }
            });
        }
    });
    let proofs: Vec<ProofEval> = proof_slots.into_iter().map(|slot| slot.unwrap()).collect();
    let mut competing: HashMap<(u32, u32), Vec<usize>> = HashMap::new();
    for (ordinal, (key, _)) in eligible.iter().enumerate() {
        if !functional.contains(&key.1) {
            continue;
        }
        let proof = &proofs[ordinal];
        if proof.state == "insufficient" || proof.state == "unresolved" {
            continue;
        }
        competing.entry((key.0, key.1)).or_default().push(ordinal);
    }
    let mut assembled: Vec<Option<Result<(DecisionOut, Option<EdgeOut>), ComposeFailure>>> =
        Vec::new();
    assembled.resize_with(eligible.len(), || None);
    let edge_chunk = assembled.len().div_ceil(workers.max(1));
    std::thread::scope(|scope| {
        for (chunk_index, chunk) in assembled.chunks_mut(edge_chunk.max(1)).enumerate() {
            let eligible = &eligible;
            let proofs = &proofs;
            let store = &*store;
            let candidate_meta = &candidate_meta;
            let competing = &competing;
            let relations = &relations;
            let relation_by_kind = &relation_by_kind;
            let lineage_by_fact = &lineage_by_fact;
            scope.spawn(move || {
                let base = chunk_index * edge_chunk.max(1);
                for (offset, slot) in chunk.iter_mut().enumerate() {
                    let ordinal = base + offset;
                    *slot = Some(assemble_edge(
                        store,
                        &eligible[ordinal],
                        &proofs[ordinal],
                        candidate_meta,
                        competing,
                        relations,
                        relation_by_kind,
                        lineage_by_fact,
                    ));
                }
            });
        }
    });
    let mut edges = Vec::new();
    for item in assembled {
        let (decision, edge) = item.unwrap()?;
        decisions.push(decision);
        if let Some(edge) = edge {
            if edges.len() as u32 >= request.max_edges {
                return Err(ComposeFailure::Limit);
            }
            edges.push(edge);
        }
    }
    if let Some(previous) = previous {
        let empty_touched = HashSet::new();
        let touched = touched_fact_ids.unwrap_or(&empty_touched);
        let mut kept_edges = Vec::new();
        for edge in &previous.edges {
            if edge.fact_ids.iter().any(|id| touched.contains(id)) {
                continue;
            }
            kept_edges.push(edge.clone());
        }
        kept_edges.append(&mut edges);
        edges = kept_edges;
        let mut kept_decisions = Vec::new();
        for decision in &previous.decisions {
            if decision.fact_ids.iter().any(|id| touched.contains(id)) {
                continue;
            }
            kept_decisions.push(decision.clone());
        }
        kept_decisions.append(&mut decisions);
        decisions = kept_decisions;
        if edges.len() as u32 > request.max_edges {
            return Err(ComposeFailure::Limit);
        }
    }
    edges.sort_by(|left, right| compare_canonical_key(&left.id, &right.id));
    decisions.sort_by(|left, right| compare_canonical_key(&left.edge_key, &right.edge_key));
    Ok(Built {
        nodes: identity.nodes,
        edges,
        decisions,
        unresolved: identity.unresolved,
    })
}

fn assemble_edge(
    store: &Store,
    group: &((u32, u32, u32), Vec<u32>),
    proof: &ProofEval,
    candidate_meta: &HashMap<(u32, u32, u32), (u32, u32)>,
    competing: &HashMap<(u32, u32), Vec<usize>>,
    relations: &[(u32, u32, Vec<u32>, Vec<u32>, HashSet<u32>, u32, u32)],
    relation_by_kind: &HashMap<u32, usize>,
    lineage_by_fact: &HashMap<String, Lineage>,
) -> Result<(DecisionOut, Option<EdgeOut>), ComposeFailure> {
    let (key, indexes) = group;
    let meta = candidate_meta
        .get(key)
        .copied()
        .ok_or(ComposeFailure::Parse)?;
    let competitors = competing
        .get(&(key.0, key.1))
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let edge_key = format!(
        "{}|{}|{}",
        store.intern.get(key.0),
        store.intern.get(key.1),
        store.intern.get(key.2)
    );
    let conflict = competitors.len() > 1;
    let state = if conflict {
        "disputed"
    } else if proof.state == "insufficient" {
        "rejected"
    } else if proof.state == "unresolved" {
        "unresolved"
    } else {
        "accepted"
    };
    let included = state == "accepted" || state == "disputed";
    let mut drivers = if conflict {
        vec!["functional relation has multiple current targets".to_owned()]
    } else {
        Vec::new()
    };
    drivers.extend(proof.drivers.iter().cloned());
    let fact_ids = unique_sorted(
        store,
        indexes
            .iter()
            .map(|index| store.slots[*index as usize].as_ref().unwrap().fact_id)
            .collect(),
    );
    let code = if conflict {
        "GRAPH_EDGE_FUNCTIONAL_CONFLICT".to_owned()
    } else {
        format!("GRAPH_EDGE_{}", proof.state.to_ascii_uppercase())
    };
    let decision = DecisionOut {
        edge_key: edge_key.clone(),
        state,
        included,
        fact_ids: fact_ids.clone(),
        code: code.clone(),
        drivers: drivers.clone(),
    };
    if !included {
        return Ok((decision, None));
    }
    let evidence = unique_evidence(store, indexes);
    let derivations = unique_sorted(
        store,
        indexes
            .iter()
            .map(|index| store.slots[*index as usize].as_ref().unwrap().derivation)
            .collect(),
    );
    let authorities = unique_sorted(
        store,
        indexes
            .iter()
            .map(|index| store.slots[*index as usize].as_ref().unwrap().authority)
            .collect(),
    );
    let groups = corroboration_groups(store, indexes, lineage_by_fact, &proof.roots);
    let input_digest = proof_input_digest(store, indexes)?;
    let edge_digest = edge_id_digest(&edge_key);
    let (freshness, valid_until) = aggregate_freshness(store, indexes);
    let relation = relation_by_kind
        .get(&key.1)
        .map(|index| &relations[*index])
        .ok_or(ComposeFailure::Parse)?;
    Ok((
        decision,
        Some(EdgeOut {
            id: format!("edge:{}", &edge_digest[..32]),
            relation: key.1,
            semantics: meta.0,
            from: key.0,
            to: key.2,
            state,
            confidence: mean_confidence(store, indexes),
            fact_ids,
            derivations,
            authorities,
            proof_state: if conflict { "disputed" } else { proof.state },
            evidence,
            groups,
            drivers,
            explanation_code: if conflict {
                "GRAPH_EDGE_FUNCTIONAL_CONFLICT"
            } else {
                "GRAPH_EDGE_ACCEPTED"
            },
            proof_code: code,
            input_digest,
            freshness,
            valid_until,
            policy_id: meta.1,
            policy_version: relation.6,
        }),
    ))
}

fn unresolved_endpoint(edge_key: String, fact_id: u32) -> DecisionOut {
    DecisionOut {
        edge_key,
        state: "unresolved",
        included: false,
        fact_ids: vec![fact_id],
        code: "GRAPH_EDGE_IDENTITY_UNRESOLVED".to_owned(),
        drivers: vec!["an endpoint has conflicting canonical identity claims".to_owned()],
    }
}

fn ineligible<'a>(
    store: &Store,
    fact: &Fact,
    request: &ComposeRequest,
) -> Option<(&'a str, &'a str, &'a str)> {
    let status = store.intern.get(fact.freshness);
    if status == "stale" {
        return Some((
            "rejected",
            "GRAPH_FACT_STALE",
            "stale evidence cannot establish current graph truth",
        ));
    }
    if status == "unknown" {
        let state = if request.unknown_freshness_reject {
            "rejected"
        } else {
            "unresolved"
        };
        return Some((
            state,
            "GRAPH_FACT_FRESHNESS_UNKNOWN",
            "claim freshness is unknown",
        ));
    }
    if fact.confidence < request.minimum_confidence {
        return Some((
            "rejected",
            "GRAPH_FACT_CONFIDENCE_INSUFFICIENT",
            "confidence is below the composition policy floor",
        ));
    }
    if request.inferred_reject
        && (store.intern.get(fact.authority) == "inferred"
            || store.intern.get(fact.derivation) == "inferred")
    {
        return Some((
            "rejected",
            "GRAPH_FACT_INFERRED_NOT_AUTHORIZED",
            "inferred claims are not authoritative under the active policy",
        ));
    }
    None
}

struct ProofEval {
    state: &'static str,
    drivers: Vec<String>,
    roots: Vec<String>,
}

#[derive(Clone)]
struct Lineage {
    fact_id: String,
    derivation: String,
    roots: Vec<String>,
    parents: Vec<String>,
}

fn lineage_index(
    _store: &Store,
    request: &ComposeRequest,
) -> Result<HashMap<String, Lineage>, ComposeFailure> {
    let mut map = HashMap::new();
    for lineage in &request.lineages {
        map.insert(
            lineage.fact_id.clone(),
            Lineage {
                fact_id: lineage.fact_id.clone(),
                derivation: lineage.derivation.clone(),
                roots: lineage.roots.clone(),
                parents: lineage.parents.clone(),
            },
        );
    }
    Ok(map)
}

fn fact_lineage(store: &Store, fact: &Fact, explicit: &HashMap<String, Lineage>) -> Lineage {
    let fact_id = store.intern.get(fact.fact_id).to_owned();
    if let Some(lineage) = explicit.get(&fact_id) {
        return lineage.clone();
    }
    Lineage {
        fact_id,
        derivation: store.intern.get(fact.derivation).to_owned(),
        roots: fact
            .evidence
            .iter()
            .map(|item| store.intern.get(item.id).to_owned())
            .collect(),
        parents: Vec::new(),
    }
}

fn evaluate_proof(
    store: &Store,
    indexes: &[u32],
    request: &ComposeRequest,
    explicit: &HashMap<String, Lineage>,
) -> ProofEval {
    let facts: Vec<&Fact> = indexes
        .iter()
        .map(|index| store.slots[*index as usize].as_ref().unwrap())
        .collect();
    let (freshness, _) = aggregate_freshness(store, indexes);
    let lineages: Vec<Lineage> = facts
        .iter()
        .map(|fact| fact_lineage(store, fact, explicit))
        .collect();
    let mut roots = Vec::new();
    for lineage in &lineages {
        for root in &lineage.roots {
            if !roots.contains(root) {
                roots.push(root.clone());
            }
        }
    }
    roots.sort();
    let freshness_text = store.intern.get(freshness);
    if freshness_text == "stale" {
        return ProofEval {
            state: "insufficient",
            drivers: vec!["all graph truth must remain current".to_owned()],
            roots,
        };
    }
    if freshness_text == "unknown" {
        return if request.unknown_freshness_reject {
            ProofEval {
                state: "insufficient",
                drivers: vec!["claim freshness is unknown and policy rejects it".to_owned()],
                roots,
            }
        } else {
            ProofEval {
                state: "unresolved",
                drivers: vec!["claim freshness is unknown".to_owned()],
                roots,
            }
        };
    }
    if facts
        .iter()
        .all(|fact| fact.confidence < request.minimum_confidence)
    {
        return ProofEval {
            state: "insufficient",
            drivers: vec!["confidence is below the composition policy floor".to_owned()],
            roots,
        };
    }
    if request.inferred_reject
        && facts.iter().all(|fact| {
            store.intern.get(fact.authority) == "inferred"
                || store.intern.get(fact.derivation) == "inferred"
        })
    {
        return ProofEval {
            state: "insufficient",
            drivers: vec!["inferred-only claims are not authoritative".to_owned()],
            roots,
        };
    }
    if facts
        .iter()
        .any(|fact| store.intern.get(fact.authority) == "verified")
    {
        return ProofEval {
            state: "verified",
            drivers: vec!["current verified authority".to_owned()],
            roots,
        };
    }
    let rejected = independence_pairs(&lineages);
    let has_independent = lineages.iter().enumerate().any(|(left_index, left)| {
        lineages.iter().enumerate().any(|(right_index, right)| {
            right_index > left_index
                && !rejected.contains(&(left.fact_id.clone(), right.fact_id.clone()))
                && left
                    .roots
                    .iter()
                    .any(|left_root| right.roots.iter().any(|right_root| left_root != right_root))
        })
    });
    if roots.len() >= 2 && has_independent {
        return ProofEval {
            state: "corroborated",
            drivers: vec!["independent evidence roots".to_owned()],
            roots,
        };
    }
    ProofEval {
        state: "supported",
        drivers: vec!["current evidence-backed claim".to_owned()],
        roots,
    }
}

fn independence_pairs(lineages: &[Lineage]) -> HashSet<(String, String)> {
    let mut rejected = HashSet::new();
    if lineages.len() < 2 {
        return rejected;
    }
    let by_id: HashMap<&str, &Lineage> = lineages
        .iter()
        .map(|lineage| (lineage.fact_id.as_str(), lineage))
        .collect();
    for left_index in 0..lineages.len() {
        for right_index in left_index + 1..lineages.len() {
            let left = &lineages[left_index];
            let right = &lineages[right_index];
            let common = left.roots.iter().any(|root| right.roots.contains(root));
            let ancestral = ancestors(&left.fact_id, &by_id).contains(&right.fact_id)
                || ancestors(&right.fact_id, &by_id).contains(&left.fact_id);
            if ancestral || common {
                rejected.insert((left.fact_id.clone(), right.fact_id.clone()));
                rejected.insert((right.fact_id.clone(), left.fact_id.clone()));
            }
        }
    }
    rejected
}

fn ancestors(id: &str, by_id: &HashMap<&str, &Lineage>) -> HashSet<String> {
    let mut found = HashSet::new();
    let mut pending: Vec<String> = by_id
        .get(id)
        .map(|lineage| lineage.parents.clone())
        .unwrap_or_default();
    while let Some(parent) = pending.pop() {
        if !found.insert(parent.clone()) {
            continue;
        }
        if let Some(lineage) = by_id.get(parent.as_str()) {
            pending.extend(lineage.parents.clone());
        }
    }
    found
}

fn aggregate_freshness(store: &Store, indexes: &[u32]) -> (u32, u32) {
    let mut stale = None;
    let mut unknown = None;
    let mut current = None;
    let mut until: Vec<&str> = Vec::new();
    for index in indexes {
        let fact = store.slots[*index as usize].as_ref().unwrap();
        let status = store.intern.get(fact.freshness);
        if status == "stale" {
            stale = Some(fact.freshness);
        } else if status == "unknown" {
            unknown = Some(fact.freshness);
        } else if current.is_none() {
            current = Some(fact.freshness);
        }
        if fact.valid_until != NONE {
            until.push(store.intern.get(fact.valid_until));
        }
    }
    if let Some(status) = stale.or(unknown) {
        return (status, NONE);
    }
    until.sort();
    let valid = until.first().copied().unwrap_or("");
    let valid_id = if valid.is_empty() {
        NONE
    } else {
        indexes
            .iter()
            .find_map(|index| {
                let fact = store.slots[*index as usize].as_ref().unwrap();
                (fact.valid_until != NONE && store.intern.get(fact.valid_until) == valid)
                    .then_some(fact.valid_until)
            })
            .unwrap_or(NONE)
    };
    (current.unwrap_or(0), valid_id)
}

fn mean_confidence(store: &Store, indexes: &[u32]) -> f64 {
    if indexes.is_empty() {
        return 0.0;
    }
    let total: f64 = indexes
        .iter()
        .map(|index| store.slots[*index as usize].as_ref().unwrap().confidence)
        .sum();
    let mean = total / indexes.len() as f64;
    format!("{mean:.6}").parse::<f64>().unwrap_or(mean)
}

fn unique_sorted(store: &Store, ids: Vec<u32>) -> Vec<u32> {
    let mut unique = Vec::new();
    for id in ids {
        if !unique.contains(&id) {
            unique.push(id);
        }
    }
    unique.sort_by(|left, right| store.intern.get(*left).cmp(store.intern.get(*right)));
    unique
}

fn evidence_key(store: &Store, item: &Evidence) -> String {
    format!(
        "{}\u{0}{}\u{0}{}",
        store.intern.get(item.id),
        store.intern.get(item.algorithm),
        store.intern.get(item.value)
    )
}

fn unique_evidence(store: &Store, indexes: &[u32]) -> Vec<Evidence> {
    let mut map: Vec<(String, Evidence)> = Vec::new();
    for index in indexes {
        let fact = store.slots[*index as usize].as_ref().unwrap();
        for item in &fact.evidence {
            let key = evidence_key(store, item);
            if map.iter().all(|(existing, _)| existing != &key) {
                map.push((key, clone_evidence(item)));
            }
        }
    }
    map.sort_by(|left, right| compare_canonical_key(&left.0, &right.0));
    map.into_iter().map(|(_, item)| item).collect()
}

fn clone_evidence(item: &Evidence) -> Evidence {
    Evidence {
        algorithm: item.algorithm,
        canonicalization: item.canonicalization,
        value: item.value,
        id: item.id,
        locator: item.locator,
        source_kind: item.source_kind,
    }
}

fn corroboration_groups(
    store: &Store,
    indexes: &[u32],
    explicit: &HashMap<String, Lineage>,
    roots: &[String],
) -> Vec<(u32, Vec<Evidence>)> {
    roots
        .iter()
        .filter_map(|root| {
            let matched: Vec<u32> = indexes
                .iter()
                .copied()
                .filter(|index| {
                    let fact = store.slots[*index as usize].as_ref().unwrap();
                    let lineage = fact_lineage(store, fact, explicit);
                    lineage.roots.iter().any(|candidate| candidate == root)
                        || fact
                            .evidence
                            .iter()
                            .any(|item| store.intern.get(item.id) == root)
                })
                .collect();
            let root_id = store.intern.id_of(root);
            root_id.map(|id| (id, unique_evidence(store, &matched)))
        })
        .collect()
}

fn proof_input_digest(store: &Store, indexes: &[u32]) -> Result<String, ComposeFailure> {
    let mut hasher = Sha256::new();
    hasher.update(b"[");
    for (ordinal, index) in indexes.iter().enumerate() {
        if ordinal > 0 {
            hasher.update(b",");
        }
        let fact = store.slots[*index as usize].as_ref().unwrap();
        hasher.update(b"{\"evidence\":");
        hasher.update(evidence_array_json(store, &fact.evidence).as_bytes());
        hasher.update(b",\"factId\":");
        hasher.update(json_string(store.intern.get(fact.fact_id)).as_bytes());
        hasher.update(b",\"inputDigest\":");
        hasher.update(store.intern.get(fact.input_digest).as_bytes());
        hasher.update(b"}");
    }
    hasher.update(b"]");
    Ok(hex32(&hasher.finish()))
}

fn edge_id_digest(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(json_string(key).as_bytes());
    hex32(&hasher.finish())
}

fn evidence_array_json(store: &Store, items: &[Evidence]) -> String {
    let mut out = String::from("[");
    for (index, item) in items.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push_str(&evidence_json(store, item));
    }
    out.push(']');
    out
}

fn evidence_json(store: &Store, item: &Evidence) -> String {
    let mut out = String::from("{\"digest\":{\"algorithm\":");
    out.push_str(&json_string(store.intern.get(item.algorithm)));
    if item.canonicalization != NONE {
        out.push_str(",\"canonicalization\":");
        out.push_str(&json_string(store.intern.get(item.canonicalization)));
    }
    out.push_str(",\"value\":");
    out.push_str(&json_string(store.intern.get(item.value)));
    out.push_str("},\"id\":");
    out.push_str(&json_string(store.intern.get(item.id)));
    out.push_str(",\"relativeLocator\":");
    out.push_str(&json_string(store.intern.get(item.locator)));
    out.push_str(",\"sourceKind\":");
    out.push_str(&json_string(store.intern.get(item.source_kind)));
    out.push('}');
    out
}

trait Out {
    fn push(&mut self, byte: u8);
    fn extend_from_slice(&mut self, bytes: &[u8]);
}

impl Out for Vec<u8> {
    fn push(&mut self, byte: u8) {
        Vec::push(self, byte);
    }

    fn extend_from_slice(&mut self, bytes: &[u8]) {
        Vec::extend_from_slice(self, bytes);
    }
}

struct BufSink {
    file: File,
    hasher: Sha256,
    hash: bool,
    buf: Vec<u8>,
    total: u64,
    error: bool,
}

impl BufSink {
    fn new(file: File, hash: bool) -> Self {
        Self {
            file,
            hasher: Sha256::new(),
            hash,
            buf: Vec::with_capacity(1024 * 1024),
            total: 0,
            error: false,
        }
    }

    fn flush(&mut self) {
        if self.error || self.buf.is_empty() {
            return;
        }
        if self.hash {
            self.hasher.update(&self.buf);
        }
        self.total += self.buf.len() as u64;
        if self.file.write_all(&self.buf).is_err() {
            self.error = true;
        }
        self.buf.clear();
    }

    fn finish(mut self) -> Result<(String, u64), ComposeFailure> {
        self.flush();
        if self.error {
            return Err(ComposeFailure::Io);
        }
        let digest = if self.hash {
            hex32(&self.hasher.finish())
        } else {
            String::new()
        };
        Ok((digest, self.total))
    }
}

impl Out for BufSink {
    fn push(&mut self, byte: u8) {
        self.buf.push(byte);
        if self.buf.len() >= 1024 * 1024 {
            self.flush();
        }
    }

    fn extend_from_slice(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
        if self.buf.len() >= 1024 * 1024 {
            self.flush();
        }
    }
}

fn write_json_string(out: &mut impl Out, value: &str) {
    out.push(b'"');
    for character in value.chars() {
        match character {
            '"' => out.extend_from_slice(b"\\\""),
            '\\' => out.extend_from_slice(b"\\\\"),
            '\u{0008}' => out.extend_from_slice(b"\\b"),
            '\u{000c}' => out.extend_from_slice(b"\\f"),
            '\n' => out.extend_from_slice(b"\\n"),
            '\r' => out.extend_from_slice(b"\\r"),
            '\t' => out.extend_from_slice(b"\\t"),
            '\u{2028}' => out.extend_from_slice(b"\\u2028"),
            '\u{2029}' => out.extend_from_slice(b"\\u2029"),
            other if (other as u32) < 0x20 => {
                out.extend_from_slice(format!("\\u{:04x}", other as u32).as_bytes());
            }
            other => {
                let mut encoded = [0u8; 4];
                out.extend_from_slice(other.encode_utf8(&mut encoded).as_bytes());
            }
        }
    }
    out.push(b'"');
}

fn json_string(value: &str) -> String {
    let mut out = Vec::new();
    write_json_string(&mut out, value);
    String::from_utf8(out).unwrap_or_default()
}

fn json_number(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    let text = format!("{value}");
    if text.contains('e') || text.contains('E') {
        serde_free_number(value)
    } else {
        text
    }
}

fn serde_free_number(value: f64) -> String {
    let text = format!("{value:.16}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() {
        "0".to_owned()
    } else {
        trimmed.to_owned()
    }
}

#[derive(Clone)]
struct Identity {
    nodes: Vec<NodeOut>,
    invalid: HashSet<u32>,
    resolved: HashMap<u32, u32>,
    unresolved: Vec<UnresolvedOut>,
}

fn merge_entities(store: &mut Store) -> Result<Identity, ComposeFailure> {
    let mut by_id: HashMap<u32, Vec<Entity>> = HashMap::new();
    for slot in &store.slots {
        let fact = slot.as_ref().unwrap();
        by_id
            .entry(fact.subject.id)
            .or_default()
            .push(fact.subject.clone());
        if let Some(object) = &fact.object {
            by_id.entry(object.id).or_default().push(object.clone());
        }
    }
    identity_from_groups(store, by_id)
}

fn identity_from_groups(
    store: &mut Store,
    by_id: HashMap<u32, Vec<Entity>>,
) -> Result<Identity, ComposeFailure> {
    let mut ids: Vec<u32> = by_id.keys().copied().collect();
    ids.sort_by(|left, right| {
        compare_canonical_key(store.intern.get(*left), store.intern.get(*right))
    });
    let mut invalid = HashSet::new();
    let mut unresolved = Vec::new();
    let mut canonical: HashMap<u32, NodeOut> = HashMap::new();
    for id in ids {
        let variants = by_id.get(&id).cloned().unwrap_or_default();
        let mut signatures = Vec::new();
        for variant in &variants {
            let signature = (variant.kind, variant.scope);
            if !signatures.contains(&signature) {
                signatures.push(signature);
            }
        }
        if signatures.len() != 1 {
            invalid.insert(id);
            unresolved.push(UnresolvedOut {
                id: format!("unresolved:identity:{}", store.intern.get(id)),
                candidates: variants
                    .iter()
                    .enumerate()
                    .map(|(index, variant)| {
                        format!(
                            "candidate:{}:{}:{}",
                            store.intern.get(variant.id),
                            store.intern.get(variant.kind),
                            index + 1
                        )
                    })
                    .collect(),
            });
            continue;
        }
        let first = &variants[0];
        let mut alias_reasons: HashMap<u32, u32> = HashMap::new();
        let mut alias_failed = false;
        for variant in &variants {
            for (alias_id, reason) in &variant.aliases {
                if let Some(previous) = alias_reasons.get(alias_id) {
                    if previous != reason {
                        invalid.insert(id);
                        unresolved.push(UnresolvedOut {
                            id: format!(
                                "unresolved:alias:{}:{}",
                                store.intern.get(id),
                                store.intern.get(*alias_id)
                            ),
                            candidates: {
                                let mut values = vec![
                                    store.intern.get(*previous).to_owned(),
                                    store.intern.get(*reason).to_owned(),
                                ];
                                values.sort();
                                values.dedup();
                                values
                            },
                        });
                        alias_failed = true;
                    }
                } else {
                    alias_reasons.insert(*alias_id, *reason);
                }
            }
        }
        if alias_failed || invalid.contains(&id) {
            continue;
        }
        let mut aliases: Vec<(u32, u32)> = alias_reasons.into_iter().collect();
        aliases.sort_by(|left, right| {
            compare_canonical_key(store.intern.get(left.0), store.intern.get(right.0))
        });
        canonical.insert(
            id,
            NodeOut {
                id: first.id,
                scheme: first.scheme,
                kind: first.kind,
                scope: first.scope,
                aliases,
            },
        );
    }
    let mut alias_owners: HashMap<u32, Vec<u32>> = HashMap::new();
    for node in canonical.values() {
        for (alias, _) in &node.aliases {
            alias_owners.entry(*alias).or_default().push(node.id);
        }
    }
    for (alias, owners) in &alias_owners {
        let unique_owners: HashSet<u32> = owners.iter().copied().collect();
        if unique_owners.len() <= 1 {
            continue;
        }
        for owner in &unique_owners {
            invalid.insert(*owner);
        }
        if canonical.contains_key(alias) {
            invalid.insert(*alias);
        }
        let mut candidates: Vec<String> = unique_owners
            .iter()
            .map(|owner| store.intern.get(*owner).to_owned())
            .collect();
        candidates.sort();
        candidates.dedup();
        unresolved.push(UnresolvedOut {
            id: format!("unresolved:alias-owner:{}", store.intern.get(*alias)),
            candidates,
        });
    }
    let mut resolved = HashMap::new();
    let starts: Vec<u32> = canonical.keys().copied().collect();
    for start in starts {
        if invalid.contains(&start) {
            continue;
        }
        let mut chain = Vec::new();
        let mut active = HashSet::new();
        let mut current = start;
        let mut failed = false;
        loop {
            if !active.insert(current) {
                for member in &active {
                    invalid.insert(*member);
                }
                let mut cycle: Vec<String> = active
                    .iter()
                    .map(|member| store.intern.get(*member).to_owned())
                    .collect();
                cycle.sort();
                unresolved.push(UnresolvedOut {
                    id: format!("unresolved:alias-cycle:{}", cycle.join(":")),
                    candidates: cycle,
                });
                failed = true;
                break;
            }
            chain.push(current);
            let owners = alias_owners.get(&current).cloned().unwrap_or_default();
            let unique: HashSet<u32> = owners.into_iter().collect();
            let owner = if unique.len() == 1 {
                unique.into_iter().next()
            } else {
                None
            };
            let Some(owner) = owner else { break };
            if invalid.contains(&owner) {
                break;
            }
            if let (Some(current_entity), Some(owner_entity)) =
                (canonical.get(&current), canonical.get(&owner))
            {
                if current_entity.kind != owner_entity.kind
                    || current_entity.scope != owner_entity.scope
                {
                    invalid.insert(current);
                    invalid.insert(owner);
                    let mut candidates = vec![
                        store.intern.get(current).to_owned(),
                        store.intern.get(owner).to_owned(),
                    ];
                    candidates.sort();
                    candidates.dedup();
                    unresolved.push(UnresolvedOut {
                        id: format!(
                            "unresolved:alias-semantics:{}:{}",
                            store.intern.get(current),
                            store.intern.get(owner)
                        ),
                        candidates,
                    });
                    failed = true;
                    break;
                }
            }
            current = owner;
        }
        if !failed && !invalid.contains(&current) {
            for member in chain {
                resolved.insert(member, current);
            }
        }
    }
    let mut members_by_root: HashMap<u32, Vec<u32>> = HashMap::new();
    for (id, root) in &resolved {
        if invalid.contains(id) || invalid.contains(root) {
            continue;
        }
        members_by_root.entry(*root).or_default().push(*id);
    }
    let mut roots: Vec<u32> = members_by_root.keys().copied().collect();
    roots.sort_by(|left, right| {
        compare_canonical_key(store.intern.get(*left), store.intern.get(*right))
    });
    let mut nodes = Vec::new();
    for root in roots {
        let Some(root_entity) = canonical.get(&root) else {
            continue;
        };
        let mut aliases: HashMap<u32, u32> = HashMap::new();
        for member in members_by_root.get(&root).cloned().unwrap_or_default() {
            if member != root {
                let reason = store.intern.intern("canonicalization")?;
                aliases.insert(member, reason);
            }
            if let Some(member_entity) = canonical.get(&member) {
                for (alias, reason) in &member_entity.aliases {
                    if *alias != root {
                        aliases.insert(*alias, *reason);
                    }
                }
            }
        }
        let mut alias_list: Vec<(u32, u32)> = aliases.into_iter().collect();
        alias_list.sort_by(|left, right| {
            compare_canonical_key(store.intern.get(left.0), store.intern.get(right.0))
        });
        nodes.push(NodeOut {
            id: root_entity.id,
            scheme: root_entity.scheme,
            kind: root_entity.kind,
            scope: root_entity.scope,
            aliases: alias_list,
        });
    }
    unresolved.sort_by(|left, right| compare_canonical_key(&left.id, &right.id));
    Ok(Identity {
        nodes,
        invalid,
        resolved,
        unresolved,
    })
}

fn record_order(store: &Store, request: &ComposeRequest) -> Vec<u32> {
    let mut order = Vec::with_capacity(store.slots.len());
    for (start, end) in &request.ranges {
        let mut indexes: Vec<u32> = (*start..*end).collect();
        indexes.sort_by(|left, right| {
            let left_id = store.slots[*left as usize]
                .as_ref()
                .map(|fact| store.intern.get(fact.fact_id))
                .unwrap_or("");
            let right_id = store.slots[*right as usize]
                .as_ref()
                .map(|fact| store.intern.get(fact.fact_id))
                .unwrap_or("");
            compare_canonical_key(left_id, right_id)
        });
        order.extend(indexes);
    }
    order
}

struct Published {
    content_digest: String,
    packed_bytes: u64,
    canonical_bytes: u64,
}

fn publish(
    store: &Store,
    request: &ComposeRequest,
    fact_digest: &str,
    built: &Built,
) -> Result<Published, ComposeFailure> {
    std::thread::scope(|scope| {
        let content_task = scope.spawn(|| {
            let file = File::create(&request.canonical_path).map_err(|_| ComposeFailure::Io)?;
            let mut sink = BufSink::new(file, true);
            write_content(&mut sink, store, request, fact_digest, built)?;
            let (content_digest, canonical_bytes) = sink.finish()?;
            Ok::<_, ComposeFailure>((content_digest, canonical_bytes))
        });
        let packed_task = scope.spawn(|| {
            let sections = snapshot_sections(store, request, built)?;
            install_segmented_snapshot(&request.packed_path, &sections)
        });
        let (content_digest, canonical_bytes) =
            content_task.join().map_err(|_| ComposeFailure::Io)??;
        let packed_bytes = packed_task.join().map_err(|_| ComposeFailure::Io)??;
        Ok(Published {
            content_digest,
            packed_bytes,
            canonical_bytes,
        })
    })
}

fn write_content(
    out: &mut impl Out,
    store: &Store,
    request: &ComposeRequest,
    fact_digest: &str,
    built: &Built,
) -> Result<(), ComposeFailure> {
    out.extend_from_slice(b"{\"assertions\":[],\"diagnostics\":[],\"disputes\":[],\"edges\":[");
    for (index, edge) in built.edges.iter().enumerate() {
        if index > 0 {
            out.push(b',');
        }
        write_edge_projection(out, store, request, edge);
    }
    out.extend_from_slice(b"],\"generation\":{");
    write_generation(out, request, fact_digest);
    out.extend_from_slice(b"},\"graphVersion\":");
    write_json_string(out, &request.graph_version);
    out.extend_from_slice(b",\"nodes\":[");
    for (index, node) in built.nodes.iter().enumerate() {
        if index > 0 {
            out.push(b',');
        }
        write_node(out, store, node);
    }
    out.extend_from_slice(b"],\"ontology\":[{\"id\":");
    write_json_string(out, &request.ontology_id);
    out.extend_from_slice(b",\"version\":");
    write_json_string(out, &request.ontology_version);
    out.extend_from_slice(b"}],\"unresolved\":[");
    for (index, item) in built.unresolved.iter().enumerate() {
        if index > 0 {
            out.push(b',');
        }
        out.extend_from_slice(b"{\"candidates\":[");
        for (candidate_index, candidate) in item.candidates.iter().enumerate() {
            if candidate_index > 0 {
                out.push(b',');
            }
            write_json_string(out, candidate);
        }
        out.extend_from_slice(b"],\"id\":");
        write_json_string(out, &item.id);
        out.push(b'}');
    }
    out.extend_from_slice(b"]}");
    Ok(())
}

fn write_generation(out: &mut impl Out, request: &ComposeRequest, fact_digest: &str) {
    out.extend_from_slice(b"\"architectureEpoch\":");
    write_json_string(out, &request.architecture_epoch);
    out.extend_from_slice(b",\"compositionPolicyDigest\":");
    write_digest_ref(out, &request.digests[4]);
    out.extend_from_slice(b",\"factSetDigest\":");
    write_digest_ref(out, fact_digest);
    out.extend_from_slice(b",\"graphSchema\":{\"id\":");
    write_json_string(out, &request.schema_id);
    out.extend_from_slice(b",\"version\":");
    write_json_string(out, &request.schema_version);
    out.extend_from_slice(b"},\"inputsDigest\":");
    write_digest_ref(out, &request.digests[2]);
    out.extend_from_slice(b",\"ontologySetDigest\":");
    write_digest_ref(out, &request.digests[0]);
    out.extend_from_slice(b",\"proofPolicySetDigest\":");
    write_digest_ref(out, &request.digests[1]);
    out.extend_from_slice(b",\"providerSetDigest\":");
    write_digest_ref(out, &request.digests[3]);
}

fn write_digest_ref(out: &mut impl Out, hex_value: &str) {
    out.extend_from_slice(b"{\"algorithm\":\"sha256\",\"canonicalization\":");
    write_json_string(out, CANONICAL_NAME);
    out.extend_from_slice(b",\"value\":");
    write_json_string(out, hex_value);
    out.push(b'}');
}

fn write_node(out: &mut impl Out, store: &Store, node: &NodeOut) {
    out.push(b'{');
    if !node.aliases.is_empty() {
        out.extend_from_slice(b"\"aliases\":[");
        for (index, (id, reason)) in node.aliases.iter().enumerate() {
            if index > 0 {
                out.push(b',');
            }
            out.extend_from_slice(b"{\"id\":");
            write_json_string(out, store.intern.get(*id));
            out.extend_from_slice(b",\"reason\":");
            write_json_string(out, store.intern.get(*reason));
            out.push(b'}');
        }
        out.extend_from_slice(b"],");
    }
    out.extend_from_slice(b"\"id\":");
    write_json_string(out, store.intern.get(node.id));
    out.extend_from_slice(b",\"identityScheme\":");
    out.extend_from_slice(store.intern.get(node.scheme).as_bytes());
    out.extend_from_slice(b",\"kind\":");
    write_json_string(out, store.intern.get(node.kind));
    out.extend_from_slice(b",\"scope\":");
    out.extend_from_slice(store.intern.get(node.scope).as_bytes());
    out.push(b'}');
}

fn write_edge_projection(
    out: &mut impl Out,
    store: &Store,
    request: &ComposeRequest,
    edge: &EdgeOut,
) {
    out.extend_from_slice(b"{\"confidence\":");
    out.extend_from_slice(json_number(edge.confidence).as_bytes());
    out.extend_from_slice(b",\"derivations\":[");
    for (index, id) in edge.derivations.iter().enumerate() {
        if index > 0 {
            out.push(b',');
        }
        write_json_string(out, store.intern.get(*id));
    }
    out.extend_from_slice(b"],\"explanation\":{\"code\":");
    write_json_string(out, edge.explanation_code);
    out.extend_from_slice(b",\"drivers\":[");
    for (index, driver) in edge.drivers.iter().enumerate() {
        if index > 0 {
            out.push(b',');
        }
        write_json_string(out, driver);
    }
    out.extend_from_slice(b"]},\"facts\":[");
    for (index, id) in edge.fact_ids.iter().enumerate() {
        if index > 0 {
            out.push(b',');
        }
        write_json_string(out, store.intern.get(*id));
    }
    out.extend_from_slice(b"],\"freshness\":{\"status\":");
    write_json_string(out, store.intern.get(edge.freshness));
    out.extend_from_slice(b"},\"from\":");
    write_json_string(out, store.intern.get(edge.from));
    out.extend_from_slice(b",\"id\":");
    write_json_string(out, &edge.id);
    out.extend_from_slice(b",\"proof\":{\"corroborationGroups\":[");
    for (index, (root, evidence)) in edge.groups.iter().enumerate() {
        if index > 0 {
            out.push(b',');
        }
        out.extend_from_slice(b"{\"evidence\":");
        out.extend_from_slice(evidence_array_json(store, evidence).as_bytes());
        out.extend_from_slice(b",\"root\":");
        write_json_string(out, store.intern.get(*root));
        out.push(b'}');
    }
    out.extend_from_slice(b"],\"counterEvidence\":[],\"evidence\":");
    out.extend_from_slice(evidence_array_json(store, &edge.evidence).as_bytes());
    out.extend_from_slice(b",\"explanationCode\":");
    write_json_string(out, &edge.proof_code);
    out.extend_from_slice(b",\"inputDigest\":");
    write_digest_ref(out, &edge.input_digest);
    out.extend_from_slice(b",\"missingRequirements\":[],\"policy\":{\"id\":");
    write_json_string(out, store.intern.get(edge.policy_id));
    out.extend_from_slice(b",\"version\":");
    write_json_string(out, store.intern.get(edge.policy_version));
    out.extend_from_slice(b"},\"state\":");
    write_json_string(out, edge.proof_state);
    out.extend_from_slice(b"},\"relation\":");
    write_json_string(out, store.intern.get(edge.relation));
    out.extend_from_slice(b",\"semantics\":");
    write_json_string(out, store.intern.get(edge.semantics));
    out.extend_from_slice(b",\"state\":");
    write_json_string(out, edge.state);
    out.extend_from_slice(b",\"to\":");
    write_json_string(out, store.intern.get(edge.to));
    out.push(b'}');
    let _ = request;
}

struct SnapshotSections {
    strings: Vec<u8>,
    nodes: Vec<u8>,
    edges: Vec<u8>,
    adjacency: Vec<u8>,
    unresolved: Vec<u8>,
    decisions: Vec<u8>,
}

fn snapshot_sections(
    store: &Store,
    request: &ComposeRequest,
    built: &Built,
) -> Result<SnapshotSections, ComposeFailure> {
    let mut strings = Vec::new();
    strings.extend_from_slice(&(store.intern.strings.len() as u32).to_le_bytes());
    for value in &store.intern.strings {
        strings.extend_from_slice(&(value.len() as u32).to_le_bytes());
        strings.extend_from_slice(value.as_bytes());
    }
    let mut nodes = Vec::new();
    nodes.extend_from_slice(&(built.nodes.len() as u32).to_le_bytes());
    for node in &built.nodes {
        for id in [node.id, node.kind, node.scheme, node.scope] {
            nodes.extend_from_slice(&id.to_le_bytes());
        }
        nodes.extend_from_slice(&(node.aliases.len() as u32).to_le_bytes());
        for (id, reason) in &node.aliases {
            nodes.extend_from_slice(&id.to_le_bytes());
            nodes.extend_from_slice(&reason.to_le_bytes());
        }
    }
    let mut edges = Vec::new();
    edges.extend_from_slice(&(built.edges.len() as u32).to_le_bytes());
    let evaluated = store.intern.id_of(&request.evaluated_at).unwrap_or(0);
    for edge in &built.edges {
        write_packed_string(&mut edges, &edge.id);
        for id in [edge.relation, edge.semantics, edge.from, edge.to] {
            edges.extend_from_slice(&id.to_le_bytes());
        }
        edges.push(edge_state_code(edge.state));
        edges.extend_from_slice(&edge.confidence.to_le_bytes());
        write_u32_list(&mut edges, &edge.fact_ids);
        write_u32_list(&mut edges, &edge.derivations);
        write_u32_list(&mut edges, &edge.authorities);
        edges.push(proof_state_code(edge.proof_state));
        write_packed_string(&mut edges, edge.explanation_code);
        write_packed_string(&mut edges, &edge.proof_code);
        write_string_list(&mut edges, &edge.drivers);
        write_evidence_list(&mut edges, &edge.evidence);
        edges.extend_from_slice(&(edge.groups.len() as u32).to_le_bytes());
        for (root, evidence) in &edge.groups {
            edges.extend_from_slice(&root.to_le_bytes());
            write_evidence_list(&mut edges, evidence);
        }
        edges.extend_from_slice(&edge.policy_id.to_le_bytes());
        edges.extend_from_slice(&edge.policy_version.to_le_bytes());
        write_packed_string(&mut edges, &edge.input_digest);
        edges.extend_from_slice(&edge.freshness.to_le_bytes());
        edges.extend_from_slice(&edge.valid_until.to_le_bytes());
        edges.extend_from_slice(&evaluated.to_le_bytes());
    }
    let mut outgoing: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut incoming: HashMap<u32, Vec<u32>> = HashMap::new();
    for (index, edge) in built.edges.iter().enumerate() {
        outgoing.entry(edge.from).or_default().push(index as u32);
        incoming.entry(edge.to).or_default().push(index as u32);
    }
    let mut adjacency = Vec::new();
    let string_count = store.intern.strings.len() as u32;
    adjacency.extend_from_slice(&string_count.to_le_bytes());
    let table_at = adjacency.len();
    adjacency.extend(std::iter::repeat(0u8).take(string_count as usize * 8));
    for id in 0..string_count {
        let offset = adjacency.len() as u64;
        adjacency[table_at + id as usize * 8..table_at + id as usize * 8 + 8]
            .copy_from_slice(&offset.to_le_bytes());
        let empty = Vec::new();
        let out = outgoing.get(&id).unwrap_or(&empty);
        let inn = incoming.get(&id).unwrap_or(&empty);
        adjacency.extend_from_slice(&(out.len() as u32).to_le_bytes());
        for edge in out {
            adjacency.extend_from_slice(&edge.to_le_bytes());
        }
        adjacency.extend_from_slice(&(inn.len() as u32).to_le_bytes());
        for edge in inn {
            adjacency.extend_from_slice(&edge.to_le_bytes());
        }
    }
    let mut unresolved = Vec::new();
    unresolved.extend_from_slice(&(built.unresolved.len() as u32).to_le_bytes());
    for item in &built.unresolved {
        write_packed_string(&mut unresolved, &item.id);
        write_string_list(&mut unresolved, &item.candidates);
    }
    let mut decisions = Vec::new();
    decisions.extend_from_slice(&(built.decisions.len() as u32).to_le_bytes());
    for decision in &built.decisions {
        write_packed_string(&mut decisions, &decision.edge_key);
        decisions.push(edge_state_code(decision.state));
        decisions.push(u8::from(decision.included));
        write_u32_list(&mut decisions, &decision.fact_ids);
        write_packed_string(&mut decisions, &decision.code);
        write_string_list(&mut decisions, &decision.drivers);
    }
    Ok(SnapshotSections {
        strings,
        nodes,
        edges,
        adjacency,
        unresolved,
        decisions,
    })
}

fn snapshot_fault(point: &str) -> Result<(), ComposeFailure> {
    if std::env::var("WORKSPAI_GRAPH_SNAPSHOT_FAULT")
        .ok()
        .as_deref()
        == Some(point)
    {
        return Err(ComposeFailure::Io);
    }
    Ok(())
}

fn install_segment(
    directory: &Path,
    kind: u8,
    bytes: &[u8],
    manifest: &mut Vec<u8>,
) -> Result<(), ComposeFailure> {
    snapshot_fault("segment-open")?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finish();
    let name = hex32(&digest);
    let destination = directory.join(&name);
    let reused = destination.is_file()
        && fs::metadata(&destination)
            .map(|meta| meta.len() == bytes.len() as u64)
            .unwrap_or(false)
        && fs::read(&destination)
            .map(|existing| {
                let mut check = Sha256::new();
                check.update(&existing);
                check.finish() == digest
            })
            .unwrap_or(false);
    if !reused {
        snapshot_fault("segment-write")?;
        let temporary = directory.join(format!(".{name}.partial"));
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| ComposeFailure::Io)?;
        file.write_all(bytes).map_err(|_| ComposeFailure::Io)?;
        snapshot_fault("segment-sync")?;
        file.sync_all().map_err(|_| ComposeFailure::Io)?;
        snapshot_fault("segment-rename")?;
        fs::rename(&temporary, &destination).map_err(|_| ComposeFailure::Io)?;
    }
    manifest.push(kind);
    manifest.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
    manifest.extend_from_slice(&digest);
    Ok(())
}

fn install_segmented_snapshot(
    packed_path: &str,
    sections: &SnapshotSections,
) -> Result<u64, ComposeFailure> {
    let path = Path::new(packed_path);
    let parent = path.parent().ok_or(ComposeFailure::Io)?;
    let directory = parent.join("segments");
    fs::create_dir_all(&directory).map_err(|_| ComposeFailure::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&directory, fs::Permissions::from_mode(0o700));
    }
    let mut manifest = Vec::new();
    manifest.extend_from_slice(b"WGP2");
    manifest.extend_from_slice(&1u32.to_le_bytes());
    manifest.extend_from_slice(&6u32.to_le_bytes());
    install_segment(&directory, 1, &sections.strings, &mut manifest)?;
    install_segment(&directory, 2, &sections.nodes, &mut manifest)?;
    install_segment(&directory, 3, &sections.edges, &mut manifest)?;
    install_segment(&directory, 4, &sections.adjacency, &mut manifest)?;
    install_segment(&directory, 5, &sections.unresolved, &mut manifest)?;
    install_segment(&directory, 6, &sections.decisions, &mut manifest)?;
    snapshot_fault("manifest-sync")?;
    let temporary = parent.join(format!(
        ".{}.partial",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("graph")
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| ComposeFailure::Io)?;
    file.write_all(&manifest).map_err(|_| ComposeFailure::Io)?;
    file.sync_all().map_err(|_| ComposeFailure::Io)?;
    snapshot_fault("manifest-rename")?;
    fs::rename(&temporary, path).map_err(|_| ComposeFailure::Io)?;
    if let Ok(directory_file) = File::open(parent) {
        let _ = directory_file.sync_all();
    }
    Ok(manifest.len() as u64)
}

fn write_packed(
    out: &mut impl Out,
    store: &Store,
    request: &ComposeRequest,
    built: &Built,
) -> Result<(), ComposeFailure> {
    out.extend_from_slice(b"WGP1");
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(store.intern.strings.len() as u32).to_le_bytes());
    for value in &store.intern.strings {
        out.extend_from_slice(&(value.len() as u32).to_le_bytes());
        out.extend_from_slice(value.as_bytes());
    }
    out.extend_from_slice(&(built.nodes.len() as u32).to_le_bytes());
    for node in &built.nodes {
        for id in [node.id, node.kind, node.scheme, node.scope] {
            out.extend_from_slice(&id.to_le_bytes());
        }
        out.extend_from_slice(&(node.aliases.len() as u32).to_le_bytes());
        for (id, reason) in &node.aliases {
            out.extend_from_slice(&id.to_le_bytes());
            out.extend_from_slice(&reason.to_le_bytes());
        }
    }
    out.extend_from_slice(&(built.edges.len() as u32).to_le_bytes());
    let evaluated = store.intern.id_of(&request.evaluated_at).unwrap_or(0);
    for edge in &built.edges {
        write_packed_string(out, &edge.id);
        for id in [edge.relation, edge.semantics, edge.from, edge.to] {
            out.extend_from_slice(&id.to_le_bytes());
        }
        out.push(edge_state_code(edge.state));
        out.extend_from_slice(&edge.confidence.to_le_bytes());
        write_u32_list(out, &edge.fact_ids);
        write_u32_list(out, &edge.derivations);
        write_u32_list(out, &edge.authorities);
        out.push(proof_state_code(edge.proof_state));
        write_packed_string(out, edge.explanation_code);
        write_packed_string(out, &edge.proof_code);
        write_string_list(out, &edge.drivers);
        write_evidence_list(out, &edge.evidence);
        out.extend_from_slice(&(edge.groups.len() as u32).to_le_bytes());
        for (root, evidence) in &edge.groups {
            out.extend_from_slice(&root.to_le_bytes());
            write_evidence_list(out, evidence);
        }
        out.extend_from_slice(&edge.policy_id.to_le_bytes());
        out.extend_from_slice(&edge.policy_version.to_le_bytes());
        write_packed_string(out, &edge.input_digest);
        out.extend_from_slice(&edge.freshness.to_le_bytes());
        out.extend_from_slice(&edge.valid_until.to_le_bytes());
        out.extend_from_slice(&evaluated.to_le_bytes());
    }
    out.extend_from_slice(&(built.unresolved.len() as u32).to_le_bytes());
    for item in &built.unresolved {
        write_packed_string(out, &item.id);
        write_string_list(out, &item.candidates);
    }
    out.extend_from_slice(&(built.decisions.len() as u32).to_le_bytes());
    for decision in &built.decisions {
        write_packed_string(out, &decision.edge_key);
        out.push(edge_state_code(decision.state));
        out.push(u8::from(decision.included));
        write_u32_list(out, &decision.fact_ids);
        write_packed_string(out, &decision.code);
        write_string_list(out, &decision.drivers);
    }
    Ok(())
}

fn edge_state_code(state: &str) -> u8 {
    match state {
        "accepted" => 0,
        "disputed" => 1,
        "rejected" => 2,
        "unresolved" => 3,
        _ => 255,
    }
}

fn proof_state_code(state: &str) -> u8 {
    match state {
        "supported" => 0,
        "corroborated" => 1,
        "verified" => 2,
        "disputed" => 3,
        "insufficient" => 4,
        "unresolved" => 5,
        _ => 255,
    }
}

fn write_packed_string(out: &mut impl Out, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value.as_bytes());
}

fn write_string_list(out: &mut impl Out, values: &[String]) {
    out.extend_from_slice(&(values.len() as u32).to_le_bytes());
    for value in values {
        write_packed_string(out, value);
    }
}

fn write_u32_list(out: &mut impl Out, values: &[u32]) {
    out.extend_from_slice(&(values.len() as u32).to_le_bytes());
    for value in values {
        out.extend_from_slice(&value.to_le_bytes());
    }
}

fn write_evidence_list(out: &mut impl Out, items: &[Evidence]) {
    out.extend_from_slice(&(items.len() as u32).to_le_bytes());
    for item in items {
        for id in [
            item.algorithm,
            item.canonicalization,
            item.value,
            item.id,
            item.locator,
            item.source_kind,
        ] {
            out.extend_from_slice(&id.to_le_bytes());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static SNAPSHOT_TEST: Mutex<()> = Mutex::new(());

    #[test]
    fn empty_fact_digest_is_canonical_empty_array() {
        let sorter = SpillSorter::new();
        let (digest, spilled) = sorter.digest().unwrap();
        let mut hasher = Sha256::new();
        hasher.update(b"[]");
        assert_eq!(digest, hex32(&hasher.finish()));
        assert_eq!(spilled, 0);
    }

    #[test]
    fn retained_canonical_bytes_are_zero_after_digest() {
        let mut sorter = SpillSorter::new();
        sorter.push(1, "{\"id\":\"B\"}".to_owned()).unwrap();
        sorter.push(0, "{\"id\":\"a\"}".to_owned()).unwrap();
        let _ = sorter.digest().unwrap();
    }

    fn sample_sections(strings: &[u8]) -> SnapshotSections {
        SnapshotSections {
            strings: strings.to_vec(),
            nodes: b"nodes".to_vec(),
            edges: b"edges".to_vec(),
            adjacency: b"adjacency".to_vec(),
            unresolved: b"unresolved".to_vec(),
            decisions: b"decisions".to_vec(),
        }
    }

    fn segment_file(root: &std::path::Path, bytes: &[u8]) -> std::path::PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        root.join("segments").join(hex32(&hasher.finish()))
    }

    #[test]
    fn unchanged_segment_keeps_inode_mtime_and_bytes() {
        let _guard = SNAPSHOT_TEST.lock().unwrap();
        use std::os::unix::fs::MetadataExt;
        let root = std::env::temp_dir().join(format!(
            "workspai-segment-{}-{}",
            std::process::id(),
            "reuse"
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let packed = root.join("graph.wgp");
        let first = sample_sections(b"strings-a");
        install_segmented_snapshot(packed.to_str().unwrap(), &first).unwrap();
        let nodes = segment_file(&root, b"nodes");
        let before = fs::metadata(&nodes).unwrap();
        let manifest = fs::read(&packed).unwrap();
        let second = sample_sections(b"strings-b");
        install_segmented_snapshot(packed.to_str().unwrap(), &second).unwrap();
        let after = fs::metadata(&nodes).unwrap();
        assert_eq!(before.ino(), after.ino());
        assert_eq!(before.modified().unwrap(), after.modified().unwrap());
        assert_eq!(fs::read(&nodes).unwrap(), b"nodes");
        assert_ne!(fs::read(&packed).unwrap(), manifest);
        assert!(segment_file(&root, b"strings-a").is_file());
        assert!(segment_file(&root, b"strings-b").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshot_faults_fail_closed_before_the_manifest_is_published() {
        let _guard = SNAPSHOT_TEST.lock().unwrap();
        let points = [
            "segment-open",
            "segment-write",
            "segment-sync",
            "segment-rename",
            "manifest-sync",
            "manifest-rename",
        ];
        for point in points {
            let root = std::env::temp_dir().join(format!(
                "workspai-segment-{}-{}",
                std::process::id(),
                point
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            let packed = root.join("graph.wgp");
            std::env::set_var("WORKSPAI_GRAPH_SNAPSHOT_FAULT", point);
            let failed = install_segmented_snapshot(
                packed.to_str().unwrap(),
                &sample_sections(b"strings"),
            );
            std::env::remove_var("WORKSPAI_GRAPH_SNAPSHOT_FAULT");
            assert!(failed.is_err(), "{point}");
            assert!(!packed.is_file(), "{point}");
            let _ = fs::remove_dir_all(&root);
        }
    }
}
