// Only export-list/star declarations can re-export a module. Matching arbitrary
// export bodies makes declaration-heavy files repeatedly scan later source.
// matchAll clones this expression, so callers do not share mutable cursors.
export const ECMASCRIPT_STATIC_IMPORT_PATTERN =
  /^[^\S\r\n]*(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*)?|\{[^}]*\})\s+from\s+)['"]([^'"\r\n]+)['"]/gmu;
