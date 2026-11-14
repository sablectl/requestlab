// Terminal safety for human-readable output.
//
// URLs, header names, header values, status texts and body previews all come
// from the server under test, which is exactly the thing that cannot be
// trusted. A header value of `\u001b[2K\rIDENTICAL` would otherwise rewrite
// the line above it in a terminal and fake a clean comparison, so every
// untrusted string is escaped before it is printed.
//
// Human output only. JSON output is already safe because JSON encoding
// escapes control characters, and escaping there would corrupt the data.

/** Replaces control characters with visible `\xNN` / `\uNNNN` escapes. */
export function escapeControlCharacters(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
      continue;
    }
    // C1 controls and the bidirectional overrides used for spoofing.
    if ((code >= 0x80 && code <= 0x9f) || (code >= 0x202a && code <= 0x202e)) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    out += char;
  }
  return out;
}
