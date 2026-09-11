import yaml from "js-yaml";

export interface ParsedDoc {
  data: Record<string, unknown> | null;
  body: string;
  // --- で囲まれた先頭の領域。読めなかったときも入る。
  head: string;
  // 領域はあるが、対応表として読めない。
  broken: boolean;
}

// 先頭の YAML フロントマター（--- で囲まれた領域）を分離する。
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// 読めても読めなくても、領域は本文から切り離す。
//
// 残すと remark-frontmatter が本文側でも --- を読み飛ばすので、画面から黙って
// 消えてしまい、直す手立てが無くなる。切り離しておけば、読めないことを断って
// 生の字を出せる。
export function parseFrontmatter(text: string): ParsedDoc {
  const m = text.match(FM_RE);
  if (!m) return { data: null, body: text, head: "", broken: false };
  const head = m[0];
  const body = text.slice(head.length);
  let read: unknown;
  try {
    read = yaml.load(m[1]);
  } catch {
    return { data: null, body, head, broken: true };
  }
  if (read === null || read === undefined) return { data: null, body, head, broken: false };
  // 対応表でないもの（裸の字や並び）は、フロントマターとしては読めていない。
  if (typeof read !== "object" || Array.isArray(read))
    return { data: null, body, head, broken: true };
  return { data: read as Record<string, unknown>, body, head, broken: false };
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
