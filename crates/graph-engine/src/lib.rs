//! Graph engine acceleration kernel.
//!
//! TypeScript remains semantic authority. This crate provides:
//! - declaration extraction with TypeScript parity gates
//! - comment/string masking (char-vector with a no-delimiter fast path)
//! - deterministic CSR BFS
//! - a low-level WASM ABI
//!
//! Not shipped: N-API/native addon, JSON/object-graph composition, Tree-sitter
//! grammars, or unbounded Rayon fan-out. The compact-fact kernel emits the
//! TypeScript semantic-fact string. A digest mismatch falls back to TypeScript.

#![forbid(unsafe_op_in_unsafe_fn)]

mod collate;
mod compose;
mod extract;
mod fact_set;
#[cfg(not(target_arch = "wasm32"))]
mod graph_compose;
#[cfg(not(target_arch = "wasm32"))]
mod packed_query;
mod sha256;
pub use sha256::{hex32, Sha256};

#[cfg(not(target_arch = "wasm32"))]
pub use graph_compose::{
    ComposeFailure, ComposeOutput, ComposeRequest, Composer, LineageSpec, RelationSpec,
    ResidentEngine, ResidentFact, ResidentPartition,
};
#[cfg(not(target_arch = "wasm32"))]
pub use packed_query::serve_packed_queries;

pub use compose::{compose_fact_canonical, pack_fact_canonical, ComposeError};
pub use fact_set::{FactSet, FactSetError};

use std::collections::VecDeque;

pub use extract::{
    extract_declarations, Declaration, DeclarationKind, ExtractError, Language,
    LANGUAGE_UNSPECIFIED, MAX_DECLARATIONS, MAX_DECLARATION_SOURCE_BYTES,
};

pub const ABI_VERSION: u32 = 1;
pub const MAX_NODES: u32 = 1_000_000;
pub const MAX_EDGES: usize = 5_000_000;
pub const MAX_MEMORY_BYTES: u32 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TraversalError {
    InvalidNodeCount,
    InvalidStart,
    TooManyEdges,
    InvalidEdge,
    OutputTooSmall,
}

impl TraversalError {
    #[cfg(target_arch = "wasm32")]
    const fn abi_code(self) -> i32 {
        match self {
            Self::InvalidNodeCount => -1,
            Self::InvalidStart => -2,
            Self::TooManyEdges => -3,
            Self::InvalidEdge => -4,
            Self::OutputTooSmall => -5,
        }
    }
}

/// Deterministic bounded breadth-first traversal over directed edges.
///
/// Neighbors are sorted and deduplicated, so edge input order cannot alter the
/// output. This primitive owns no Graph identity, proof or authority semantics.
pub fn reachable_nodes(
    node_count: u32,
    edges: &[(u32, u32)],
    start: u32,
    max_depth: u32,
) -> Result<Vec<u32>, TraversalError> {
    if node_count == 0 || node_count > MAX_NODES {
        return Err(TraversalError::InvalidNodeCount);
    }
    if start >= node_count {
        return Err(TraversalError::InvalidStart);
    }
    if edges.len() > MAX_EDGES {
        return Err(TraversalError::TooManyEdges);
    }

    let mut offsets = vec![0usize; node_count as usize + 1];
    for &(from, to) in edges {
        if from >= node_count || to >= node_count {
            return Err(TraversalError::InvalidEdge);
        }
        offsets[from as usize + 1] += 1;
    }
    for index in 1..offsets.len() {
        offsets[index] += offsets[index - 1];
    }
    let mut neighbors = vec![0u32; offsets[node_count as usize]];
    let mut insert = offsets[..node_count as usize].to_vec();
    for &(from, to) in edges {
        let slot = insert[from as usize];
        neighbors[slot] = to;
        insert[from as usize] += 1;
    }
    let mut compact_offsets = vec![0usize; node_count as usize + 1];
    let mut compact = Vec::with_capacity(neighbors.len());
    for node in 0..node_count as usize {
        compact_offsets[node] = compact.len();
        let slice = &mut neighbors[offsets[node]..offsets[node + 1]];
        slice.sort_unstable();
        let mut previous: Option<u32> = None;
        for &neighbor in slice.iter() {
            if previous == Some(neighbor) {
                continue;
            }
            compact.push(neighbor);
            previous = Some(neighbor);
        }
    }
    compact_offsets[node_count as usize] = compact.len();

    let mut depths = vec![u32::MAX; node_count as usize];
    let mut queue = VecDeque::new();
    let mut output = Vec::new();
    depths[start as usize] = 0;
    queue.push_back(start);

    while let Some(node) = queue.pop_front() {
        let depth = depths[node as usize];
        output.push(node);
        if depth >= max_depth {
            continue;
        }
        let from = compact_offsets[node as usize];
        let to = compact_offsets[node as usize + 1];
        for &neighbor in &compact[from..to] {
            if depths[neighbor as usize] == u32::MAX {
                depths[neighbor as usize] = depth + 1;
                queue.push_back(neighbor);
            }
        }
    }

    Ok(output)
}

#[no_mangle]
pub extern "C" fn graph_engine_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn graph_engine_memory_limit_bytes() -> u32 {
    MAX_MEMORY_BYTES
}

#[no_mangle]
pub extern "C" fn graph_engine_max_nodes() -> u32 {
    MAX_NODES
}

#[no_mangle]
pub extern "C" fn graph_engine_max_edges() -> u32 {
    MAX_EDGES as u32
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn graph_engine_alloc_u32(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    let Ok(capacity) = usize::try_from(length) else {
        return 0;
    };
    let mut buffer = Vec::<u32>::with_capacity(capacity);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer as u32
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn graph_engine_dealloc_u32(pointer: u32, capacity: u32) {
    if pointer == 0 || capacity == 0 {
        return;
    }
    // SAFETY: callers return only pointers and capacities produced by
    // graph_engine_alloc_u32, exactly once, after the engine call completes.
    unsafe {
        drop(Vec::from_raw_parts(
            pointer as *mut u32,
            0,
            capacity as usize,
        ));
    }
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn graph_engine_reachable(
    node_count: u32,
    edge_words_pointer: u32,
    edge_count: u32,
    start: u32,
    max_depth: u32,
    output_pointer: u32,
    output_capacity: u32,
) -> i32 {
    let Some(edge_word_count) = edge_count.checked_mul(2) else {
        return TraversalError::TooManyEdges.abi_code();
    };
    if edge_count as usize > MAX_EDGES {
        return TraversalError::TooManyEdges.abi_code();
    }
    if edge_word_count > 0 && edge_words_pointer == 0 {
        return TraversalError::InvalidEdge.abi_code();
    }
    if output_capacity > 0 && output_pointer == 0 {
        return TraversalError::OutputTooSmall.abi_code();
    }

    // SAFETY: the ABI caller allocates these ranges in this module's linear
    // memory and supplies their exact lengths. Bounds violations trap and are
    // converted into a failed adapter result by the TypeScript owner.
    let edge_words = unsafe {
        std::slice::from_raw_parts(edge_words_pointer as *const u32, edge_word_count as usize)
    };
    let edges: Vec<(u32, u32)> = edge_words
        .chunks_exact(2)
        .map(|pair| (pair[0], pair[1]))
        .collect();
    let reachable = match reachable_nodes(node_count, &edges, start, max_depth) {
        Ok(value) => value,
        Err(error) => return error.abi_code(),
    };
    if reachable.len() > output_capacity as usize {
        return TraversalError::OutputTooSmall.abi_code();
    }

    // SAFETY: output_pointer references output_capacity u32 slots allocated by
    // graph_engine_alloc_u32 and reachable length was checked above.
    let output = unsafe {
        std::slice::from_raw_parts_mut(output_pointer as *mut u32, output_capacity as usize)
    };
    output[..reachable.len()].copy_from_slice(&reachable);
    reachable.len() as i32
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn graph_engine_alloc_u8(length: u32) -> u32 {
    if length == 0 {
        return 0;
    }
    let Ok(capacity) = usize::try_from(length) else {
        return 0;
    };
    let mut buffer = Vec::<u8>::with_capacity(capacity);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer as u32
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn graph_engine_dealloc_u8(pointer: u32, capacity: u32) {
    if pointer == 0 || capacity == 0 {
        return;
    }
    // SAFETY: callers return only pointers and capacities produced by
    // graph_engine_alloc_u8, exactly once, after the engine call completes.
    unsafe {
        drop(Vec::from_raw_parts(
            pointer as *mut u8,
            0,
            capacity as usize,
        ));
    }
}

#[cfg(target_arch = "wasm32")]
const EXTRACT_INVALID_UTF8: i32 = -14;
#[cfg(target_arch = "wasm32")]
const EXTRACT_OUTPUT_TOO_SMALL: i32 = -15;
#[cfg(target_arch = "wasm32")]
const EXTRACT_NAMES_TOO_SMALL: i32 = -16;

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn graph_engine_extract_declarations(
    source_pointer: u32,
    source_len: u32,
    language: u32,
    records_pointer: u32,
    records_capacity: u32,
    names_pointer: u32,
    names_capacity: u32,
) -> i32 {
    if source_len > 0 && source_pointer == 0 {
        return EXTRACT_INVALID_UTF8;
    }
    // SAFETY: the ABI caller allocates this exact UTF-8 range in linear memory.
    let source_bytes = if source_len == 0 {
        &[]
    } else {
        // SAFETY: nonempty input was checked for a null pointer above.
        unsafe { std::slice::from_raw_parts(source_pointer as *const u8, source_len as usize) }
    };
    let source = match std::str::from_utf8(source_bytes) {
        Ok(value) => value,
        Err(_) => return EXTRACT_INVALID_UTF8,
    };
    let language = match Language::from_abi(language) {
        Ok(value) => value,
        Err(error) => return error.abi_code(),
    };
    let findings = match extract_declarations(source, language) {
        Ok(value) => value,
        Err(error) => return error.abi_code(),
    };
    if findings.len() > records_capacity as usize {
        return EXTRACT_OUTPUT_TOO_SMALL;
    }
    let names_len: usize = findings.iter().map(|item| item.name.len()).sum();
    if names_len > names_capacity as usize {
        return EXTRACT_NAMES_TOO_SMALL;
    }
    if findings.is_empty() {
        return 0;
    }
    if records_pointer == 0 || names_pointer == 0 {
        return EXTRACT_OUTPUT_TOO_SMALL;
    }

    // SAFETY: records_pointer references records_capacity declaration slots and
    // names_pointer references names_capacity bytes allocated by the ABI caller.
    let records = unsafe {
        std::slice::from_raw_parts_mut(
            records_pointer as *mut u32,
            (records_capacity as usize).saturating_mul(4),
        )
    };
    let names = unsafe {
        std::slice::from_raw_parts_mut(names_pointer as *mut u8, names_capacity as usize)
    };
    let mut name_offset = 0usize;
    for (index, finding) in findings.iter().enumerate() {
        let base = index * 4;
        let name_bytes = finding.name.as_bytes();
        records[base] = finding.line;
        records[base + 1] = finding.kind.abi_code();
        records[base + 2] = name_offset as u32;
        records[base + 3] = name_bytes.len() as u32;
        names[name_offset..name_offset + name_bytes.len()].copy_from_slice(name_bytes);
        name_offset += name_bytes.len();
    }
    findings.len() as i32
}

#[cfg(target_arch = "wasm32")]
const COMPOSE_OUTPUT_TOO_SMALL: i32 = compose::COMPOSE_OUTPUT_TOO_SMALL;

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn graph_engine_compose_facts(
    input_pointer: u32,
    input_len: u32,
    output_pointer: u32,
    output_capacity: u32,
) -> i32 {
    if input_len > 0 && input_pointer == 0 {
        return ComposeError::Invalid.abi_code();
    }
    // SAFETY: the ABI caller allocates this exact byte range in linear memory.
    let input = if input_len == 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(input_pointer as *const u8, input_len as usize) }
    };
    let facts = match compose_fact_canonical(input) {
        Ok(value) => value,
        Err(error) => return error.abi_code(),
    };
    let packed = pack_fact_canonical(&facts);
    if packed.len() > output_capacity as usize {
        return COMPOSE_OUTPUT_TOO_SMALL;
    }
    if packed.is_empty() {
        return 0;
    }
    if output_pointer == 0 {
        return COMPOSE_OUTPUT_TOO_SMALL;
    }
    // SAFETY: output_pointer references output_capacity bytes allocated by the caller.
    let output = unsafe {
        std::slice::from_raw_parts_mut(output_pointer as *mut u8, output_capacity as usize)
    };
    output[..packed.len()].copy_from_slice(&packed);
    packed.len() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traversal_is_deterministic_across_edge_order_and_duplicates() {
        let first = reachable_nodes(6, &[(0, 2), (2, 4), (0, 1), (1, 3), (0, 1)], 0, 2)
            .expect("valid traversal");
        let second =
            reachable_nodes(6, &[(1, 3), (0, 1), (2, 4), (0, 2)], 0, 2).expect("valid traversal");
        assert_eq!(first, vec![0, 1, 2, 3, 4]);
        assert_eq!(first, second);
    }

    #[test]
    fn traversal_preserves_direction_and_depth_budget() {
        let result =
            reachable_nodes(4, &[(0, 1), (1, 2), (2, 3), (3, 0)], 1, 1).expect("valid traversal");
        assert_eq!(result, vec![1, 2]);
    }

    #[test]
    fn malformed_inputs_fail_closed() {
        assert_eq!(
            reachable_nodes(0, &[], 0, 0),
            Err(TraversalError::InvalidNodeCount)
        );
        assert_eq!(
            reachable_nodes(2, &[], 2, 0),
            Err(TraversalError::InvalidStart)
        );
        assert_eq!(
            reachable_nodes(2, &[(0, 2)], 0, 1),
            Err(TraversalError::InvalidEdge)
        );
    }

    #[test]
    fn abi_resource_limits_are_stable_and_memory_bounded() {
        assert_eq!(graph_engine_max_nodes(), 1_000_000);
        assert_eq!(graph_engine_max_edges(), 5_000_000);
        assert_eq!(graph_engine_memory_limit_bytes(), 268_435_456);
    }
}
