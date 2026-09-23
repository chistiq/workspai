//! Fact-set digest owned by Rust.
//!
//! Canonical JSON strings stay in this process. The host receives the SHA-256
//! hex digest, not the strings. Ordering is the printable-ASCII collation plus
//! the original fact index, matching `localeCompare || index`.

use crate::collate::{self, CollationError};
use crate::compose::{compose_fact_canonical, ComposeError};
use crate::sha256::{hex32, Sha256};

/// Canonical keys above this size are rejected instead of growing without a bound.
pub const MAX_FACT_SET_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_FACT_SET_FACTS: usize = 1_000_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FactSetError {
    Collation(CollationError),
    Compose(ComposeError),
    Limit,
    Index,
}

pub struct FactSet {
    entries: Vec<(u32, String)>,
    bytes: usize,
}

impl FactSet {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            bytes: 0,
        }
    }

    pub fn push_canonical(&mut self, index: u32, canonical: String) -> Result<(), FactSetError> {
        if self.entries.len() >= MAX_FACT_SET_FACTS {
            return Err(FactSetError::Limit);
        }
        let next = self.bytes.saturating_add(canonical.len());
        if next > MAX_FACT_SET_BYTES {
            return Err(FactSetError::Limit);
        }
        if !collate::printable_ascii(&canonical) {
            return Err(FactSetError::Collation(CollationError::UnsupportedByte));
        }
        self.bytes = next;
        self.entries.push((index, canonical));
        Ok(())
    }

    pub fn push_compact_batch(
        &mut self,
        base_index: u32,
        bytes: &[u8],
    ) -> Result<usize, FactSetError> {
        let rendered = compose_fact_canonical(bytes).map_err(FactSetError::Compose)?;
        if base_index as usize >= MAX_FACT_SET_FACTS
            || rendered.len() > MAX_FACT_SET_FACTS - base_index as usize
        {
            return Err(FactSetError::Index);
        }
        for (offset, canonical) in rendered.into_iter().enumerate() {
            self.push_canonical(base_index + offset as u32, canonical)?;
        }
        Ok(self.entries.len())
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn canonical_bytes(&self) -> usize {
        self.bytes
    }

    /// Sort, hash, and drop the canonical strings.
    pub fn digest_hex(mut self) -> Result<String, FactSetError> {
        let mut collation_failed = false;
        self.entries.sort_by(|left, right| {
            match collate::compare_locale_ascii(&left.1, &right.1) {
                Ok(order) => order.then(left.0.cmp(&right.0)),
                Err(_) => {
                    collation_failed = true;
                    std::cmp::Ordering::Equal
                }
            }
        });
        if collation_failed {
            return Err(FactSetError::Collation(CollationError::UnsupportedByte));
        }
        let mut hasher = Sha256::new();
        hasher.update(b"[");
        for (index, (_, key)) in self.entries.iter().enumerate() {
            if index > 0 {
                hasher.update(b",");
            }
            hasher.update(key.as_bytes());
        }
        hasher.update(b"]");
        self.entries.clear();
        Ok(hex32(&hasher.finish()))
    }
}

impl Default for FactSet {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_breaks_equal_keys_and_case_folds() {
        let mut set = FactSet::new();
        set.push_canonical(1, "{\"id\":\"B\"}".to_string()).unwrap();
        set.push_canonical(0, "{\"id\":\"a\"}".to_string()).unwrap();
        set.push_canonical(2, "{\"id\":\"A\"}".to_string()).unwrap();
        let digest = set.digest_hex().unwrap();
        assert_eq!(digest.len(), 64);
        let mut again = FactSet::new();
        again
            .push_canonical(2, "{\"id\":\"A\"}".to_string())
            .unwrap();
        again
            .push_canonical(0, "{\"id\":\"a\"}".to_string())
            .unwrap();
        again
            .push_canonical(1, "{\"id\":\"B\"}".to_string())
            .unwrap();
        assert_eq!(again.digest_hex().unwrap(), digest);
    }

    #[test]
    fn empty_set_is_empty_json_array() {
        let digest = FactSet::new().digest_hex().unwrap();
        assert_eq!(digest, crate::sha256::hex32(&crate::sha256::sha256(b"[]")));
    }
}
