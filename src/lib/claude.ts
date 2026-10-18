import { invoke } from "@tauri-apps/api/core";

// Claude Code のセッション（ベータ）。一覧と書いたファイルは Rust が読む。

export interface ClaudeSession {
  sessionId: string;
  name: string;
  kind: string;
  status?: string | null;
  state?: string | null;
  cwd?: string | null;
  startedAt?: number | null;
  transcript?: string | null;
}

export interface Wrote {
  path: string;
  at: number;
}

// 画面に出す状態。
//   working  作業中          waiting 応答待ち（こちらの返事を待っている）
//   idle     待機中          done    終わった（背景のセッションが仕事を終えた）
//   ended    一覧から外れた（記録は残っている）
//   deleted  削除された（一覧にも記録にも無い）
//   unknown  読めない（claude が見つからない・形が変わった）
export type Phase = "working" | "waiting" | "idle" | "done" | "ended" | "deleted" | "unknown";

export function phaseOf(
  session: ClaudeSession | undefined,
  opts: { readable: boolean; transcriptGone: boolean },
): Phase {
  if (!opts.readable) return "unknown";
  if (!session) return opts.transcriptGone ? "deleted" : "ended";
  switch (session.state) {
    case "working":
      return "working";
    case "blocked":
      return "waiting";
    case "done":
      return "done";
  }
  return session.status === "busy" ? "working" : "idle";
}

export const PHASE_LABEL: Record<Phase, string> = {
  working: "作業中",
  waiting: "応答待ち",
  idle: "待機中",
  done: "終了",
  ended: "終了",
  deleted: "削除済み",
  unknown: "不明",
};

// 書いたファイルのうち、ワークスペースを作るときにタブとして開くもの。
export const FIRST_TABS = 10;

export async function claudeBinPath(): Promise<string | null> {
  return invoke<string | null>("claude_bin_path");
}

export async function claudeSessions(): Promise<ClaudeSession[]> {
  return invoke<ClaudeSession[]>("claude_sessions");
}

export async function claudeSessionFiles(
  sessionId: string,
  transcript: string,
): Promise<{ wrote: Wrote[]; gone: boolean }> {
  return invoke("claude_session_files", { sessionId, transcript });
}

// 会話の頭と終わり（最初の依頼と最後の返答）。記録の先頭と末尾だけを読む。
export interface Talk {
  first: string | null;
  last: string | null;
}

export async function claudeSessionTalk(transcript: string): Promise<Talk> {
  return invoke<Talk>("claude_session_talk", { transcript });
}

// fude の中で動かした「元 → 先」（古い順）を、書いたファイルの道筋に当てる。
// 元そのものか、元のフォルダの下なら先へ付け替える。付け替えで同じ道筋に
// なったものは 1 つにまとめ、時刻は新しい方を残す。並びは新しい順（同時刻は道筋順）。
export function followMoves(
  wrote: readonly Wrote[],
  moved: readonly (readonly [string, string])[] | undefined,
): Wrote[] {
  if (!moved || moved.length === 0) return [...wrote];
  const follow = (path: string): string => {
    let at = path;
    for (const [from, to] of moved) {
      if (at === from) at = to;
      else if (at.startsWith(`${from}/`)) at = `${to}${at.slice(from.length)}`;
    }
    return at;
  };
  const latest = new Map<string, number>();
  for (const w of wrote) {
    const path = follow(w.path);
    latest.set(path, Math.max(latest.get(path) ?? w.at, w.at));
  }
  return [...latest]
    .map(([path, at]) => ({ path, at }))
    .sort((a, b) => b.at - a.at || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// 新しく現れたファイル（前に知っていなかったもの）。古い順に返す（タブに足す順）。
export function newlyWritten(before: readonly Wrote[], now: readonly Wrote[]): Wrote[] {
  const known = new Set(before.map((w) => w.path));
  return now.filter((w) => !known.has(w.path)).sort((a, b) => a.at - b.at);
}
