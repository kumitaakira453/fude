import { invoke } from "@tauri-apps/api/core";
import type { StoredNode } from "./ui";

// ワークスペース。並べるフォルダ（根）と、そのタブの並び・木の開閉を 1 組に
// して名前を付けたもの。窓 1 枚が 1 つを開き、すぐ別のものへ切り替えられる。
//
// 控えは Rust が 1 つ 1 ファイルで置く（Dock のメニューと起動し直したときの
// 復元が読む）。中身を決めるのはこちら。

export interface ClaudeLink {
  sessionId: string;
  // セッションの名前が変わったら、ワークスペースの名前も変えるか。
  // 自分で名前を付け直したら追うのをやめる。
  nameFollows: boolean;
  // 最後に分かっていたセッションの名前。読めないときはこれを出す。
  lastName?: string;
  // 会話の記録の場所。一覧から外れたあと、消されたのかを確かめるのに使う。
  transcript?: string;
  // そのセッションが書いたファイル（絶対パス）と、書いた時刻（ms）。
  wrote?: { path: string; at: number }[];
  // fude の中で動かした（名前を変えた・移した）「元 → 先」。古い順。セッションの
  // 記録は書いたときの道筋のままなので、読み直すたびにこれを当てて今の場所へ寄せる。
  moved?: [string, string][];
}

export interface Workspace {
  id: string;
  name: string;
  color: WorkspaceColor;
  roots: string[];
  lastOpened: number;
  layout?: StoredNode;
  active?: string;
  expanded?: string[];
  // フォルダを開いてできたもの。そのフォルダを開くと、ここへ来る。
  folder?: string;
  claude?: ClaudeLink;
}

// 色。名前を読まなくても、どこにいるかが分かるように付ける。値は CSS 側
// （--mg-ws-<名前>）が明暗それぞれで持つ。
export const WORKSPACE_COLORS = [
  "teal",
  "sky",
  "violet",
  "rose",
  "amber",
  "lime",
  "indigo",
  "slate",
] as const;
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

export const colorVar = (color: WorkspaceColor): string => `var(--mg-ws-${color})`;

// まだ使われていない色。全部使われていれば、使われている数がいちばん少ないもの。
export function freeColor(list: readonly Workspace[]): WorkspaceColor {
  const used = new Map<WorkspaceColor, number>();
  for (const ws of list) used.set(ws.color, (used.get(ws.color) ?? 0) + 1);
  let best: WorkspaceColor = WORKSPACE_COLORS[0];
  let fewest = Infinity;
  for (const color of WORKSPACE_COLORS) {
    const n = used.get(color) ?? 0;
    if (n < fewest) {
      best = color;
      fewest = n;
    }
  }
  return best;
}

// ID はファイル名になる（Rust 側で小文字・数字・ハイフンに絞っている）。
export function newWorkspaceId(now: number, rand: () => number = Math.random): string {
  const tail = Math.floor(rand() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `ws-${now.toString(36)}-${tail}`;
}

// 読めた控えだけを通す。古い形・壊れた形で画面が落ちないように。
export function asWorkspace(value: unknown): Workspace | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.name !== "string") return null;
  if (!Array.isArray(v.roots) || !v.roots.every((r) => typeof r === "string")) return null;
  if (v.roots.length === 0) return null;
  const color = WORKSPACE_COLORS.includes(v.color as WorkspaceColor)
    ? (v.color as WorkspaceColor)
    : WORKSPACE_COLORS[0];
  const strings = (x: unknown): string[] | undefined =>
    Array.isArray(x) && x.every((s) => typeof s === "string") ? x : undefined;
  const claude = v.claude as Record<string, unknown> | undefined;
  return {
    id: v.id,
    name: v.name,
    color,
    roots: v.roots,
    lastOpened: typeof v.lastOpened === "number" ? v.lastOpened : 0,
    layout: v.layout && typeof v.layout === "object" ? (v.layout as StoredNode) : undefined,
    active: typeof v.active === "string" ? v.active : undefined,
    expanded: strings(v.expanded),
    folder: typeof v.folder === "string" ? v.folder : undefined,
    claude:
      claude && typeof claude.sessionId === "string"
        ? {
            sessionId: claude.sessionId,
            nameFollows: claude.nameFollows !== false,
            lastName: typeof claude.lastName === "string" ? claude.lastName : undefined,
            transcript: typeof claude.transcript === "string" ? claude.transcript : undefined,
            wrote: Array.isArray(claude.wrote)
              ? claude.wrote.filter(
                  (w): w is { path: string; at: number } =>
                    !!w &&
                    typeof (w as { path?: unknown }).path === "string" &&
                    typeof (w as { at?: unknown }).at === "number",
                )
              : undefined,
            moved: Array.isArray(claude.moved)
              ? claude.moved.filter(
                  (m): m is [string, string] =>
                    Array.isArray(m) &&
                    m.length === 2 &&
                    typeof m[0] === "string" &&
                    typeof m[1] === "string",
                )
              : undefined,
          }
        : undefined,
  };
}

// 名前が既にあるものと重なるなら番号を付ける（「monorepo-docs 2」）。
export function uniqueName(base: string, taken: readonly string[]): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name)) return name;
  }
}

// 根の並びを人に見せる形に。「monorepo-docs ほか 2」。
export function rootsSummary(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names[0]} ほか ${names.length - 1}`;
}

// ---- Rust とのやり取り ----

export async function listWorkspaces(): Promise<Workspace[]> {
  const raw = await invoke<unknown[]>("list_workspaces");
  return raw.map(asWorkspace).filter((ws): ws is Workspace => ws !== null);
}

export async function saveWorkspace(ws: Workspace): Promise<void> {
  await invoke("save_workspace", { workspace: ws });
}

export async function deleteWorkspace(id: string): Promise<void> {
  await invoke("delete_workspace", { id });
}

export async function bindWindow(label: string, workspace: string | null): Promise<void> {
  await invoke("bind_window", { label, workspace });
}

// そのワークスペースを開いている別の窓を前に出す。出したら true。
export async function focusWorkspace(workspace: string, except: string): Promise<boolean> {
  return invoke<boolean>("focus_workspace", { workspace, except });
}

// いま開いている窓とそのワークスペース（窓の名前, ID）。
export async function liveWorkspaces(): Promise<[string, string][]> {
  return invoke<[string, string][]>("live_workspaces");
}

// 起動し直したとき、終了したときに開いていた窓（窓の名前とワークスペース）。
export async function takeRestore(): Promise<[string, string][]> {
  return invoke<[string, string][]>("take_restore");
}
