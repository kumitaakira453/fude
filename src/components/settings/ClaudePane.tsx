import { useAtomValue, useStore } from "jotai";
import { useEffect, useState } from "react";
import { claudeBinPath, claudeSessions } from "../../lib/claude";
import { ago } from "../../lib/when";
import { claudeLinkAtom, claudeSessionsAtom } from "../../state/atoms";
import { Switch } from "./SettingRow";
import type { SwitchRow } from "./rows";

// Claude の面（ベータ）。連携の入切と、読めているかの様子だけを出す。
// 読めないときは、なぜ読めないかをそのまま見せる。セッションからワークスペースを
// 作るのは札の並びの ＋、状態は札に出る点で見る（ここには置かない）。

export function ClaudePane({ toggle }: { toggle: SwitchRow }) {
  const store = useStore();
  const on = useAtomValue(claudeLinkAtom);
  const read = useAtomValue(claudeSessionsAtom);
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

  return (
    <>
      <section className="mg-set-group">
        <div className="mg-set-card">
          <Switch row={toggle} />
        </div>
      </section>

      {on && (
        <section className="mg-set-group">
          <h3 className="mg-set-group-title">接続の状態</h3>
          <div className="mg-set-card">
            <div className="mg-set-row is-static">
              <span className="mg-set-row-main">
                <span className="mg-set-row-name">claude コマンド</span>
                <span className="mg-set-note">
                  {bin === undefined ? "確認しています…" : (bin ?? "見つかりません（Claude Code をインストールしてください）")}
                </span>
              </span>
            </div>
            <div className="mg-set-row is-static">
              <span className="mg-set-row-main">
                <span className="mg-set-row-name">セッション</span>
                <span className="mg-set-note">
                  {!read
                    ? "まだ読み込んでいません"
                    : read.error
                      ? `読み込めません：${read.error}`
                      : `${read.sessions.length} 件${readAt ? `（${ago(readAt)}に確認）` : ""}`}
                </span>
              </span>
              <button
                type="button"
                className="mg-quiet mg-set-btn"
                disabled={busy}
                onClick={() => void reread()}
              >
                {busy ? "確認しています…" : "再読み込み"}
              </button>
            </div>
          </div>
        </section>
      )}

    </>
  );
}
