// Function names rules can recognize as performing real client-side
// encryption. A call to one of these wrapping a value that's about to
// be written to browser storage (b03) is treated as sufficient
// mitigation and the write is not flagged.
//
// Keep this list conservative: only add names that are unambiguous
// encryption primitives or well-known library exports. Generic names
// like "save", "store", or "process" do not belong here.
export const KNOWN_ENCRYPTION_HELPERS: ReadonlySet<string> = new Set([
  // Generic primitives
  'encrypt',
  'aesEncrypt',
  'aesGcmEncrypt',
  'gcmEncrypt',
  // libsodium / tweetnacl
  'naclSeal',
  'sealboxSeal',
  'cryptoSecretboxEasy',
  // iron-session / @hapi/iron
  'sealData',
  'seal',
  // jose (JWE)
  'CompactEncrypt',
  'jweEncrypt',
  // Node WebCrypto convenience
  'subtleEncrypt',
]);

// Heuristic prefix match for function names that *suggest* encryption
// without being on the curated list above. Treated as a soft signal:
// a wrapped storage write whose wrapper matches this pattern is not
// fully suppressed but is downgraded from `high` to `medium` and
// flagged as "encryption claimed but cannot be verified statically".
//
// Anchored to the start so that names like `securityCheck` (prefix
// `securit`, not `secure`) do not match accidentally. The trailing
// alternation requires the trigger word to be a complete prefix
// (followed by an uppercase letter, underscore, or end-of-name) rather
// than the start of an unrelated longer word.
export const HEURISTIC_ENCRYPTION_NAME_RE =
  /^(secure|encrypt|encrypted|seal|sealed|cipher|ciphered)([A-Z_]|$)/;
