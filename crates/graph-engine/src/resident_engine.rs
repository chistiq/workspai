//! Partition-resident composition.
//!
//! Unchanged partitions stay decoded. A later commit reparses only dirty
//! partitions and re-evaluates proofs for the affected fact closure. Identity
//! is rebuilt from resident entities because unresolved candidate order is
//! global; that walk does not re-decode source bytes.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use crate::compose::compose_fact_canonical;

use super::{
    complete_output, identity_from_groups, validate_ranges, ComposeFailure, ComposeOutput,
    ComposeRequest, Entity, Fact, Identity, Selective, Store,
};

pub struct ResidentFact<'a> {
    pub compact: Option<&'a [u8]>,
    pub canonical: Option<&'a str>,
    pub valid_until: Option<&'a str>,
}

pub struct ResidentPartition<'a> {
    pub id: &'a str,
    pub digest: [u8; 32],
    pub facts: Vec<ResidentFact<'a>>,
}

struct HeldFact {
    fact: Fact,
    key: String,
}

struct HeldPartition {
    digest: [u8; 32],
    facts: Vec<HeldFact>,
}

pub struct ResidentEngine {
    store: Store,
    held: BTreeMap<String, HeldPartition>,
    order: Vec<String>,
    built: Option<super::Built>,
    identity: Option<Identity>,
}

impl ResidentEngine {
    pub fn new() -> Result<Self, ComposeFailure> {
        Ok(Self {
            store: Store::new(0)?,
            held: BTreeMap::new(),
            order: Vec::new(),
            built: None,
            identity: None,
        })
    }

    pub fn reset(&mut self) {
        *self = Self::new().expect("empty resident engine");
    }

    pub fn commit(
        &mut self,
        partitions: &[ResidentPartition<'_>],
        request: &ComposeRequest,
        force_full: bool,
    ) -> Result<ComposeOutput, ComposeFailure> {
        let parse_started = Instant::now();
        let mut removed_fact_ids = HashSet::new();
        let mut dirty_entities = HashSet::new();
        let mut parsed_facts = 0u64;
        let mut seen = HashSet::new();
        let mut next_order = Vec::new();
        for partition in partitions {
            seen.insert(partition.id.to_owned());
            next_order.push(partition.id.to_owned());
            if self
                .held
                .get(partition.id)
                .is_some_and(|held| held.digest == partition.digest)
            {
                continue;
            }
            if let Some(previous) = self.held.remove(partition.id) {
                for held in previous.facts {
                    removed_fact_ids.insert(held.fact.fact_id);
                    remember_entities(&mut dirty_entities, &held.fact);
                }
            }
            let mut facts = Vec::new();
            for input in &partition.facts {
                let parsed = self.parse_fact(input)?;
                parsed_facts += parsed.len() as u64;
                for held in &parsed {
                    remember_entities(&mut dirty_entities, &held.fact);
                }
                facts.extend(parsed);
            }
            self.held.insert(
                partition.id.to_owned(),
                HeldPartition {
                    digest: partition.digest,
                    facts,
                },
            );
        }
        let stale: Vec<String> = self
            .held
            .keys()
            .filter(|id| !seen.contains(id.as_str()))
            .cloned()
            .collect();
        for id in stale {
            if let Some(previous) = self.held.remove(&id) {
                for held in previous.facts {
                    removed_fact_ids.insert(held.fact.fact_id);
                    remember_entities(&mut dirty_entities, &held.fact);
                }
            }
        }
        self.order = next_order;
        let ingest_ms = parse_started.elapsed().as_millis() as u64;
        self.install_slots();
        if request.fact_count as usize != self.store.slots.len() || !self.store.complete() {
            return Err(ComposeFailure::Index);
        }
        validate_ranges(request)?;
        let _ = self.store.intern.intern(&request.evaluated_at)?;
        let groups = self.entity_groups();
        let identity = identity_from_groups(&mut self.store, groups)?;
        let total = self.store.slots.len();
        let selective = self.built.is_some()
            && self.identity.is_some()
            && !force_full
            && request.functional.is_empty();
        let (only_slots, mut touched_fact_ids) = if selective {
            let mut seeds = dirty_entities;
            if let Some(previous) = &self.identity {
                seeds.extend(changed_entities(previous, &identity));
            }
            let (slots, fact_ids) = self.closure(&seeds);
            (Some(slots), fact_ids)
        } else {
            (None, HashSet::new())
        };
        touched_fact_ids.extend(removed_fact_ids);
        let affected = only_slots
            .as_ref()
            .map(|slots| slots.len())
            .unwrap_or(total) as u64;
        let full = only_slots.as_ref().is_none_or(|slots| slots.len() == total);
        let previous = if full { None } else { self.built.clone() };
        let mut sorter = super::SpillSorter::new();
        let mut index = 0u32;
        for id in &self.order {
            let Some(partition) = self.held.get(id) else {
                continue;
            };
            for held in &partition.facts {
                sorter.push(index, held.key.clone())?;
                index = index.saturating_add(1);
            }
        }
        let identity_for_build = identity.clone();
        let (fact_digest, spill_bytes, digest_ms, built, edge_ms) = std::thread::scope(|scope| {
            let digest_task = scope.spawn(|| {
                let digest_started = Instant::now();
                let digested = sorter.digest();
                (digested, digest_started.elapsed().as_millis() as u64)
            });
            let edge_started = Instant::now();
            let built = super::build_graph(
                &mut self.store,
                request,
                Selective {
                    only_slots: if full { None } else { only_slots.as_ref() },
                    previous: if full { None } else { previous.as_ref() },
                    touched_fact_ids: if full { None } else { Some(&touched_fact_ids) },
                    identity: Some(identity_for_build),
                },
            );
            let edge_ms = edge_started.elapsed().as_millis() as u64;
            let (digested, digest_ms) = digest_task.join().map_err(|_| ComposeFailure::Io)?;
            let (fact_digest, spill_bytes) = digested?;
            Ok::<_, ComposeFailure>((fact_digest, spill_bytes, digest_ms, built?, edge_ms))
        })?;
        let output = complete_output(
            &self.store,
            request,
            fact_digest,
            spill_bytes,
            &built,
            ingest_ms,
            digest_ms,
            edge_ms,
            affected,
            parsed_facts,
        )?;
        self.built = Some(built);
        self.identity = Some(identity);
        Ok(output)
    }

    fn parse_fact(&mut self, input: &ResidentFact<'_>) -> Result<Vec<HeldFact>, ComposeFailure> {
        if let Some(bytes) = input.compact {
            let rendered = compose_fact_canonical(bytes).map_err(super::map_compose)?;
            let mut parsed = super::parse_compact_facts(bytes, &mut self.store.intern)?;
            if rendered.len() != parsed.len() {
                return Err(ComposeFailure::Parse);
            }
            if let Some(until) = input.valid_until {
                let interned = self.store.intern.intern(until)?;
                for fact in &mut parsed {
                    fact.valid_until = interned;
                }
            }
            return Ok(rendered
                .into_iter()
                .zip(parsed)
                .map(|(key, fact)| HeldFact { fact, key })
                .collect());
        }
        let Some(json) = input.canonical else {
            return Err(ComposeFailure::Parse);
        };
        let mut fact = super::parse_canonical_fact(json, &mut self.store.intern)?;
        if let Some(until) = input.valid_until {
            fact.valid_until = self.store.intern.intern(until)?;
        }
        Ok(vec![HeldFact {
            fact,
            key: json.to_owned(),
        }])
    }

    fn install_slots(&mut self) {
        let mut slots = Vec::new();
        for id in &self.order {
            let Some(partition) = self.held.get(id) else {
                continue;
            };
            for held in &partition.facts {
                slots.push(Some(held.fact.clone()));
            }
        }
        self.store.slots = slots;
    }

    fn entity_groups(&self) -> HashMap<u32, Vec<Entity>> {
        let mut groups: HashMap<u32, Vec<Entity>> = HashMap::new();
        for id in &self.order {
            let Some(partition) = self.held.get(id) else {
                continue;
            };
            for held in &partition.facts {
                groups
                    .entry(held.fact.subject.id)
                    .or_default()
                    .push(held.fact.subject.clone());
                if let Some(object) = &held.fact.object {
                    groups.entry(object.id).or_default().push(object.clone());
                }
            }
        }
        groups
    }

    fn closure(&self, seeds: &HashSet<u32>) -> (HashSet<u32>, HashSet<u32>) {
        let mut mentioned: HashMap<u32, Vec<u32>> = HashMap::new();
        for (index, slot) in self.store.slots.iter().enumerate() {
            let Some(fact) = slot.as_ref() else {
                continue;
            };
            note_mention(&mut mentioned, &fact.subject, index as u32);
            if let Some(object) = &fact.object {
                note_mention(&mut mentioned, object, index as u32);
            }
        }
        let mut seen_entities = HashSet::new();
        let mut queue: Vec<u32> = seeds.iter().copied().collect();
        let mut slots = HashSet::new();
        let mut fact_ids = HashSet::new();
        while let Some(entity) = queue.pop() {
            if !seen_entities.insert(entity) {
                continue;
            }
            let Some(indexes) = mentioned.get(&entity) else {
                continue;
            };
            for index in indexes {
                if !slots.insert(*index) {
                    continue;
                }
                let Some(fact) = self.store.slots[*index as usize].as_ref() else {
                    continue;
                };
                fact_ids.insert(fact.fact_id);
                enqueue_entities(&mut queue, &fact.subject);
                if let Some(object) = &fact.object {
                    enqueue_entities(&mut queue, object);
                }
            }
        }
        (slots, fact_ids)
    }
}

fn remember_entities(seeds: &mut HashSet<u32>, fact: &Fact) {
    enqueue_entities_set(seeds, &fact.subject);
    if let Some(object) = &fact.object {
        enqueue_entities_set(seeds, object);
    }
}

fn enqueue_entities(queue: &mut Vec<u32>, entity: &Entity) {
    queue.push(entity.id);
    for (alias, _) in &entity.aliases {
        queue.push(*alias);
    }
}

fn enqueue_entities_set(seeds: &mut HashSet<u32>, entity: &Entity) {
    seeds.insert(entity.id);
    for (alias, _) in &entity.aliases {
        seeds.insert(*alias);
    }
}

fn note_mention(mentioned: &mut HashMap<u32, Vec<u32>>, entity: &Entity, index: u32) {
    mentioned.entry(entity.id).or_default().push(index);
    for (alias, _) in &entity.aliases {
        mentioned.entry(*alias).or_default().push(index);
    }
}

fn changed_entities(previous: &Identity, next: &Identity) -> HashSet<u32> {
    let mut changed = HashSet::new();
    let mut ids = HashSet::new();
    ids.extend(previous.resolved.keys().copied());
    ids.extend(next.resolved.keys().copied());
    ids.extend(previous.invalid.iter().copied());
    ids.extend(next.invalid.iter().copied());
    for id in ids {
        let previous_root = previous.resolved.get(&id).copied();
        let next_root = next.resolved.get(&id).copied();
        if previous_root != next_root
            || previous.invalid.contains(&id) != next.invalid.contains(&id)
        {
            changed.insert(id);
            if let Some(root) = previous_root {
                changed.insert(root);
            }
            if let Some(root) = next_root {
                changed.insert(root);
            }
        }
    }
    let previous_by_id = node_fields(previous);
    let next_by_id = node_fields(next);
    let mut node_ids = HashSet::new();
    node_ids.extend(previous_by_id.keys().copied());
    node_ids.extend(next_by_id.keys().copied());
    for id in node_ids {
        if previous_by_id.get(&id) != next_by_id.get(&id) {
            changed.insert(id);
        }
    }
    changed
}

fn node_fields(identity: &Identity) -> HashMap<u32, (u32, u32, u32, Vec<(u32, u32)>)> {
    identity
        .nodes
        .iter()
        .map(|node| {
            (
                node.id,
                (node.scheme, node.kind, node.scope, node.aliases.clone()),
            )
        })
        .collect()
}
