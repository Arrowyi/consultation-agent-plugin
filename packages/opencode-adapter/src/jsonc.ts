/**
 * Strip JSONC comments (`//` line and `/* *​/` block) and trailing commas
 * from a JSONC text so it can be parsed by `JSON.parse`.
 *
 * String contents are preserved: comment-like sequences inside string
 * values are not stripped. Comments are removed first, then trailing
 * commas are removed from the comment-free text, so a comma separated
 * from its closing brace by a comment is still caught.
 */
export function stripJsonc(text: string): string {
  return stripTrailingCommas(stripComments(text))
}

function stripComments(text: string): string {
  let result = ""
  let i = 0
  let inString = false

  while (i < text.length) {
    const ch = text[i]

    if (inString) {
      result += ch
      if (ch === "\\") {
        if (i + 1 < text.length) {
          result += text[i + 1]
          i += 2
          continue
        }
      }
      if (ch === '"') {
        inString = false
      }
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      result += ch
      i++
      continue
    }

    if (ch === "/" && i + 1 < text.length && text[i + 1] === "/") {
      i += 2
      while (i < text.length && text[i] !== "\n") i++
      continue
    }

    if (ch === "/" && i + 1 < text.length && text[i + 1] === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && i + 1 < text.length && text[i + 1] === "/")) {
        i++
      }
      i += 2
      continue
    }

    result += ch
    i++
  }

  return result
}

function stripTrailingCommas(text: string): string {
  let result = ""
  let i = 0
  let inString = false

  while (i < text.length) {
    const ch = text[i]

    if (inString) {
      result += ch
      if (ch === "\\") {
        if (i + 1 < text.length) {
          result += text[i + 1]
          i += 2
          continue
        }
      }
      if (ch === '"') {
        inString = false
      }
      i++
      continue
    }

    if (ch === '"') {
      inString = true
      result += ch
      i++
      continue
    }

    if (ch === ",") {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j] ?? "")) j++
      if (j < text.length && (text[j] === "}" || text[j] === "]")) {
        i++
        continue
      }
    }

    result += ch
    i++
  }

  return result
}
