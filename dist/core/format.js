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
