// 自动生成：npm run compile；请修改 src 中的源码。
import stringWidth from "string-width";
const segments = new Intl.Segmenter("zh", {
  granularity: "grapheme"
});
export const clean = value => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
export function truncate(value, columns) {
  columns = Math.max(0, Math.floor(columns));
  value = clean(value);
  if (stringWidth(value) <= columns) return value;
  if (columns === 0) return "";
  let result = "";
  for (const {
    segment
  } of segments.segment(value)) {
    if (stringWidth(result + segment) > columns - 1) break;
    result += segment;
  }
  return result + "…";
}
export function duration(row, now) {
  if (row.started === undefined) return "—";
  const seconds = Math.floor(Math.max(0, (row.ended ?? now) - row.started) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m`;
}
export function lines(row, columns, now) {
  const prefix = `${row.status} #${row.number}${row.parent ? ` ←#${row.parent}` : ""}`;
  const first = truncate(`${prefix} ${row.summary}`, columns);
  const time = duration(row, now);
  const available = columns - stringWidth(time) - 1;
  const detail = truncate(`${row.agent} · ${row.model}`, available);
  return [first, available < 1 ? truncate(time, columns) : `${detail}${" ".repeat(Math.max(1, columns - stringWidth(detail) - stringWidth(time)))}${time}`];
}
