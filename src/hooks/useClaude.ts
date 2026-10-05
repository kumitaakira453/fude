import { useAtomValue, useStore } from "jotai";
import { useEffect } from "react";
import { claudeSessionFiles, claudeSessions, newlyWritten } from "../lib/claude";
import { pathExists } from "../lib/fsAccess";
import { appendTab } from "../lib/ui";
import { saveWorkspace, type Workspace } from "../lib/workspaces";
import * as A from "../state/atoms";
import { upsertWorkspace } from "../state/workspace";

// Claude のセッションを追いかける（ベータ）。
//
// 読むのは、設定で入れていて、かつ要るとき（切り替えの一覧を開いているか、
// セッションに結びついたワークスペースがあるとき）だけ。間を置いて一覧を
// 取り直し、名前が変わっていればワークスペースの名前も替える。今開いている
// ワークスペースなら、そのセッションが新しく書いたファイルをタブに足す。

const EVERY = 5000;

function put(store: ReturnType<typeof useStore>, ws: Workspace): void {
  store.set(A.workspacesAtom, (list) => upsertWorkspace(list, ws));
  if (store.get(A.workspaceAtom)?.id === ws.id) store.set(A.workspaceAtom, ws);
  void saveWorkspace(ws).catch((e: unknown) => {
    console.error("ワークスペースを控えられません", e);
  });
}

export function useClaude(): void {
  const store = useStore();
  const on = useAtomValue(A.claudeLinkAtom);
  const switcher = useAtomValue(A.workspaceSwitcherOpenAtom);
  const list = useAtomValue(A.workspacesAtom);
  const current = useAtomValue(A.workspaceAtom);
  const linked = !!current?.claude || list.some((w) => w.claude);
  const need = on && (switcher || linked);

  useEffect(() => {
    if (!need) return;
    let dead = false;
    let busy = false;

    const tick = async () => {
      if (dead || busy || document.hidden) return;
      busy = true;
      try {
        let sessions;
        try {
          sessions = await claudeSessions();
        } catch (e) {
          const prev = store.get(A.claudeSessionsAtom);
          store.set(A.claudeSessionsAtom, {
            sessions: prev?.sessions ?? [],
            error: String(e),
            gone: prev?.gone ?? new Set(),
          });
          return;
        }
        if (dead) return;
        const byId = new Map(sessions.map((s) => [s.sessionId, s]));

        // 一覧から外れたセッションは、記録が残っているかで「終わった」と
        // 「削除された」を分ける。
        const gone = new Set<string>();
        const spaces = [
          ...store.get(A.workspacesAtom),
          ...(store.get(A.workspaceAtom) ? [store.get(A.workspaceAtom)!] : []),
        ];
        const seen = new Set<string>();
        for (const ws of spaces) {
          if (!ws.claude || seen.has(ws.id)) continue;
          seen.add(ws.id);
          const s = byId.get(ws.claude.sessionId);
          if (!s) {
            const at = ws.claude.transcript;
            if (!at || !(await pathExists(at))) gone.add(ws.claude.sessionId);
            continue;
          }
          // 名前を追う。自分で付け直したもの（nameFollows: false）は追わない。
          const name = s.name.trim();
          if (name && name !== ws.claude.lastName) {
            const fresh =
              store.get(A.workspaceAtom)?.id === ws.id ? store.get(A.workspaceAtom)! : ws;
            put(store, {
              ...fresh,
              name: fresh.claude?.nameFollows ? name : fresh.name,
              claude: {
                ...fresh.claude!,
                lastName: name,
                transcript: s.transcript ?? fresh.claude!.transcript,
              },
            });
          }
        }
        if (dead) return;
        store.set(A.claudeSessionsAtom, { sessions, error: null, gone });

        // 今開いているワークスペースのセッションが書いたものを追う。
        const ws = store.get(A.workspaceAtom);
        const link = ws?.claude;
        const transcript = link && (byId.get(link.sessionId)?.transcript ?? link.transcript);
        if (!ws || !link || !transcript) return;
        const { wrote, gone: lost } = await claudeSessionFiles(link.sessionId, transcript);
        if (dead || lost) return;
        const before = link.wrote ?? [];
        const added = newlyWritten(before, wrote);
        const changed =
          added.length > 0 ||
          wrote.length !== before.length ||
          wrote.some((w, i) => before[i]?.path !== w.path || before[i]?.at !== w.at);
        if (!changed) return;
        const now = store.get(A.workspaceAtom);
        if (now?.id !== ws.id || !now.claude) return;
        // 足すのは、一度読んだことがあるとき（作った直後の取り込みでは足さない）。
        if (link.wrote !== undefined) {
          const fresh = new Set(store.get(A.freshTabsAtom));
          for (const w of added) if (appendTab(store, w.path)) fresh.add(w.path);
          store.set(A.freshTabsAtom, fresh);
        }
        put(store, { ...now, claude: { ...now.claude, wrote } });
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), EVERY);
    const onShow = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [need, store, current?.id]);
}
