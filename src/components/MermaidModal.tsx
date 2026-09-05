import { ask } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMermaidSvg } from "../hooks/useMermaidSvg";
import { Icon } from "./Icon";
import { MermaidSourceEditor } from "./MermaidSourceEditor";

// ソース欄が占める幅（左右の余白を含む）。図はこのぶん右へ寄せる。
const PANE = 432;
// 打ち終わってから描き直すまでの待ち。打つたびに描くと図が跳ねる。
const REDRAW_DELAY = 250;

// Mermaid 図を全画面のライトボックスで拡大表示。ホイールでズーム、ドラッグでパン。
// edit を渡すと左にソース欄が出て、図を見ながら直せる。
export function MermaidModal({
  svg,
  dark,
  onClose,
  onEdit,
  edit,
}: {
  svg: string;
  dark: boolean;
  onClose: () => void;
  // 見るだけのときに出す鉛筆。押すと呼び出し側が編集で開き直す。
  onEdit?: () => void;
  edit?: { src: string; onSave: (src: string) => void };
}) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [draft, setDraft] = useState(edit?.src ?? "");
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  const overlayRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  // ドラッグ直後のクリックで閉じないためのフラグ
  const draggedRef = useRef(false);
  // 開いた直後(ダブルタップの2打目)で即閉じしないためのガード
  const closableRef = useRef(false);

  const pane = edit ? PANE : 0;
  // 開いた時点のソースは待たずに描く。待つのは打ち直した分だけ。
  const initial = useRef(edit?.src ?? "");
  const live = useMermaidSvg(
    edit ? draft : "",
    dark,
    draft === initial.current ? 0 : REDRAW_DELAY,
  );
  const shown = edit ? live.svg || svg : svg;
  const dirty = edit ? draft !== edit.src : false;

  // 取消。書き換えたまま閉じると気付かないので、そのときだけ確かめる。
  const cancelRef = useRef(() => {});
  cancelRef.current = () => {
    if (!dirty || !("__TAURI_INTERNALS__" in window)) {
      onClose();
      return;
    }
    void ask("書き換えた内容を捨てて閉じますか？", {
      title: "fude",
      kind: "warning",
    }).then((yes) => {
      if (yes) onClose();
    });
  };

  // 保存する中身は、ソース欄が今持っているものを優先する。打った直後に
  // 押されると、控えの draft が 1 拍遅れることがある。
  const saveRef = useRef((_src?: string) => {});
  saveRef.current = (src?: string) => edit?.onSave(src ?? draft);

  useEffect(() => {
    // ソース欄の中で押した分は CodeMirror が受けて preventDefault する。
    // ここで拾うのは、図の側にカーソルがあるときの分だけ。
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") {
        cancelRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      closableRef.current = true;
    }, 300);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
    };
  }, []);

  // 背景（図・ツールバー以外）クリックで閉じる。書いている最中は閉じない。
  const handleBackground = () => {
    if (edit) return;
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (!closableRef.current) return;
    onClose();
  };

  const clamp = (v: number, a: number, b: number) =>
    Math.min(b, Math.max(a, v));

  // 図が画面外へ出ないようパン量を制限する。ズーム時は要素サイズに合わせて
  // 端を超えない範囲だけ許可（小さい時は中央固定）。
  const clampPos = (x: number, y: number, s: number) => {
    const vw = window.innerWidth - pane;
    const vh = window.innerHeight;
    const w = 0.92 * vw * s;
    const h = 0.88 * vh * s;
    // 端で止まらず、外側にビューポートの 15% ぶん余白を送れるようにする
    const padX = vw * 0.15;
    const padY = vh * 0.15;
    const mx = Math.max(0, (w - vw) / 2) + padX;
    const my = Math.max(0, (h - vh) / 2) + padY;
    return { x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
  };

  const zoom = (f: number) => setScale((s) => clamp(s * f, 0.4, 6));
  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  // スケール変更後、はみ出した分を画面内へ引き戻す
  useEffect(() => {
    setPos((p) => clampPos(p.x, p.y, scale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // ホイール/トラックパッド: 通常スクロール=パン、ピンチ(⌘/ctrl+wheel)=ズーム。
  // ページ側のスクロール/ズームを止めるため非パッシブで preventDefault する。
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setScale((s) => clamp(s * (e.deltaY < 0 ? 1.06 : 0.94), 0.4, 6));
      } else {
        setPos((p) =>
          clampPos(p.x - e.deltaX, p.y - e.deltaY, scaleRef.current),
        );
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      ref={overlayRef}
      className="mg-mmd-overlay"
      // 背景（動かない）をテーマに合わせ、透明 SVG の線が沈まないようにする
      style={{
        background: dark ? "rgba(6,8,12,0.86)" : "rgba(244,245,248,0.94)",
      }}
      onClick={handleBackground}
    >
      {edit && (
        <div className="mg-mmd-pane" onClick={(e) => e.stopPropagation()}>
          <div className="mg-mmd-pane-head">
            <Icon name="account_tree" size={15} />
            <span>図のソース</span>
          </div>
          <div className="mg-mmd-pane-body">
            <MermaidSourceEditor
              src={edit.src}
              onChange={setDraft}
              onSave={(src) => saveRef.current(src)}
              onCancel={() => cancelRef.current()}
            />
          </div>
          {live.error && <div className="mg-mmd-err">{live.error}</div>}
          <div className="mg-mmd-pane-foot">
            <button
              className="mg-mmd-save"
              onClick={() => edit.onSave(draft)}
              disabled={!dirty}
            >
              保存
              <span className="mg-mmd-key">⌘⏎</span>
            </button>
            <button className="mg-mmd-quiet" onClick={() => cancelRef.current()}>
              取消
              <span className="mg-mmd-key">Esc</span>
            </button>
          </div>
        </div>
      )}
      <div className="mg-mmd-toolbar" onClick={(e) => e.stopPropagation()}>
        {onEdit && (
          <button onClick={onEdit} title="図を編集">
            <Icon name="edit" size={18} />
          </button>
        )}
        <button onClick={() => zoom(1.2)} title="拡大">
          <Icon name="add" size={18} />
        </button>
        <button onClick={() => zoom(0.83)} title="縮小">
          <Icon name="remove" size={18} />
        </button>
        <button onClick={reset} title="等倍に戻す">
          <Icon name="fit_screen" size={18} />
        </button>
        <button onClick={() => cancelRef.current()} title="閉じる (Esc)">
          <Icon name="close" size={18} />
        </button>
      </div>
      <div
        className="mg-mmd-stage"
        style={{
          marginLeft: pane,
          width: `calc(100vw - ${pane}px)`,
          cursor: drag.current ? "grabbing" : "grab",
        }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          draggedRef.current = false;
          drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (
            Math.abs(e.clientX - d.x) > 4 ||
            Math.abs(e.clientY - d.y) > 4
          ) {
            draggedRef.current = true;
          }
          setPos(
            clampPos(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y), scale),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div
          className="mg-mmd-svg"
          onClick={(e) => e.stopPropagation()}
          style={{
            // ズームは要素サイズで行う（SVG をベクターのまま再描画＝ボケない）
            width: `calc((100vw - ${pane}px) * 0.92 * ${scale})`,
            height: `calc(88vh * ${scale})`,
            // 中央アンカー(-50%)＋パン(pos)。中心から拡大するので吹っ飛ばない
            transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px)`,
          }}
          dangerouslySetInnerHTML={{ __html: shown }}
        />
      </div>
    </div>,
    document.body,
  );
}
