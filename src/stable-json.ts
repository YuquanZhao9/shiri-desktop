// 云端（Postgres jsonb）返回的对象字段顺序和本机不同，直接比 JSON.stringify 会把同样的内容当成“改过”。
// 这里按字段名排好序再比，只看内容。

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key] = canonical(item);
    }
    return result;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

export function sameContent(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}
