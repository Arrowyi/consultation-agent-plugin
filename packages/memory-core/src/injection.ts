export type InjectionCategory = "override_instructions" | "impersonate_system" | "exfiltrate_data" | "execute_commands"

export type InjectionFinding = { readonly category: InjectionCategory; readonly matched: string; readonly index: number }

const patterns: readonly { readonly category: InjectionCategory; readonly expression: RegExp }[] = [
  { category: "override_instructions", expression: /ignore (all |any )?(previous|prior|above) instructions/i },
  { category: "impersonate_system", expression: /you are now|system prompt|reveal (your|the) (prompt|instructions)/i },
  { category: "exfiltrate_data", expression: /(send|post|exfiltrate).{0,50}(to|at) https?:/i },
  { category: "execute_commands", expression: /\b(run|execute)\b.{0,40}\b(command|shell|bash|rm -rf)/i },
]

export function detectInjection(text: string): InjectionFinding[] {
  return patterns.flatMap(({ category, expression }) => findMatches(text, category, expression))
}

function findMatches(text: string, category: InjectionCategory, expression: RegExp): InjectionFinding[] {
  const flags = expression.flags.includes("g") ? expression.flags : `${expression.flags}g`
  return [...text.matchAll(new RegExp(expression.source, flags))].map((match) => ({
    category,
    matched: match[0],
    index: match.index,
  }))
}
