//! Full-composition session.
//!
//! Framed stdin, one fixed response frame, and two artifact files named by
//! the header. Canonical fact strings are spilled and removed. A panic still
//! writes a rejection frame when the runtime can unwind.

use std::io::{self, Read, Write};
use std::panic;
use std::process::exit;

use workspai_graph_engine::{
    hex32, ComposeFailure, ComposeOutput, ComposeRequest, Composer, LineageSpec, RelationSpec,
    ResidentEngine, ResidentFact, ResidentPartition, Sha256,
};

const KIND_HEADER: u8 = 1;
const KIND_COMPACT: u8 = 2;
const KIND_CANONICAL: u8 = 3;
const KIND_VALID_UNTIL: u8 = 4;
const KIND_FINISH: u8 = 5;
const RESPONSE_BYTES: u32 = 248;
const MAX_FRAME: u32 = 32 * 1024 * 1024;
const MAX_INPUT: u64 = 512 * 1024 * 1024;
const BUILD_IDENTITY: &str = concat!(
    "workspai.graph.compose-build.v1\t",
    env!("WORKSPAI_GRAPH_BUILD_RUSTC"),
    "\t",
    env!("WORKSPAI_GRAPH_BUILD_TARGET"),
    "\t2\tworkspai.graph.partition-journal.v1\tworkspai.graph.native-snapshot.v1",
    "\nworkspai.graph.compose-build.end.v1"
);

fn main() {
    let mut args = std::env::args();
    let _argv0 = args.next();
    let command = args.next();
    if command.as_deref() == Some("identity") {
        println!("{}", BUILD_IDENTITY.lines().next().unwrap_or_default());
        exit(0);
    }
    if command.as_deref() == Some("query") {
        let code = match workspai_graph_engine::serve_packed_queries() {
            Ok(()) => 0,
            Err(()) => 1,
        };
        exit(code);
    }
    if command.as_deref() == Some("session") {
        let code = match serve_partition_session() {
            Ok(()) => 0,
            Err(()) => 1,
        };
        exit(code);
    }
    let result = panic::catch_unwind(run);
    match result {
        Ok(Ok(())) => exit(0),
        Ok(Err(code)) => {
            let _ = write_response(1, code, &empty_output(), 0, 0);
            exit(0);
        }
        Err(_) => {
            let _ = write_response(1, 14, &empty_output(), 0, 0);
            exit(0);
        }
    }
}

fn run() -> Result<(), u32> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut total = 0u64;
    let mut header: Option<ComposeRequest> = None;
    let mut composer: Option<Composer> = None;
    let mut saw_finish = false;
    let mut ack_seq = 0u32;
    loop {
        let length = match read_u32(&mut input) {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(_) => return Err(1),
        };
        if length == 0 || length > MAX_FRAME {
            return Err(2);
        }
        total = total.saturating_add(length as u64);
        if total > MAX_INPUT {
            return Err(8);
        }
        let mut payload = vec![0u8; length as usize];
        input.read_exact(&mut payload).map_err(|_| 3u32)?;
        let kind = *payload.first().ok_or(2u32)?;
        let body = &payload[1..];
        if saw_finish {
            return Err(6);
        }
        match kind {
            KIND_HEADER => {
                if header.is_some() {
                    return Err(7);
                }
                let request = read_header(body)?;
                composer = Some(Composer::new(request.fact_count).map_err(failure_code)?);
                header = Some(request);
                write_ack(ack_seq, 0, 2)?;
                ack_seq = ack_seq.saturating_add(1);
            }
            KIND_COMPACT => {
                let composer = composer.as_mut().ok_or(13u32)?;
                if body.len() < 4 {
                    return Err(4);
                }
                let base = u32::from_le_bytes(body[0..4].try_into().map_err(|_| 4u32)?);
                let facts = composer
                    .ingest_compact(base, &body[4..])
                    .map_err(failure_code)?;
                write_ack(ack_seq, facts, 2)?;
                ack_seq = ack_seq.saturating_add(1);
            }
            KIND_CANONICAL => {
                let composer = composer.as_mut().ok_or(13u32)?;
                let (index, text) = read_indexed_string(body)?;
                composer
                    .ingest_canonical(index, &text)
                    .map_err(failure_code)?;
                write_ack(ack_seq, 1, 2)?;
                ack_seq = ack_seq.saturating_add(1);
            }
            KIND_VALID_UNTIL => {
                let composer = composer.as_mut().ok_or(13u32)?;
                let (index, text) = read_indexed_string(body)?;
                composer
                    .set_valid_until(index, &text)
                    .map_err(failure_code)?;
                write_ack(ack_seq, 0, 2)?;
                ack_seq = ack_seq.saturating_add(1);
            }
            KIND_FINISH => {
                if header.is_none() || !body.is_empty() {
                    return Err(13);
                }
                saw_finish = true;
            }
            _ => return Err(13),
        }
        if saw_finish {
            break;
        }
    }
    if !saw_finish {
        return Err(5);
    }
    match read_u32(&mut input) {
        Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {}
        Ok(_) => return Err(6),
        Err(_) => return Err(1),
    }
    let request = header.ok_or(13u32)?;
    let composer = composer.ok_or(13u32)?;
    let output = composer.finish(&request).map_err(failure_code)?;
    let packed_digest = hash_file(&request.packed_path).map_err(|_| 1u32)?;
    let (rss, known) = peak_rss();
    write_response(0, 0, &output, rss, known).map_err(|_| 1u32)?;
    write_quality(&output, &packed_digest).map_err(|_| 1u32)?;
    Ok(())
}

fn write_ack(seq: u32, facts: u32, stage: u32) -> Result<(), u32> {
    let mut payload = Vec::with_capacity(13);
    payload.push(0xA1);
    payload.extend_from_slice(&seq.to_le_bytes());
    payload.extend_from_slice(&facts.to_le_bytes());
    payload.extend_from_slice(&stage.to_le_bytes());
    write_frame(&payload).map_err(|_| 1u32)
}

fn write_quality(output: &ComposeOutput, packed_digest: &str) -> Result<(), ()> {
    let mut payload = Vec::with_capacity(4 + 12 * 4 + 64);
    payload.extend_from_slice(b"WQRY");
    for value in [
        output.proof_supported,
        output.proof_corroborated,
        output.proof_verified,
        output.proof_disputed,
        output.proof_insufficient,
        output.proof_unresolved,
        output.decisions_accepted,
        output.decisions_rejected,
        output.decisions_disputed,
        output.decisions_unresolved,
        output.orphans,
        output.stale_facts,
    ] {
        payload.extend_from_slice(&value.to_le_bytes());
    }
    payload.extend_from_slice(packed_digest.as_bytes());
    payload.extend_from_slice(&output.orphan_truncated.to_le_bytes());
    let record_len = u32::try_from(output.orphan_records.len()).map_err(|_| ())?;
    payload.extend_from_slice(&record_len.to_le_bytes());
    payload.extend_from_slice(&output.orphan_records);
    write_frame(&payload)
}

fn hash_file(path: &str) -> io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex32(&hasher.finish()))
}

fn failure_code(error: ComposeFailure) -> u32 {
    match error {
        ComposeFailure::Limit => 8,
        ComposeFailure::Index => 4,
        ComposeFailure::Parse => 10,
        ComposeFailure::Io => 1,
        ComposeFailure::Protocol => 13,
    }
}

fn empty_output() -> ComposeOutput {
    ComposeOutput {
        fact_digest: "0".repeat(64),
        content_digest: "0".repeat(64),
        facts: 0,
        nodes: 0,
        edges: 0,
        packed_bytes: 0,
        canonical_bytes: 0,
        spill_bytes: 0,
        retained_canonical_bytes: 0,
        decisions: 0,
        unresolved: 0,
        proof_supported: 0,
        proof_corroborated: 0,
        proof_verified: 0,
        proof_disputed: 0,
        proof_insufficient: 0,
        proof_unresolved: 0,
        decisions_accepted: 0,
        decisions_rejected: 0,
        decisions_disputed: 0,
        decisions_unresolved: 0,
        orphans: 0,
        orphan_truncated: 0,
        orphan_records: Vec::new(),
        stale_facts: 0,
        ingest_ms: 0,
        digest_ms: 0,
        edge_ms: 0,
        publish_ms: 0,
        affected_facts: 0,
        parsed_facts: 0,
    }
}

fn write_response(
    status: u32,
    code: u32,
    output: &ComposeOutput,
    rss: u64,
    rss_known: u32,
) -> Result<(), ()> {
    let mut payload = Vec::with_capacity(RESPONSE_BYTES as usize);
    payload.extend_from_slice(&status.to_le_bytes());
    payload.extend_from_slice(&code.to_le_bytes());
    payload.extend_from_slice(&digest_bytes(&output.fact_digest));
    payload.extend_from_slice(&digest_bytes(&output.content_digest));
    for value in [
        output.facts,
        output.nodes,
        output.edges,
        output.packed_bytes,
        output.canonical_bytes,
        output.spill_bytes,
        output.retained_canonical_bytes,
        rss,
        output.ingest_ms,
        output.digest_ms,
        output.edge_ms,
        output.publish_ms,
    ] {
        payload.extend_from_slice(&value.to_le_bytes());
    }
    payload.extend_from_slice(&rss_known.to_le_bytes());
    payload.extend_from_slice(&output.decisions.to_le_bytes());
    payload.extend_from_slice(&output.unresolved.to_le_bytes());
    payload.extend_from_slice(&0u32.to_le_bytes());
    if payload.len() != RESPONSE_BYTES as usize {
        return Err(());
    }
    write_frame(&payload)
}

fn digest_bytes(value: &str) -> [u8; 64] {
    let mut bytes = [b'0'; 64];
    let source = value.as_bytes();
    if source.len() == 64 && source.iter().all(|byte| byte.is_ascii_hexdigit()) {
        bytes.copy_from_slice(source);
    }
    bytes
}

fn write_frame(payload: &[u8]) -> Result<(), ()> {
    let mut stdout = io::stdout().lock();
    let length = u32::try_from(payload.len()).map_err(|_| ())?;
    stdout.write_all(&length.to_le_bytes()).map_err(|_| ())?;
    stdout.write_all(payload).map_err(|_| ())?;
    stdout.flush().map_err(|_| ())
}

fn read_header(mut body: &[u8]) -> Result<ComposeRequest, u32> {
    let protocol = read_body_u32(&mut body)?;
    if protocol != 2 {
        return Err(3);
    }
    let fact_count = read_body_u32(&mut body)?;
    let range_count = read_body_u32(&mut body)?;
    let mut ranges = Vec::with_capacity(range_count as usize);
    for _ in 0..range_count {
        ranges.push((read_body_u32(&mut body)?, read_body_u32(&mut body)?));
    }
    if body.len() < 8 {
        return Err(13);
    }
    let mut confidence_bytes = [0u8; 8];
    confidence_bytes.copy_from_slice(&body[..8]);
    body = &body[8..];
    let minimum_confidence = f64::from_le_bytes(confidence_bytes);
    if body.len() < 2 {
        return Err(13);
    }
    let inferred_reject = body[0] == 1;
    let unknown_freshness_reject = body[1] == 1;
    body = &body[2..];
    let max_edges = read_body_u32(&mut body)?;
    let evaluated_at = read_body_string(&mut body)?;
    let architecture_epoch = read_body_string(&mut body)?;
    let graph_version = read_body_string(&mut body)?;
    let schema_id = read_body_string(&mut body)?;
    let schema_version = read_body_string(&mut body)?;
    let ontology_id = read_body_string(&mut body)?;
    let ontology_version = read_body_string(&mut body)?;
    let canonical_path = read_body_string(&mut body)?;
    let packed_path = read_body_string(&mut body)?;
    let entity_count = read_body_u32(&mut body)?;
    let mut entities = Vec::with_capacity(entity_count as usize);
    for _ in 0..entity_count {
        entities.push((read_body_string(&mut body)?, read_body_string(&mut body)?));
    }
    let relation_count = read_body_u32(&mut body)?;
    let mut relations = Vec::with_capacity(relation_count as usize);
    for _ in 0..relation_count {
        relations.push(RelationSpec {
            kind: read_body_string(&mut body)?,
            semantics: read_body_string(&mut body)?,
            subject_families: read_string_list(&mut body)?,
            object_families: read_string_list(&mut body)?,
            authorities: read_string_list(&mut body)?,
            policy_id: read_body_string(&mut body)?,
            policy_version: read_body_string(&mut body)?,
        });
    }
    let functional = read_string_list(&mut body)?;
    if body.len() < 64 * 5 {
        return Err(13);
    }
    let mut digests = [
        String::new(),
        String::new(),
        String::new(),
        String::new(),
        String::new(),
    ];
    for digest in &mut digests {
        let text = std::str::from_utf8(&body[..64]).map_err(|_| 13u32)?;
        if text.len() != 64 || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(13);
        }
        *digest = text.to_owned();
        body = &body[64..];
    }
    let lineage_count = read_body_u32(&mut body)?;
    let mut lineages = Vec::with_capacity(lineage_count as usize);
    for _ in 0..lineage_count {
        lineages.push(LineageSpec {
            fact_id: read_body_string(&mut body)?,
            derivation: read_body_string(&mut body)?,
            roots: read_string_list(&mut body)?,
            parents: read_string_list(&mut body)?,
        });
    }
    if !body.is_empty() {
        return Err(6);
    }
    Ok(ComposeRequest {
        fact_count,
        ranges,
        minimum_confidence,
        inferred_reject,
        unknown_freshness_reject,
        max_edges,
        evaluated_at,
        architecture_epoch,
        graph_version,
        schema_id,
        schema_version,
        ontology_id,
        ontology_version,
        entities,
        relations,
        functional,
        digests,
        lineages,
        canonical_path,
        packed_path,
    })
}

const SESSION_BEGIN: u8 = 1;
const SESSION_UPSERT: u8 = 2;
const SESSION_REMOVE: u8 = 3;
const SESSION_COMMIT: u8 = 4;
const SESSION_ABORT: u8 = 5;

struct SessionFact {
    compact: Option<Vec<u8>>,
    canonical: Option<String>,
    valid_until: Option<String>,
}

struct SessionPartition {
    sequence: u64,
    facts: Vec<SessionFact>,
    digest: [u8; 32],
    dirty: bool,
    provider_id: String,
    source_identity: String,
    source_digest: String,
    metadata: String,
}

struct SessionUpsert {
    id: String,
    provider_id: String,
    source_identity: String,
    source_digest: String,
    metadata: String,
    facts: Vec<SessionFact>,
}

fn serve_partition_session() -> Result<(), ()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut template: Option<ComposeRequest> = None;
    let mut partitions: std::collections::BTreeMap<String, SessionPartition> =
        std::collections::BTreeMap::new();
    let mut next_sequence = 1u64;
    let mut ack_seq = 0u32;
    let mut generation_dirty = true;
    let mut last_header: Option<[u8; 32]> = None;
    let mut last: Option<(Vec<u8>, Vec<u8>)> = None;
    let mut engine = ResidentEngine::new().map_err(|_| ())?;
    loop {
        let length = match read_u32(&mut input) {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(_) => return Err(()),
        };
        if length == 0 || length > MAX_FRAME {
            return Err(());
        }
        let mut payload = vec![0u8; length as usize];
        if input.read_exact(&mut payload).is_err() {
            return Err(());
        }
        let kind = *payload.first().ok_or(())?;
        let body = &payload[1..];
        match kind {
            SESSION_BEGIN => {
                template = Some(read_header(body).map_err(|_| ())?);
                write_session_ack(ack_seq, &hash_bytes(body))?;
                ack_seq = ack_seq.saturating_add(1);
            }
            SESSION_UPSERT => {
                if template.is_none() {
                    return Err(());
                }
                let (upsert, digest) = read_upsert(body).map_err(|_| ())?;
                let dirty = partitions
                    .get(&upsert.id)
                    .map(|partition| partition.digest != digest)
                    .unwrap_or(true);
                if dirty {
                    generation_dirty = true;
                }
                let sequence = partitions
                    .get(&upsert.id)
                    .map(|partition| partition.sequence)
                    .unwrap_or_else(|| {
                        let sequence = next_sequence;
                        next_sequence = next_sequence.saturating_add(1);
                        sequence
                    });
                if dirty {
                    partitions.insert(
                        upsert.id,
                        SessionPartition {
                            sequence,
                            facts: upsert.facts,
                            digest,
                            dirty: true,
                            provider_id: upsert.provider_id,
                            source_identity: upsert.source_identity,
                            source_digest: upsert.source_digest,
                            metadata: upsert.metadata,
                        },
                    );
                }
                write_session_ack(ack_seq, &digest)?;
                ack_seq = ack_seq.saturating_add(1);
            }
            SESSION_REMOVE => {
                let mut cursor = body;
                let id = read_body_string(&mut cursor).map_err(|_| ())?;
                if !cursor.is_empty() {
                    return Err(());
                }
                if partitions.remove(&id).is_some() {
                    generation_dirty = true;
                }
                write_session_ack(ack_seq, &hash_bytes(body))?;
                ack_seq = ack_seq.saturating_add(1);
            }
            SESSION_COMMIT => {
                let mut header_changed = false;
                if !body.is_empty() {
                    let header_digest = semantic_header_digest(body).map_err(|_| ())?;
                    if last_header.is_some() && last_header != Some(header_digest) {
                        header_changed = true;
                    }
                    if last_header != Some(header_digest) {
                        generation_dirty = true;
                    }
                    template = Some(read_header(body).map_err(|_| ())?);
                    last_header = Some(header_digest);
                }
                let Some(template) = template.clone() else {
                    return Err(());
                };
                if !generation_dirty {
                    if let Some((response, quality)) = &last {
                        write_frame(response)?;
                        write_frame(quality)?;
                        write_session_stats(0, partitions.len() as u32, 0, 0, 0)?;
                        write_partition_meta(&partitions)?;
                        continue;
                    }
                }
                let mut ordered: Vec<(&String, &SessionPartition)> = partitions.iter().collect();
                ordered.sort_by_key(|(_, partition)| partition.sequence);
                let fact_count: u32 = ordered
                    .iter()
                    .map(|(_, partition)| partition.facts.len() as u32)
                    .fold(0u32, |total, count| total.saturating_add(count));
                let mut request = template;
                request.fact_count = fact_count;
                request.ranges = if fact_count == 0 {
                    Vec::new()
                } else {
                    vec![(0, fact_count)]
                };
                let mut inputs = Vec::with_capacity(ordered.len());
                for (id, partition) in &ordered {
                    let mut facts = Vec::with_capacity(partition.facts.len());
                    for fact in &partition.facts {
                        facts.push(ResidentFact {
                            compact: fact.compact.as_deref(),
                            canonical: fact.canonical.as_deref(),
                            valid_until: fact.valid_until.as_deref(),
                        });
                    }
                    inputs.push(ResidentPartition {
                        id,
                        digest: partition.digest,
                        facts,
                    });
                }
                let output = engine
                    .commit(&inputs, &request, header_changed)
                    .map_err(|_| ())?;
                let packed_digest = hash_file(&request.packed_path).map_err(|_| ())?;
                let (rss, known) = peak_rss();
                let mut response = Vec::new();
                let mut quality = Vec::new();
                write_response_to(&mut response, 0, 0, &output, rss, known).map_err(|_| ())?;
                write_quality_to(&mut quality, &output, &packed_digest).map_err(|_| ())?;
                write_frame(&response)?;
                write_frame(&quality)?;
                let recomputed = partitions
                    .values()
                    .filter(|partition| partition.dirty)
                    .count() as u32;
                for partition in partitions.values_mut() {
                    partition.dirty = false;
                }
                generation_dirty = false;
                write_session_stats(
                    1,
                    partitions.len().saturating_sub(recomputed as usize) as u32,
                    recomputed,
                    output.affected_facts.min(u64::from(u32::MAX)) as u32,
                    output.parsed_facts.min(u64::from(u32::MAX)) as u32,
                )?;
                write_partition_meta(&partitions)?;
                last = Some((response, quality));
            }
            SESSION_ABORT => {
                partitions.clear();
                engine.reset();
                last = None;
                last_header = None;
                next_sequence = 1;
                generation_dirty = true;
                write_session_ack(ack_seq, &hash_bytes(body))?;
                ack_seq = ack_seq.saturating_add(1);
            }
            _ => return Err(()),
        }
    }
}

/// Identity of a commit header excluding execution metadata.
/// `evaluatedAt` and the canonical/packed output paths are not part of the
/// fact or content digest, so a later build must not recompute because of them.
fn semantic_header_digest(body: &[u8]) -> Result<[u8; 32], ()> {
    if body.len() < 12 {
        return Err(());
    }
    let range_count = u32::from_le_bytes(body[8..12].try_into().map_err(|_| ())?) as usize;
    let prefix_end = 26usize
        .checked_add(range_count.checked_mul(8).ok_or(())?)
        .ok_or(())?;
    if body.len() < prefix_end {
        return Err(());
    }
    let mut cursor = &body[prefix_end..];
    skip_header_string(&mut cursor)?;
    let middle_start = body.len() - cursor.len();
    for _ in 0..6 {
        skip_header_string(&mut cursor)?;
    }
    let middle_end = body.len() - cursor.len();
    skip_header_string(&mut cursor)?;
    skip_header_string(&mut cursor)?;
    let mut hasher = Sha256::new();
    hasher.update(&body[..prefix_end]);
    hasher.update(&body[middle_start..middle_end]);
    hasher.update(cursor);
    Ok(hasher.finish())
}

fn skip_header_string(body: &mut &[u8]) -> Result<(), ()> {
    if body.len() < 4 {
        return Err(());
    }
    let length = u32::from_le_bytes(body[..4].try_into().map_err(|_| ())?) as usize;
    let next = 4usize.checked_add(length).ok_or(())?;
    if body.len() < next {
        return Err(());
    }
    *body = &body[next..];
    Ok(())
}

fn hash_bytes(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finish()
}

fn write_session_ack(seq: u32, digest: &[u8; 32]) -> Result<(), ()> {
    let mut payload = Vec::with_capacity(42);
    payload.push(0xA3);
    payload.push(1);
    payload.extend_from_slice(&2u32.to_le_bytes());
    payload.extend_from_slice(&seq.to_le_bytes());
    payload.extend_from_slice(digest);
    write_frame(&payload)
}

fn write_session_stats(
    recomputed: u32,
    reused: u32,
    touched: u32,
    affected_facts: u32,
    parsed_facts: u32,
) -> Result<(), ()> {
    let mut payload = Vec::with_capacity(24);
    payload.extend_from_slice(b"WSES");
    payload.extend_from_slice(&recomputed.to_le_bytes());
    payload.extend_from_slice(&reused.to_le_bytes());
    payload.extend_from_slice(&touched.to_le_bytes());
    payload.extend_from_slice(&affected_facts.to_le_bytes());
    payload.extend_from_slice(&parsed_facts.to_le_bytes());
    write_frame(&payload)
}

fn write_partition_meta(
    partitions: &std::collections::BTreeMap<String, SessionPartition>,
) -> Result<(), ()> {
    let mut ordered: Vec<(&String, &SessionPartition)> = partitions.iter().collect();
    ordered.sort_by_key(|(_, partition)| partition.sequence);
    let mut payload = Vec::new();
    payload.extend_from_slice(b"WMET");
    payload.extend_from_slice(&(ordered.len() as u32).to_le_bytes());
    for (id, partition) in ordered {
        write_meta_text(&mut payload, id);
        write_meta_text(&mut payload, &partition.provider_id);
        write_meta_text(&mut payload, &partition.source_identity);
        write_meta_text(&mut payload, &partition.source_digest);
        write_meta_text(&mut payload, &partition.metadata);
    }
    write_frame(&payload)
}

fn write_meta_text(payload: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    payload.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    payload.extend_from_slice(bytes);
}

fn read_upsert(mut body: &[u8]) -> Result<(SessionUpsert, [u8; 32]), u32> {
    let mut hasher = Sha256::new();
    hasher.update(body);
    let digest = hasher.finish();
    if body.len() < 4 || &body[..4] != b"PM2\0" {
        return Err(13);
    }
    body = &body[4..];
    let id = read_body_string(&mut body)?;
    let provider_id = read_body_string(&mut body)?;
    let source_identity = read_body_string(&mut body)?;
    let source_digest = read_body_string(&mut body)?;
    let metadata = read_body_string(&mut body)?;
    let count = read_body_u32(&mut body)?;
    let mut facts = Vec::with_capacity(count as usize);
    for _ in 0..count {
        if body.is_empty() {
            return Err(13);
        }
        let kind = body[0];
        body = &body[1..];
        let bytes = read_body_bytes(&mut body)?;
        let valid_until = if body.first() == Some(&1) {
            body = &body[1..];
            Some(read_body_string(&mut body)?)
        } else if body.first() == Some(&0) {
            body = &body[1..];
            None
        } else {
            return Err(13);
        };
        facts.push(match kind {
            2 => SessionFact {
                compact: Some(bytes),
                canonical: None,
                valid_until,
            },
            3 => SessionFact {
                compact: None,
                canonical: Some(String::from_utf8(bytes).map_err(|_| 10u32)?),
                valid_until,
            },
            _ => return Err(13),
        });
    }
    if !body.is_empty() {
        return Err(6);
    }
    Ok((
        SessionUpsert {
            id,
            provider_id,
            source_identity,
            source_digest,
            metadata,
            facts,
        },
        digest,
    ))
}

fn read_body_bytes(body: &mut &[u8]) -> Result<Vec<u8>, u32> {
    let length = read_body_u32(body)? as usize;
    if body.len() < length {
        return Err(13);
    }
    let bytes = body[..length].to_vec();
    *body = &body[length..];
    Ok(bytes)
}

fn write_response_to(
    payload: &mut Vec<u8>,
    status: u32,
    code: u32,
    output: &ComposeOutput,
    rss: u64,
    rss_known: u32,
) -> Result<(), ()> {
    payload.extend_from_slice(&status.to_le_bytes());
    payload.extend_from_slice(&code.to_le_bytes());
    payload.extend_from_slice(&digest_bytes(&output.fact_digest));
    payload.extend_from_slice(&digest_bytes(&output.content_digest));
    for value in [
        output.facts,
        output.nodes,
        output.edges,
        output.packed_bytes,
        output.canonical_bytes,
        output.spill_bytes,
        output.retained_canonical_bytes,
        rss,
        output.ingest_ms,
        output.digest_ms,
        output.edge_ms,
        output.publish_ms,
    ] {
        payload.extend_from_slice(&value.to_le_bytes());
    }
    payload.extend_from_slice(&rss_known.to_le_bytes());
    payload.extend_from_slice(&output.decisions.to_le_bytes());
    payload.extend_from_slice(&output.unresolved.to_le_bytes());
    payload.extend_from_slice(&0u32.to_le_bytes());
    if payload.len() != RESPONSE_BYTES as usize {
        return Err(());
    }
    Ok(())
}

fn write_quality_to(
    payload: &mut Vec<u8>,
    output: &ComposeOutput,
    packed_digest: &str,
) -> Result<(), ()> {
    payload.extend_from_slice(b"WQRY");
    for value in [
        output.proof_supported,
        output.proof_corroborated,
        output.proof_verified,
        output.proof_disputed,
        output.proof_insufficient,
        output.proof_unresolved,
        output.decisions_accepted,
        output.decisions_rejected,
        output.decisions_disputed,
        output.decisions_unresolved,
        output.orphans,
        output.stale_facts,
    ] {
        payload.extend_from_slice(&value.to_le_bytes());
    }
    payload.extend_from_slice(packed_digest.as_bytes());
    payload.extend_from_slice(&output.orphan_truncated.to_le_bytes());
    let record_len = u32::try_from(output.orphan_records.len()).map_err(|_| ())?;
    payload.extend_from_slice(&record_len.to_le_bytes());
    payload.extend_from_slice(&output.orphan_records);
    Ok(())
}

fn read_string_list(body: &mut &[u8]) -> Result<Vec<String>, u32> {
    let count = read_body_u32(body)?;
    let mut values = Vec::with_capacity(count as usize);
    for _ in 0..count {
        values.push(read_body_string(body)?);
    }
    Ok(values)
}

fn read_indexed_string(mut body: &[u8]) -> Result<(u32, String), u32> {
    let index = read_body_u32(&mut body)?;
    let text = read_body_string(&mut body)?;
    if !body.is_empty() {
        return Err(6);
    }
    Ok((index, text))
}

fn read_body_u32(body: &mut &[u8]) -> Result<u32, u32> {
    if body.len() < 4 {
        return Err(13);
    }
    let mut bytes = [0u8; 4];
    bytes.copy_from_slice(&body[..4]);
    *body = &body[4..];
    Ok(u32::from_le_bytes(bytes))
}

fn read_body_string(body: &mut &[u8]) -> Result<String, u32> {
    let length = read_body_u32(body)? as usize;
    if length > 16 * 1024 * 1024 || body.len() < length {
        return Err(8);
    }
    let text = std::str::from_utf8(&body[..length])
        .map_err(|_| 10u32)?
        .to_owned();
    *body = &body[length..];
    Ok(text)
}

fn read_u32(input: &mut impl Read) -> io::Result<u32> {
    let mut bytes = [0u8; 4];
    input.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn peak_rss() -> (u64, u32) {
    #[cfg(target_os = "linux")]
    {
        if let Ok(text) = std::fs::read_to_string("/proc/self/status") {
            for line in text.lines() {
                if let Some(rest) = line.strip_prefix("VmHWM:") {
                    if let Some(kb) = rest.split_whitespace().next() {
                        if let Ok(value) = kb.parse::<u64>() {
                            return (value.saturating_mul(1024), 1);
                        }
                    }
                }
            }
        }
    }
    (0, 0)
}
