import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { readText } from "../lib/fsAccess";
import { assetSrc } from "../lib/asset";
import { assetVersionAtom } from "../state/atoms";
import { Icon } from "./Icon";
import { SourceView } from "./SourceView";

// HTML を 1 枚の書き物として開く。
//
// 描くのは iframe。スクリプトは動かすが、`allow-same-origin` は付けない。
// 中身は不透明なオリジンに置かれるので、アプリ本体にも他のファイルにも
// 触れない。読み込みは asset プロトコル経由なので、隣に置いた CSS・画像・
// スクリプトは相対の道筋のまま解ける。

const STEP = 1.25;
const MIN = 0.25;
const MAX = 4;

export function HtmlDoc({ abs, active }: { abs: string; active: boolean }) {
  const version = useAtomValue(assetVersionAtom);
  const [source, setSource] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [zoom, setZoom] = useState(1);
  // 読み込み直した回数。iframe の key に混ぜ、増やすと作り直してスクリプトの状態も初めに戻す。
  const [loads, setLoads] = useState(0);
  const src = useMemo(() => assetSrc(abs, version), [abs, version]);

  useEffect(() => {
    setReading(false);
    setZoom(1);
  }, [abs]);

  // ⌘R はメニューで受けて、押した窓へ送られてくる（ページの中を押した後は
  // キーがページにしか届かないため）。読み込み直すのは今の欄に出ているものだけ。
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let stop: (() => void) | undefined;
    void import("@tauri-apps/api/webviewWindow")
      .then(({ getCurrentWebviewWindow }) =>
        getCurrentWebviewWindow().listen("reload-page", () => setLoads((n) => n + 1)),
      )
      .then(
        (un) => (alive ? (stop = un) : un()),
        (e: unknown) => console.warn("⌘R の再読み込みを受けられない", e),
      );
    return () => {
      alive = false;
      stop?.();
    };
  }, [active]);

  // ソースは見せると決めてから読む。描くだけなら要らない。
  useEffect(() => {
    if (!reading) return;
    let alive = true;
    void readText(abs).then(
      (text) => alive && setSource(text),
      () => alive && setSource(""),
    );
    return () => {
      alive = false;
    };
  }, [abs, reading, version]);

  const step = (by: number) =>
    setZoom((was) => Math.min(MAX, Math.max(MIN, was * by)));

  const onKey = (e: React.KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (e.key === "+" || e.key === "=" || e.key === ";") {
      e.preventDefault();
      step(STEP);
    } else if (e.key === "-") {
      e.preventDefault();
      step(1 / STEP);
    } else if (e.key === "0") {
      e.preventDefault();
      setZoom(1);
    }
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" onKeyDown={onKey}>
      {reading ? (
        <div className="min-h-0 flex-1 overflow-auto overscroll-none">
          <SourceView code={source ?? ""} lang="xml" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-white">
          <iframe
            key={`${src}#${loads}`}
            src={src}
            title={abs.split("/").pop() ?? ""}
            sandbox="allow-scripts allow-popups"
            style={{ zoom }}
            className="h-full w-full border-0"
          />
        </div>
      )}

      <div className="mg-imgdoc-bar">
        <span className="mg-imgdoc-size">
          {reading ? (
            "ソース"
          ) : (
            <button
              type="button"
              className="mg-small mg-htmldoc-reload"
              data-tip="ページを読み込み直す（スクリプトの状態も初めに戻る）"
              data-key="⌘R"
              onClick={() => setLoads((n) => n + 1)}
            >
              <Icon name="refresh" size={14} />
              再読み込み
            </button>
          )}
        </span>
        {!reading && (
          <>
            <button type="button" className="mg-small" onClick={() => step(1 / STEP)}>
              <Icon name="zoom_out" size={15} />
            </button>
            <span className="mg-imgdoc-scale">{Math.round(zoom * 100)}%</span>
            <button type="button" className="mg-small" onClick={() => step(STEP)}>
              <Icon name="zoom_in" size={15} />
            </button>
          </>
        )}
        <button
          type="button"
          className={`mg-small${reading ? " is-on" : ""}`}
          onClick={() => setReading(!reading)}
        >
          {reading ? "描画に戻す" : "ソースを見る"}
        </button>
      </div>
    </div>
  );
}
