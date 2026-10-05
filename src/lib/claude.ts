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
  done: "終わった",
  ended: "終わった",
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

// 新しく現れたファイル（前に知っていなかったもの）。古い順に返す（タブに足す順）。
export function newlyWritten(before: readonly Wrote[], now: readonly Wrote[]): Wrote[] {
  const known = new Set(before.map((w) => w.path));
  return now.filter((w) => !known.has(w.path)).sort((a, b) => a.at - b.at);
}
