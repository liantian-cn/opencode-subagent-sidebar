import stringWidth from "string-width"

const segments = new Intl.Segmenter("zh", { granularity: "grapheme" })
export const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim()
export function truncate(value: string, columns: number): string {
  columns = Math.max(0, Math.floor(columns))
  value = clean(value)
  if (stringWidth(value) <= columns) return value
  if (columns === 0) return ""
  let result = ""
  for (const { segment } of segments.segment(value)) {
    if (stringWidth(result + segment) > columns - 1) break
    result += segment
  }
  return result + "…"
}
