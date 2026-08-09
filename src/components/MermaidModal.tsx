import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

// Mermaid 図を全画面のライトボックスで拡大表示。ホイールでズーム、ドラッグでパン。
export function MermaidModal({
  svg,
  onClose,
}: {
  svg: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clamp = (v: number, a: number, b: number) =>
    Math.min(b, Math.max(a, v));
  const zoom = (f: number) => setScale((s) => clamp(s * f, 0.3, 8));
  const reset = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  return createPortal(
    <div
      className="mg-mmd-overlay"
      onClick={onClose}
      onWheel={(e) => zoom(e.deltaY < 0 ? 1.12 : 0.89)}
    >
      <div className="mg-mmd-toolbar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => zoom(1.2)} title="拡大">
          <Icon name="add" size={18} />
        </button>
        <button onClick={() => zoom(0.83)} title="縮小">
          <Icon name="remove" size={18} />
        </button>
        <button onClick={reset} title="等倍に戻す">
          <Icon name="fit_screen" size={18} />
        </button>
        <button onClick={onClose} title="閉じる (Esc)">
          <Icon name="close" size={18} />
        </button>
      </div>
      <div
        className="mg-mmd-stage"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setPos({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        style={{ cursor: drag.current ? "grabbing" : "grab" }}
      >
        <div
          className="mg-mmd-svg"
          style={{
            // ズームは要素サイズで行う（SVG をベクターのまま再描画＝ボケない）
            width: `calc(92vw * ${scale})`,
            height: `calc(88vh * ${scale})`,
            // パンのみ transform（translate はボケない）
            transform: `translate(${pos.x}px, ${pos.y}px)`,
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    document.body,
  );
}
