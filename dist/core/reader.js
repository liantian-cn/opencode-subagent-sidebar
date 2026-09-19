// 自动生成：npm run compile；请修改 src 中的源码。
export async function pages(read, signal) {
  const result = [];
  const seen = new Set();
  let cursor;
  do {
    signal.throwIfAborted();
    const page = await read(cursor);
    signal.throwIfAborted();
    result.push(...page.data);
    cursor = page.next || undefined;
    if (cursor && seen.has(cursor)) throw new Error("分页游标重复");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}
export async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({
    length: Math.min(limit, items.length)
  }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await fn(items[index]);
    }
  }));
  return output;
}
export async function root(source, id, signal) {
  const seen = new Set();
  while (true) {
    signal.throwIfAborted();
    if (seen.has(id)) throw new Error("会话祖先形成环");
    seen.add(id);
    const info = await source.get(id, signal);
    if (!info.parentID) return info;
    id = info.parentID;
  }
}
export async function readTree(source, ancestor, signal, discover = () => {}) {
  signal.throwIfAborted();
  discover(ancestor);
  const all = new Map([[ancestor.id, ancestor]]);
  let level = [ancestor];
  while (level.length) {
    const children = await mapLimit(level, 4, info => pages(cursor => source.children(info.id, cursor, signal), signal));
    level = [];
    for (const child of children.flat()) {
      if (all.has(child.id)) continue;
      all.set(child.id, child);
      discover(child);
      level.push(child);
    }
  }
  const active = await source.active(signal);
  return mapLimit([...all.values()], 4, info => source.snapshot(info, active.has(info.id), signal));
}
