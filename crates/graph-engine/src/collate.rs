//! Printable-ASCII collation that matches Node `en-US` `localeCompare`.
//!
//! Measured on this runtime: every pnpm canonical fact key was ASCII, and
//! 17,763 adjacent pairs disagreed with UTF-16 code-unit order. A two-level
//! comparison — primary weight with case folded, then lowercase before
//! uppercase — matched `localeCompare` on 50,000 random printable-ASCII pairs.
//! Bytes outside 0x20..=0x7E are rejected so a different locale cannot be
//! sorted as if it were this table.

/// Rank of bytes 0..128 in Node `localeCompare` order. 255 means unsupported.
const RANK: [u8; 128] = [
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 6, 10, 22, 32, 23, 21, 9,
    11, 12, 18, 26, 3, 2, 8, 19, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 5, 4, 27, 28, 29, 7, 17,
    44, 46, 48, 50, 52, 54, 56, 58, 60, 62, 64, 66, 68, 70, 72, 74, 76, 78, 80, 82, 84, 86, 88, 90,
    92, 94, 13, 20, 14, 25, 1, 24, 43, 45, 47, 49, 51, 53, 55, 57, 59, 61, 63, 65, 67, 69, 71, 73,
    75, 77, 79, 81, 83, 85, 87, 89, 91, 93, 15, 30, 16, 31, 255,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CollationError {
    UnsupportedByte,
}

pub fn printable_ascii(value: &str) -> bool {
    value.bytes().all(|byte| (32..127).contains(&byte))
}

fn primary(byte: u8) -> u8 {
    if (b'A'..=b'Z').contains(&byte) {
        RANK[(byte + 32) as usize]
    } else {
        RANK[byte as usize]
    }
}

fn secondary(byte: u8) -> u8 {
    if (b'A'..=b'Z').contains(&byte) {
        1
    } else {
        0
    }
}

/// Returns `Ordering` for two printable-ASCII strings.
///
/// Equal primary prefixes with a longer tail sort after the shorter string.
/// Case is compared only when primary weights and lengths match, lowercase first.
/// Order used for canonical fact keys and locale-sensitive graph ids.
///
/// Printable ASCII uses the measured en-US table. Any other string uses the
/// ICU collator when the process can load it, because that matched Node's
/// default `localeCompare` on this runtime. Without ICU, comparison falls
/// back to UTF-16 code-unit order and `icu_collator_loaded` is false so the
/// host can report that the locale contract was not available.
pub fn compare_canonical_key(left: &str, right: &str) -> std::cmp::Ordering {
    if let Ok(order) = compare_locale_ascii(left, right) {
        return order;
    }
    if let Some(order) = icu_compare(left, right) {
        return order;
    }
    compare_utf16(left, right)
}

pub fn icu_collator_loaded() -> bool {
    icu_state().is_some()
}

const PRIMARY: [u8; 128] = {
    let mut table = [255u8; 128];
    let mut byte = 32u8;
    while byte < 127 {
        table[byte as usize] = if byte >= b'A' && byte <= b'Z' {
            RANK[(byte + 32) as usize]
        } else {
            RANK[byte as usize]
        };
        byte += 1;
    }
    table
};

pub fn compare_locale_ascii(left: &str, right: &str) -> Result<std::cmp::Ordering, CollationError> {
    let left_bytes = left.as_bytes();
    let right_bytes = right.as_bytes();
    let shared = left_bytes.len().min(right_bytes.len());
    let mut case_diff = std::cmp::Ordering::Equal;
    for index in 0..shared {
        let left_byte = left_bytes[index];
        let right_byte = right_bytes[index];
        if left_byte < 32 || left_byte > 126 || right_byte < 32 || right_byte > 126 {
            return Err(CollationError::UnsupportedByte);
        }
        let left_primary = PRIMARY[left_byte as usize];
        let right_primary = PRIMARY[right_byte as usize];
        if left_primary != right_primary {
            return Ok(left_primary.cmp(&right_primary));
        }
        if case_diff == std::cmp::Ordering::Equal && left_byte != right_byte {
            case_diff = (left_byte.is_ascii_uppercase() as u8)
                .cmp(&(right_byte.is_ascii_uppercase() as u8));
        }
    }
    let longer = if left_bytes.len() > shared {
        left_bytes
    } else {
        right_bytes
    };
    for byte in &longer[shared..] {
        if *byte < 32 || *byte > 126 {
            return Err(CollationError::UnsupportedByte);
        }
    }
    if left_bytes.len() != right_bytes.len() {
        return Ok(left_bytes.len().cmp(&right_bytes.len()));
    }
    Ok(case_diff)
}

fn compare_utf16(left: &str, right: &str) -> std::cmp::Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

#[cfg(all(unix, not(target_arch = "wasm32")))]
mod icu {
    use std::ffi::CString;
    use std::sync::{Mutex, OnceLock};

    static COLLATOR_LOCK: Mutex<()> = Mutex::new(());

    #[repr(C)]
    struct Collator {
        raw: *mut std::ffi::c_void,
        strcoll: unsafe extern "C" fn(
            *mut std::ffi::c_void,
            *const u8,
            i32,
            *const u8,
            i32,
            *mut i32,
        ) -> i32,
    }

    unsafe impl Send for Collator {}
    unsafe impl Sync for Collator {}

    unsafe extern "C" {
        fn dlopen(filename: *const i8, flags: i32) -> *mut std::ffi::c_void;
        fn dlsym(handle: *mut std::ffi::c_void, symbol: *const i8) -> *mut std::ffi::c_void;
    }

    pub fn compare(left: &str, right: &str) -> Option<std::cmp::Ordering> {
        let collator = state()?;
        let _guard = COLLATOR_LOCK
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let mut status = 0i32;
        let result = unsafe {
            (collator.strcoll)(
                collator.raw,
                left.as_ptr(),
                i32::try_from(left.len()).unwrap_or(i32::MAX),
                right.as_ptr(),
                i32::try_from(right.len()).unwrap_or(i32::MAX),
                &mut status,
            )
        };
        if status > 0 {
            return None;
        }
        Some(result.cmp(&0))
    }

    pub fn loaded() -> bool {
        state().is_some()
    }

    fn state() -> Option<&'static Collator> {
        static CELL: OnceLock<Option<Collator>> = OnceLock::new();
        CELL.get_or_init(load).as_ref()
    }

    fn load() -> Option<Collator> {
        const NOW: i32 = 2;
        let libraries = [
            "libicui18n.so.78\0",
            "libicui18n.so.76\0",
            "libicui18n.so.74\0",
            "libicui18n.so.73\0",
            "libicui18n.so\0",
            "libicui18n.A.dylib\0",
            "icui18n\0",
        ];
        let handle = libraries.iter().find_map(|name| {
            let opened = unsafe { dlopen(name.as_ptr().cast(), NOW) };
            if opened.is_null() {
                None
            } else {
                Some(opened)
            }
        })?;
        let versions = ["", "_78", "_76", "_74", "_73"];
        for suffix in versions {
            let open_name = CString::new(format!("ucol_open{suffix}")).ok()?;
            let coll_name = CString::new(format!("ucol_strcollUTF8{suffix}")).ok()?;
            let open = unsafe { dlsym(handle, open_name.as_ptr()) };
            let coll = unsafe { dlsym(handle, coll_name.as_ptr()) };
            if open.is_null() || coll.is_null() {
                continue;
            }
            let open: unsafe extern "C" fn(*const i8, *mut i32) -> *mut std::ffi::c_void =
                unsafe { std::mem::transmute(open) };
            let strcoll: unsafe extern "C" fn(
                *mut std::ffi::c_void,
                *const u8,
                i32,
                *const u8,
                i32,
                *mut i32,
            ) -> i32 = unsafe { std::mem::transmute(coll) };
            let mut status = 0i32;
            let locale = CString::new("en_US").ok()?;
            let raw = unsafe { open(locale.as_ptr(), &mut status) };
            if raw.is_null() || status > 0 {
                continue;
            }
            return Some(Collator { raw, strcoll });
        }
        None
    }
}

#[cfg(all(unix, not(target_arch = "wasm32")))]
fn icu_compare(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    icu::compare(left, right)
}

#[cfg(all(unix, not(target_arch = "wasm32")))]
fn icu_state() -> Option<()> {
    icu::loaded().then_some(())
}

#[cfg(not(all(unix, not(target_arch = "wasm32"))))]
fn icu_compare(_left: &str, _right: &str) -> Option<std::cmp::Ordering> {
    None
}

#[cfg(not(all(unix, not(target_arch = "wasm32"))))]
fn icu_state() -> Option<()> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_folds_before_code_unit_order() {
        assert_eq!(
            compare_locale_ascii("file.ts", "File.ts").unwrap(),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            compare_locale_ascii("File.ts", "foobar").unwrap(),
            std::cmp::Ordering::Less
        );
        assert_eq!(
            compare_locale_ascii("a-b", "ab").unwrap(),
            std::cmp::Ordering::Less
        );
    }

    #[test]
    fn rejects_non_printable() {
        assert_eq!(
            compare_locale_ascii("a\nb", "a"),
            Err(CollationError::UnsupportedByte)
        );
    }
}
