//! Native fact-set session.
//!
//! Framed binary stdin, one response frame on stdout. Canonical strings are
//! not written back. A non-printable key, a compact-fact rejection, or a
//! memory limit returns a failed status so the host can fall back visibly.

use std::io::{self, Read, Write};
use std::process::exit;

use workspai_graph_engine::{FactSet, FactSetError};

const KIND_CANONICAL: u8 = 1;
const KIND_COMPACT: u8 = 2;
const KIND_FINISH: u8 = 3;

const STATUS_COMPLETE: u32 = 0;
const STATUS_REJECTED: u32 = 1;

fn main() {
    let code = match run() {
        Ok(()) => 0,
        Err(()) => 1,
    };
    exit(code);
}

fn run() -> Result<(), ()> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut set = FactSet::new();
    loop {
        let length = match read_u32(&mut input) {
            Ok(value) => value,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(_) => return write_status(STATUS_REJECTED, 1, &set),
        };
        if length == 0 || length > 32 * 1024 * 1024 {
            return write_status(STATUS_REJECTED, 2, &set);
        }
        let mut payload = vec![0u8; length as usize];
        if input.read_exact(&mut payload).is_err() {
            return write_status(STATUS_REJECTED, 3, &set);
        }
        let kind = payload[0];
        let body = &payload[1..];
        match kind {
            KIND_CANONICAL => {
                if let Err(error) = push_canonical(&mut set, body) {
                    return write_error(error, &set);
                }
            }
            KIND_COMPACT => {
                if let Err(error) = push_compact(&mut set, body) {
                    return write_error(error, &set);
                }
            }
            KIND_FINISH => {
                let bytes = set.canonical_bytes();
                let count = set.len();
                let digest = match set.digest_hex() {
                    Ok(value) => value,
                    Err(error) => return write_error(error, &FactSet::new()),
                };
                return write_complete(&digest, count, bytes, peak_rss_bytes());
            }
            _ => return write_status(STATUS_REJECTED, 4, &set),
        }
    }
    write_status(STATUS_REJECTED, 5, &set)
}

fn push_canonical(set: &mut FactSet, mut body: &[u8]) -> Result<(), FactSetError> {
    while !body.is_empty() {
        if body.len() < 8 {
            return Err(FactSetError::Index);
        }
        let index = u32::from_le_bytes(body[0..4].try_into().unwrap());
        let length = u32::from_le_bytes(body[4..8].try_into().unwrap()) as usize;
        body = &body[8..];
        if body.len() < length {
            return Err(FactSetError::Index);
        }
        let text = std::str::from_utf8(&body[..length]).map_err(|_| FactSetError::Index)?;
        set.push_canonical(index, text.to_string())?;
        body = &body[length..];
    }
    Ok(())
}

fn push_compact(set: &mut FactSet, body: &[u8]) -> Result<(), FactSetError> {
    if body.len() < 4 {
        return Err(FactSetError::Index);
    }
    let base = u32::from_le_bytes(body[0..4].try_into().unwrap());
    set.push_compact_batch(base, &body[4..])?;
    Ok(())
}

fn write_error(error: FactSetError, set: &FactSet) -> Result<(), ()> {
    let code = match error {
        FactSetError::Collation(_) => 10,
        FactSetError::Compose(_) => 11,
        FactSetError::Limit => 12,
        FactSetError::Index => 13,
    };
    write_status(STATUS_REJECTED, code, set)
}

fn write_complete(digest: &str, count: usize, bytes: usize, rss_bytes: u64) -> Result<(), ()> {
    let mut payload = Vec::with_capacity(4 + 4 + 64 + 8 + 8 + 8);
    payload.extend_from_slice(&STATUS_COMPLETE.to_le_bytes());
    payload.extend_from_slice(&0u32.to_le_bytes());
    payload.extend_from_slice(digest.as_bytes());
    payload.extend_from_slice(&(count as u64).to_le_bytes());
    payload.extend_from_slice(&(bytes as u64).to_le_bytes());
    payload.extend_from_slice(&rss_bytes.to_le_bytes());
    write_frame(&payload)
}

fn write_status(status: u32, code: u32, set: &FactSet) -> Result<(), ()> {
    let mut payload = Vec::with_capacity(4 + 4 + 64 + 8 + 8);
    payload.extend_from_slice(&status.to_le_bytes());
    payload.extend_from_slice(&code.to_le_bytes());
    payload.extend_from_slice(&[b'0'; 64]);
    payload.extend_from_slice(&(set.len() as u64).to_le_bytes());
    payload.extend_from_slice(&(set.canonical_bytes() as u64).to_le_bytes());
    payload.extend_from_slice(&peak_rss_bytes().to_le_bytes());
    write_frame(&payload)
}

fn peak_rss_bytes() -> u64 {
    let Ok(text) = std::fs::read_to_string("/proc/self/status") else {
        return 0;
    };
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("VmHWM:") else {
            continue;
        };
        let Some(kb) = rest.split_whitespace().next() else {
            return 0;
        };
        return kb.parse::<u64>().unwrap_or(0).saturating_mul(1024);
    }
    0
}

fn write_frame(payload: &[u8]) -> Result<(), ()> {
    let mut stdout = io::stdout().lock();
    let length = u32::try_from(payload.len()).map_err(|_| ())?;
    stdout.write_all(&length.to_le_bytes()).map_err(|_| ())?;
    stdout.write_all(payload).map_err(|_| ())?;
    stdout.flush().map_err(|_| ())
}

fn read_u32(input: &mut impl Read) -> io::Result<u32> {
    let mut bytes = [0u8; 4];
    input.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}
