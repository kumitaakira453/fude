import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { useAtom, useAtomValue, useStore } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useZoomView } from "../hooks/useZoomView";
import { D2, describeDiagramError, renderDiagram } from "../lib/diagram";
import { pathExists, readText, writeFile } from "../lib/fsAccess";
import { drawGate, type DrawGate } from "../lib/md/drawGate";
import { svgSize } from "../lib/svgSize";
import { DARK_THEME_IDS } from "../lib/themes";
import type { Size } from "../lib/zoom";
import {
  assetVersionAtom,
  d2SplitAtom,
  d2ViewAtom,
  liveEditAtom,
  savingCountAtom,
  themeAtom,
  type D2View,
} from "../state/atoms";
import { notifyBusy, settle } from "../state/toast";
import { D2SourceEditor } from "./D2SourceEditor";
import { ExportConfirm } from "./ExportConfirm";
import { Icon } from "./Icon";
import { SourceView } from "./SourceView";
import { ZoomControls } from "./ZoomControls";

// .d2 のファイルを開く（設定の「D2 の図を描く」が入のとき）。
//
// 見せ方はソース・分割・図の 3 つ（本文のコードの塊と同じ名前）。図は画像と
// 同じく、枠の中で拡大縮小して見る。設定の「リアルタイム編集」が入なら
// ソースの欄で書け、打つのが止まったら保存する。帯の釦で、同じフォルダの
// 同じ名前の .svg に書き出す。

// 描き直しは打つのが止まってから。エラーは同じ記述のまましばらく経ったときだけ
// 出す（本文の図と同じ間合い）。
const DRAW_DELAY = 250;
const ERROR_DELAY = 1000;
// 打つのが止まってから保存するまで。
const SAVE_DELAY = 500;

const MODES: { mode: D2View; label: string }[] = [
  { mode: "code", label: "ソース" },
  { mode: "split", label: "分割" },
  { mode: "diagram", label: "図" },
];

const NONE: Size = { width: 0, height: 0 };

export function D2Doc({ abs }: { abs: string }) {
  const store = useStore();
  const version = useAtomValue(assetVersionAtom);
  const live = useAtomValue(liveEditAtom);
  const theme = useAtomValue(themeAtom);
  const dark = DARK_THEME_IDS.has(theme);
  const [view, setView] = useAtom(d2ViewAtom);
  const [ratio, setRatio] = useAtom(d2SplitAtom);

  // 読んだ中身（エディタの最初の中身）と、手元でいま書いている中身。
  const [loaded, setLoaded] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [adopt, setAdopt] = useState<{ text: string; seq: number } | null>(null);

  // 自分が最後に書いた中身。読み直したものがこれと同じなら、自分の保存が
  // 返ってきただけなので何もしない。
  const savedRef = useRef<string | null>(null);
  const saveTimer = useRef(0);
  const textRef = useRef<string | null>(null);
  textRef.current = text;

  useEffect(() => {
    let alive = true;
    setLost(false);
    void readText(abs).then(
      (read) => {
        if (!alive) return;
        if (textRef.current === null) {
          setLoaded(read);
          setText(read);
          savedRef.current = read;
          return;
        }
        // 自分の保存が返ってきただけ、あるいは手元と同じ。
        if (read === savedRef.current || read === textRef.current) return;
        // 書いていない変更が手元にあるときは、手元を残す。
        if (saveTimer.current) return;
        savedRef.current = read;
        setText(read);
        setAdopt((was) => ({ text: read, seq: (was?.seq ?? 0) + 1 }));
      },
      () => alive && setLost(true),
    );
    return () => {
      alive = false;
    };
  }, [abs, version]);

  // 閉じるとき、書いていない変更があれば書いてから。
  useEffect(
    () => () => {
      if (!saveTimer.current) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = 0;
      const now = textRef.current;
      if (now !== null && now !== savedRef.current) void writeFile(abs, now);
    },
    [abs],
  );

  const onEdit = (next: string) => {
    setText(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = 0;
      const now = textRef.current;
      if (now === null || now === savedRef.current) return;
      savedRef.current = now;
      store.set(savingCountAtom, (n) => n + 1);
      void writeFile(abs, now)
        .catch((e) => {
          savedRef.current = null;
          void message(`保存できませんでした。\n${String(e)}`, { title: "fude", kind: "error" });
        })
        .finally(() => store.set(savingCountAtom, (n) => n - 1));
    }, SAVE_DELAY);
  };

  // ---- 図 ----
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 描き直しを待っている間。前の図を薄くして残す。
  const [stale, setStale] = useState(false);
  const composing = useRef<() => boolean>(() => false);
  const gate = useRef<DrawGate | null>(null);
  const darkRef = useRef(dark);
  darkRef.current = dark;

  useEffect(() => {
    const g = drawGate({
      render: (code) => renderDiagram(D2, code, darkRef.current),
      onSvg: (s) => {
        setSvg(s);
        setError(null);
        setStale(false);
      },
      onError: (m) => setError(m),
      composing: () => composing.current(),
      delay: DRAW_DELAY,
      errorDelay: ERROR_DELAY,
    });
    gate.current = g;
    return () => g.stop();
  }, []);

  // 読んだ直後と明暗の切り替えは待たずに描く。打っている間は間合いを取る。
  const drawnFor = useRef<{ text: string; dark: boolean } | null>(null);
  useEffect(() => {
    if (text === null) return;
    const was = drawnFor.current;
    drawnFor.current = { text, dark };
    if (was && was.text === text && was.dark === dark) return;
    if (!text.trim()) {
      setSvg("");
      setError(null);
      setStale(false);
      return;
    }
    setStale(true);
    gate.current?.draw(text, !was || was.dark !== dark);
  }, [text, dark]);

  const natural = useMemo<Size>(() => (svg ? (svgSize(svg) ?? NONE) : NONE), [svg]);
  const host = useRef<HTMLDivElement>(null);
  const zoom = useZoomView(host, natural);
  const { shown } = zoom;

  const problem = error ? describeDiagramError(D2, error) : null;
  const errorLine = error ? Number(/^(\d+):\d+:/.exec(error.trim())?.[1]) || null : null;

  // ---- 書き出し ----
  const [asking, setAsking] = useState<{ exists: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const svgName = `${(abs.split("/").pop() ?? abs).replace(/\.d2$/i, "")}.svg`;
  const svgPath = abs.replace(/\.d2$/i, ".svg");

  const askExport = async () => {
    const exists = await pathExists(svgPath).catch(() => false);
    setAsking({ exists });
  };

  const exportSvg = async () => {
    setAsking(null);
    setExporting(true);
    const at = notifyBusy(store, "書き出しています…");
    try {
      // 書いていない変更があれば先に書く（書き出すのはファイルの中身なので）。
      const now = textRef.current;
      if (now !== null && now !== savedRef.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = 0;
        savedRef.current = now;
        await writeFile(abs, now);
      }
      await invoke<string>("export_d2", { path: abs });
      settle(store, at, `${svgName} に書き出しました`);
    } catch (e) {
      settle(store, at, "書き出せませんでした");
      const { title, where, text: body } = describeDiagramError(D2, String(e));
      void message(`${title}${where ? `（${where}）` : ""}\n${body}`, {
        title: "SVG に書き出せませんでした",
        kind: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  // ---- 仕切り ----
  const body = useRef<HTMLDivElement>(null);
  const onDivide = (e: React.PointerEvent) => {
    const at = body.current?.getBoundingClientRect();
    if (!at) return;
    const bar = e.currentTarget as HTMLElement;
    bar.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) =>
      setRatio(Math.min(0.8, Math.max(0.2, (ev.clientX - at.left) / at.width)));
    const up = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  };

  const showSource = view !== "diagram";
  const showFigure = view !== "code";

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={body} className="flex min-h-0 flex-1">
        {lost ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--mg-muted)]">
            このファイルは字として読めませんでした
          </div>
        ) : text === null || loaded === null ? null : (
          <>
            {showSource && (
              <div
                className="mg-d2-source"
                style={showFigure ? { flex: `0 0 ${ratio * 100}%` } : undefined}
              >
                {live ? (
                  <D2SourceEditor
                    initial={text}
                    adopt={adopt}
                    errorLine={errorLine}
                    composing={composing}
                    onChange={onEdit}
                  />
                ) : (
                  <SourceView code={text} lang={D2} />
                )}
              </div>
            )}
            {showSource && showFigure && (
              <div
                className="mg-d2-divider"
                role="separator"
                aria-orientation="vertical"
                onPointerDown={onDivide}
              />
            )}
            {showFigure && (
              <div
                ref={host}
                tabIndex={0}
                {...zoom.handlers}
                className={`mg-d2-stage${stale || problem ? " is-stale" : ""}`}
                style={{ cursor: zoom.over ? (zoom.grabbing ? "grabbing" : "grab") : "default" }}
              >
                {problem && (
                  <div className="mg-mermaid-err" onPointerDown={(e) => e.stopPropagation()}>
                    <div className="mg-mermaid-err-head">
                      <Icon name="error" size={14} />
                      <span>{problem.title}</span>
                      {problem.where && <span className="mg-mermaid-err-at">{problem.where}</span>}
                    </div>
                    <div className="mg-mermaid-err-text">{problem.text}</div>
                  </div>
                )}
                {svg && zoom.sized && (
                  <div
                    className="mg-d2-figure"
                    style={{
                      width: natural.width,
                      height: natural.height,
                      transform: `translate(calc(-50% + ${shown.x}px), calc(-50% + ${shown.y}px)) scale(${shown.scale})`,
                    }}
                    // 図の SVG（cleanSvg で消毒済み）
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="mg-imgdoc-bar">
        <span className="mg-imgdoc-size">{lost ? "" : "D2"}</span>
        {!lost && showFigure && (
          <>
            <ZoomControls zoom={zoom} />
            <span className="mg-imgdoc-sep" aria-hidden />
          </>
        )}
        {!lost && (
          <>
            <button
              type="button"
              className="mg-small"
              disabled={exporting}
              onClick={() => void askExport()}
            >
              SVG に書き出す
            </button>
            <span className="mg-imgdoc-sep" aria-hidden />
            <span className="mg-d2-modes" title="見せ方を切り替える（⌘⇧V）">
              {MODES.map((m) => (
                <button
                  key={m.mode}
                  type="button"
                  className={view === m.mode ? "is-on" : ""}
                  aria-pressed={view === m.mode}
                  onClick={() => setView(m.mode)}
                >
                  {m.label}
                </button>
              ))}
            </span>
          </>
        )}
      </div>
      {asking && (
        <ExportConfirm
          name={svgName}
          exists={asking.exists}
          onGo={() => void exportSvg()}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  );
}
