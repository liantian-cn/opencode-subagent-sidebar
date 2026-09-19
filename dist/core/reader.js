// 自动生成：npm run compile；请修改 src 中的源码。
import { MissingSession } from "./types.js";
export class FullReadError extends Error {}
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
export async function readTree(source, ancestor, signal, discover = () => {}, missing = () => {}, known = []) {
  const scope = new AbortController();
  try {
    return await scanTree(source, ancestor, AbortSignal.any([signal, scope.signal]), discover, missing, known);
  } finally {
    scope.abort();
  }
}
async function scanTree(source, ancestor, signal, discover, missing, known) {
  signal.throwIfAborted();
  discover(ancestor);
  const all = new Map([[ancestor.id, ancestor]]);
  const removed = new Set();
  const previous = new Map(known.map(info => [info.id, info]));
  const gone = info => {
    const seen = new Set();
    let current = info;
    while (current && !seen.has(current.id)) {
      if (removed.has(current.id)) return true;
      seen.add(current.id);
      current = current.parentID ? all.get(current.parentID) ?? previous.get(current.parentID) : undefined;
    }
    return false;
  };
  const read = async (info, fn) => {
    signal.throwIfAborted();
    try {
      return await fn();
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof MissingSession) || error.sessionID !== info.id || info.id === ancestor.id) throw error;
      removed.add(info.id);
      missing(info.id);
    }
  };
  let level = [ancestor];
  while (true) {
    if (!level.length) {
      // 枚举未返回已知节点不等于删除；沿已知父级补查，确认证据或明确墓碑。
      const omitted = known.filter(info => !all.has(info.id) && !gone(info) && !!info.parentID && all.has(info.parentID));
      if (!omitted.length) break;
      const recovered = await mapLimit(omitted, 4, info => read(info, () => source.get(info.id, signal)));
      signal.throwIfAborted();
      for (const info of recovered) {
        if (!info || gone(info)) continue;
        if (!info.parentID || !all.has(info.parentID)) throw new Error("已知子树父级发生变化");
        all.set(info.id, info);
        discover(info);
        level.push(info);
      }
      if (!level.length) break;
    }
    const children = await mapLimit(level, 4, info => read(info, () => pages(cursor => source.children(info.id, cursor, signal), signal)));
    signal.throwIfAborted();
    level = [];
    for (const child of children.flat()) {
      if (!child || all.has(child.id) || gone(child)) continue;
      all.set(child.id, child);
      discover(child);
      level.push(child);
    }
  }
  const active = await source.active(signal).catch(error => {
    throw new FullReadError("无法读取全局运行状态", {
      cause: error
    });
  });
  signal.throwIfAborted();
  const snapshots = await mapLimit([...all.values()].filter(info => !gone(info)), 4, info => read(info, () => source.snapshot(info, active.has(info.id), signal)));
  signal.throwIfAborted();
  return snapshots.filter(snapshot => !!snapshot && !gone(snapshot.info));
}
