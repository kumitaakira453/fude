import { atom, type getDefaultStore } from "jotai";
import { phaseOf, type Phase } from "../lib/claude";
import type { Workspace } from "../lib/workspaces";
import * as A from "./atoms";

type Store = ReturnType<typeof getDefaultStore>;

// ワークスペースに結びついた Claude のセッションの状態。結びついていなければ null。
// 一覧をまだ読んでいなければ、最後に分かっていたものは無いので「不明」。
export const phaseForAtom = atom((get) => {
  const on = get(A.claudeLinkAtom);
  const read = get(A.claudeSessionsAtom);
  return (ws: Workspace | null | undefined): Phase | null => {
    if (!ws?.claude || !on) return null;
    const id = ws.claude.sessionId;
    return phaseOf(
      read?.sessions.find((s) => s.sessionId === id),
      { readable: !!read && read.error === null, transcriptGone: !!read?.gone.has(id) },
    );
  };
});

// 状態の点の色。応答待ちは目立たせ、終わったものと消えたものは沈める。
export const PHASE_COLOR: Record<Phase, string> = {
  working: "var(--mg-accent)",
  waiting: "#e8a33d",
  idle: "var(--mg-muted)",
  done: "var(--mg-muted)",
  ended: "var(--mg-muted)",
  deleted: "var(--mg-border)",
  unknown: "var(--mg-border)",
};

// 新しく足されたタブの印を外す（開いたら外す）。
export function seenTab(store: Store, path: string): void {
  const fresh = store.get(A.freshTabsAtom);
  if (!fresh.has(path)) return;
  const next = new Set(fresh);
  next.delete(path);
  store.set(A.freshTabsAtom, next);
}
