import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { updateCheckNonceAtom, updateStatusAtom } from "../state/atoms";
import { Icon } from "./Icon";

type Phase = "hidden" | "available" | "downloading" | "error";

// 起動時に最新版を確認し、更新があれば右下に VSCode 風の通知を出す。
// 「更新して再起動」でワンクリックダウンロード＋インストール→再起動。
export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("hidden");
  const [update, setUpdate] = useState<Update | null>(null);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // 起動時 + 「更新を確認」メニュー（nonce インクリメント）で実行
  const nonce = useAtomValue(updateCheckNonceAtom);
  const setStatus = useSetAtom(updateStatusAtom);

  useEffect(() => {
    // Tauri 環境以外（dev のブラウザ等）では静かに無効化
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    void (async () => {
      setStatus("checking");
      try {
        const u = await check();
        if (cancelled) return;
        if (u) {
          setUpdate(u);
          setPhase("available");
          setStatus("available");
        } else {
          setStatus("uptodate");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce, setStatus]);

  const runUpdate = async () => {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
        } else if (e.event === "Progress") {
          downloaded += e.data.chunkLength;
          setPct(total > 0 ? Math.round((downloaded / total) * 100) : 0);
        }
      });
      await relaunch();
    } catch (err) {
      setError(String(err));
      setPhase("error");
    }
  };

  if (phase === "hidden" || !update) return null;

  return (
    // 設定やキー操作の一覧（z-index 60）より上に置く。更新を確認するのは設定の中
    // なので、その上に出ないと押せる場所に現れない。
    <div className="mg-update" role="status">
      <div className="mg-update-head">
        <Icon name="rocket_launch" size={16} />
        新しいバージョン {update.version}
      </div>
      <div className="mg-update-sub">今は v{update.currentVersion}</div>
      {update.body && phase === "available" && <p className="mg-update-note">{update.body}</p>}
      {phase === "error" && <p className="mg-update-error">更新できませんでした: {error}</p>}

      {phase === "downloading" ? (
        <>
          <div className="mg-update-bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="mg-update-acts">ダウンロードしています… {pct}%</div>
        </>
      ) : (
        <div className="mg-update-acts">
          <button onClick={runUpdate} className="mg-go">
            {phase === "error" ? "もう一度" : "更新して再起動"}
          </button>
          <button onClick={() => setPhase("hidden")} className="mg-tbtn">
            後で
          </button>
        </div>
      )}
    </div>
  );
}
