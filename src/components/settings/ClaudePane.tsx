import { useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { claudeBinPath, claudeSessions, PHASE_LABEL } from "../../lib/claude";
import { ago } from "../../lib/when";
import { colorVar } from "../../lib/workspaces";
import {
  claudeLinkAtom,
  claudeSessionsAtom,
  settingsOpenAtom,
  workspaceAtom,
  workspacesAtom,
} from "../../state/atoms";
import { PHASE_COLOR, phaseForAtom } from "../../state/claude";
import { Switch } from "./SettingRow";
import type { SwitchRow } from "./rows";

// Claude の面（ベータ）。連携の入切と、読めているかの様子、結びついている
// ワークスペースの状態を出す。読めないときは、なぜ読めないかをそのまま見せる。

export function ClaudePane({ toggle }: { toggle: SwitchRow }) {
  const store = useStore();
  const on = useAtomValue(claudeLinkAtom);
  const read = useAtomValue(claudeSessionsAtom);
  const list = useAtomValue(workspacesAtom);
  const current = useAtomValue(workspaceAtom);
  const phaseFor = useAtomValue(phaseForAtom);
  const { openWorkspace } = useWorkspace();
  // 見つけた claude の場所。undefined はまだ調べていない。
  const [bin, setBin] = useState<string | null | undefined>(undefined);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const reread = async () => {
    setBusy(true);
    try {
      const sessions = await claudeSessions();
      store.set(claudeSessionsAtom, {
        sessions,
        error: null,
        gone: store.get(claudeSessionsAtom)?.gone ?? new Set(),
      });
      setReadAt(Date.now());
    } catch (e) {
      const prev = store.get(claudeSessionsAtom);
      store.set(claudeSessionsAtom, {
        sessions: prev?.sessions ?? [],
        error: String(e),
        gone: prev?.gone ?? new Set(),
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!on) return;
    void claudeBinPath()
      .then(setBin)
      .catch(() => setBin(null));
    void reread();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  const linked = useMemo(() => {
    const merged = current
      ? list.some((w) => w.id === current.id)
        ? list.map((w) => (w.id === current.id ? current : w))
        : [current, ...list]
      : list;
    return merged.filter((w) => w.claude);
  }, [list, current]);

  return (
    <>
      <section className="mg-set-group">
        <div className="mg-set-card">
          <Switch row={toggle} />
        </div>
      </section>

      {on && (
        <section className="mg-set-group">
          <h3 className="mg-set-group-title">読めているか</h3>
          <div className="mg-set-card">
            <div className="mg-set-row is-static">
              <span className="mg-set-row-main">
                <span className="mg-set-row-name">claude コマンド</span>
                <span className="mg-set-note">
                  {bin === undefined ? "探しています…" : (bin ?? "見つかりません（Claude Code を入れてください）")}
                </span>
              </span>
            </div>
            <div className="mg-set-row is-static">
              <span className="mg-set-row-main">
                <span className="mg-set-row-name">セッションの一覧</span>
                <span className="mg-set-note">
                  {!read
                    ? "まだ読んでいません"
                    : read.error
                      ? `読めません：${read.error}`
                      : `${read.sessions.length} 件のセッション${readAt ? `（${ago(readAt)}に読みました）` : ""}`}
                </span>
              </span>
              <button
                type="button"
                className="mg-quiet mg-set-btn"
                disabled={busy}
                onClick={() => void reread()}
              >
                {busy ? "読んでいます…" : "読み直す"}
              </button>
            </div>
          </div>
        </section>
      )}

      {on && (
        <section className="mg-set-group">
          <h3 className="mg-set-group-title">結びついているワークスペース</h3>
          <div className="mg-set-card">
            {linked.length === 0 && (
              <p className="mg-set-none">
                まだありません。⌘⇧P の一覧の「Claude のセッション」から作れます
              </p>
            )}
            {linked.map((ws) => {
              const phase = phaseFor(ws);
              return (
                <button
                  key={ws.id}
                  type="button"
                  className="mg-set-row"
                  onClick={() => {
                    store.set(settingsOpenAtom, false);
                    void openWorkspace(ws);
                  }}
                >
                  <span className="mg-ws-dot" style={{ background: colorVar(ws.color) }} />
                  <span className="mg-set-row-main">
                    <span className="mg-set-row-name">{ws.name}</span>
                    <span className="mg-set-note">
                      {ws.claude?.lastName ?? ws.claude?.sessionId.slice(0, 8)}
                      {ws.claude?.wrote ? ` ・ 書いたファイル ${ws.claude.wrote.length} 件` : ""}
                    </span>
                  </span>
                  {phase && (
                    <span className="mg-set-phase">
                      <i style={{ background: PHASE_COLOR[phase] }} />
                      {PHASE_LABEL[phase]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
