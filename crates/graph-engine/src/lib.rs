#![forbid(unsafe_op_in_unsafe_fn)]

use std::collections::VecDeque;

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

    let mut adjacency = vec![Vec::<u32>::new(); node_count as usize];
    for &(from, to) in edges {
        if from >= node_count || to >= node_count {
            return Err(TraversalError::InvalidEdge);
        }
        adjacency[from as usize].push(to);
    }
    for neighbors in &mut adjacency {
        neighbors.sort_unstable();
        neighbors.dedup();
    }

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
        for &neighbor in &adjacency[node as usize] {
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
