import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from "react";

// 値の全文の小窓。CSV の表の升目や JSON の木の行で、… で切れた値を読む
// （WKWebView は title の吹き出しを出さない）。字は選んでコピーできる。
//
// 値を出している要素（anchor）の下に出し、入らなければ上に出す。送っても
// その要素に付いていき、枠（frame）の外へ出たら隠す。

const WIDTH = 560;
const GAP = 4;

// JSON として読めるなら字下げして見せる（ログの 1 行が JSON のことが多い）。
export function pretty(value: string): { text: string; code: boolean } {
  const t = value.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), code: true };
    } catch {
      /* JSON でなければそのまま */
    }
  }
  return { text: value, code: false };
}

export function ValuePeek({
  boxRef,
  anchor,
  frame,
  watch,
  label,
  value,
  onClose,
}: {
  boxRef: RefObject<HTMLDivElement>;
  anchor: () => Element | null;
  frame: () => DOMRect | undefined;
  // 見ている値が替わったことの印（升目の位置・木の道筋）。替わったら測り直す。
  watch: string;
  label: string;
  value: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shown = useMemo(() => pretty(value), [value]);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => setCopied(false), [watch]);

  useLayoutEffect(() => {
    const put = () => {
      const el = boxRef.current;
      const at = anchor()?.getBoundingClientRect();
      const box = frame();
      if (!el || !at || !box) return setPlace(null);
      if (at.bottom < box.top || at.top > box.bottom) return setPlace(null);
      const h = el.offsetHeight;
      const w = Math.min(WIDTH, window.innerWidth - 16);
      const left = Math.max(8, Math.min(at.left, window.innerWidth - w - 8));
      const below = at.bottom + GAP;
      const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, at.top - GAP - h);
      setPlace({ left, top });
    };
    put();
    // 送ったあとの位置へ付いていく。組む行の入れ替えは送った催しの中で
    // 起きるので、描き直しを待ってから測る。
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(put);
    };
    window.addEventListener("scroll", later, true);
    window.addEventListener("resize", later);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", later, true);
      window.removeEventListener("resize", later);
    };
    // anchor と frame は呼び出し側で毎回作り直すので、見ている値の印で測り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxRef, watch, value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && boxRef.current?.contains(document.activeElement)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boxRef, onClose]);

  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => setCopied(true));
  };

  return (
    <div
      ref={boxRef}
      role="dialog"
      className="mg-csv-peek"
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        visibility: place ? "visible" : "hidden",
      }}
    >
      <div className="mg-csv-peek-bar">
        <span className="mg-csv-peek-label">
          {label}
          {shown.code ? " · JSON" : ""}
        </span>
        <button type="button" className="mg-small" onClick={copy}>
          {copied ? "コピーしました" : "コピー"}
        </button>
      </div>
      <div className={`mg-csv-peek-body${shown.code ? " is-code" : ""}`}>{shown.text}</div>
    </div>
  );
}
