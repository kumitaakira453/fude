import type { Workspace } from "./workspaces";

// 左端の帯に並べるワークスペースの、まとまりと順。
//
// まとまりはフォルダごと。フォルダを複数持つワークスペースは、.claude（設定や
// 記憶の置き場）を除いた最初のフォルダのまとまりに入れる。まとまりの順も、
// まとまりの中の順も、ワークスペースの列（barAtom）の順に従う。⌘1〜9 は、
// 帯に見えている上からの順を指す。

const isClaudeDir = (path: string): boolean => /(^|\/)\.claude(\/|$)/.test(path);

export function groupKeyOf(ws: Workspace): string {
  const candidates = [ws.folder, ...ws.roots].filter((p): p is string => !!p);
  return candidates.find((p) => !isClaudeDir(p)) ?? candidates[0] ?? "";
}

const baseName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

export interface RailGroup {
  key: string;
  label: string;
  items: Workspace[];
}

export function railGroups(bar: readonly string[], list: readonly Workspace[]): RailGroup[] {
  const byId = new Map(list.map((w) => [w.id, w]));
  const groups = new Map<string, RailGroup>();
  for (const id of bar) {
    const ws = byId.get(id);
    if (!ws) continue;
    const key = groupKeyOf(ws);
    const group = groups.get(key) ?? { key, label: baseName(key), items: [] };
    group.items.push(ws);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// 帯に見えている上からの順（⌘1〜9 の行き先）。
export function railOrder(bar: readonly string[], list: readonly Workspace[]): string[] {
  return railGroups(bar, list).flatMap((g) => g.items.map((w) => w.id));
}

// 札に出す 1 字。名前の頭の [V] のような印は飛ばす。
export function initialOf(name: string): string {
  const rest = name.replace(/^\s*\[[^\]]*\]\s*/, "").trim() || name.trim();
  return [...rest][0] ?? "?";
}

// ほかのフォルダの数（「monorepo ＋2」の ＋2）。
export function otherRoots(ws: Workspace): number {
  return Math.max(0, ws.roots.length - 1);
}
