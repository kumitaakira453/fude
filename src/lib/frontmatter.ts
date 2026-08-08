import yaml from "js-yaml";

export interface ParsedDoc {
  data: Record<string, unknown> | null;
  body: string;
}

// 先頭の YAML フロントマター（--- で囲まれた領域）を分離する。
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(text: string): ParsedDoc {
  const m = text.match(FM_RE);
  if (!m) return { data: null, body: text };
  try {
    const data = yaml.load(m[1]) as Record<string, unknown> | null;
    return { data: data ?? null, body: text.slice(m[0].length) };
  } catch {
    return { data: null, body: text };
  }
}

// フロントマターから表示用のタイトル・タグを取り出す。
export function extractMeta(data: Record<string, unknown> | null): {
  title?: string;
  tags: string[];
} {
  if (!data) return { tags: [] };
  const title = typeof data.title === "string" ? data.title : undefined;
  let tags: string[] = [];
  const raw = data.tags ?? data.tag;
  if (Array.isArray(raw)) tags = raw.map(String);
  else if (typeof raw === "string") tags = raw.split(/[,\s]+/).filter(Boolean);
  return { title, tags };
}
