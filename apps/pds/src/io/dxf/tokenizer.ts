/**
 * DXF ASCII group-code tokenizer.
 *
 * ASCII DXF is a flat stream of (group code, value) pairs, one per line: the
 * code on one line, its value on the next. Every higher-level structure in a
 * DXF file — sections, blocks, entities — is just a convention for how those
 * pairs are arranged, starting with group code 0 marking the start of a new
 * "thing." This module only does the flat tokenisation; `import.ts` is where
 * the pairs turn into sections, blocks and entities.
 *
 * Deliberately ignorant of what any code *means* — a code's value is read as
 * a trimmed string here regardless of whether the caller will parse it as a
 * number, and it is up to whoever asked for group 10 to know that group 10
 * is a coordinate. That keeps this file usable for any DXF content, not just
 * the apparel profile the rest of `io/dxf` targets.
 */

const LINE_BREAK = /\r\n|\r|\n/;

export interface DxfToken {
  readonly code: number;
  readonly value: string;
  /** 1-based line number of the code (not the value), for error messages. */
  readonly line: number;
}

/**
 * Splits an ASCII DXF payload into group-code/value pairs.
 *
 * Throws a plain `Error` (not `FormatParseError`) on malformed input — the
 * flavour label that error needs to carry lives with the caller, not here.
 * `import.ts` wraps every call into this module in one try/catch so a raw
 * tokeniser error never reaches a user unlabelled.
 */
export const tokenizeDxf = (payload: string): readonly DxfToken[] => {
  // Trailing blank lines (a final newline, or several) are normal EOF
  // padding, not a missing value — trimmed once here so the pairing loop
  // below never has to special-case them.
  const lines = payload.replace(/\s+$/, '').split(LINE_BREAK);

  if (lines.length % 2 !== 0) {
    throw new Error(
      `odd number of content lines (${lines.length}) — a group code near the end of the file is missing its value`,
    );
  }

  const tokens: DxfToken[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeLine = (lines[i] ?? '').trim();
    const code = Number(codeLine);
    if (codeLine === '' || !Number.isInteger(code)) {
      throw new Error(`expected a group code at line ${i + 1}, found "${lines[i] ?? ''}"`);
    }
    tokens.push({ code, value: (lines[i + 1] ?? '').trim(), line: i + 1 });
  }
  return tokens;
};

/** Parses a token's value as a float, or throws with the token's line number in the message. */
export const tokenNumber = (token: DxfToken): number => {
  const n = Number(token.value);
  if (!Number.isFinite(n)) {
    throw new Error(`line ${token.line}: group ${token.code} value "${token.value}" is not a number`);
  }
  return n;
};
