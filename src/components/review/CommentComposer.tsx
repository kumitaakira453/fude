import { useEffect, useRef, useState } from "react";
import type { AnchorHit } from "../../lib/review";
import { Icon } from "../Icon";

// 読書中に選択した箇所へ指摘を書く小窓。書くことだけを担い、
// 付いている指摘を読む・返信する・解決するのはレビュー画面が受け持つ。
// スクロールで位置が崩れる状態を作らないよう、書き終わるまでの短い時間だけ出す。

const WIDTH = 340;
const GAP = 8;

export function CommentComposer({
  anchorRect,
  selection,
  busy,
  onSubmit,
  onClose,
}: {
  anchorRect: AnchorHit;
  selection: string;
  busy: boolean;
  onSubmit: (body: string) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  const submit = () => {
    const text = body.trim();
    if (!text || busy) return;
    onSubmit(text);
  };

  // 画面外に出ないように寄せる
  const left = Math.min(Math.max(GAP, anchorRect.left), window.innerWidth - WIDTH - GAP);
  const below = anchorRect.bottom + GAP;
  const openUpward = below + 200 > window.innerHeight && anchorRect.top > 240;
  const style = openUpward
    ? { left, bottom: window.innerHeight - anchorRect.top + GAP }
    : { left, top: below };

  return (
    <div
      ref={boxRef}
      style={{ ...style, width: WIDTH }}
      className="fixed z-40 overflow-hidden rounded-2xl border border-[var(--mg-border)] bg-[var(--mg-panel)] shadow-xl"
    >
      <div className="border-b border-[var(--mg-border)] px-3 py-2">
        <p className="mg-review-quote text-[12px] leading-relaxed text-[var(--mg-fg-dim)]">
          {selection}
        </p>
      </div>
      <div className="p-2">
        <textarea
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="指摘を書く…（⌘Enter で送信）"
          className="w-full resize-none rounded-lg border border-[var(--mg-border)] bg-[var(--mg-input-bg)] px-2.5 py-1.5 text-[13px] outline-none transition placeholder:text-[var(--mg-muted)] focus:border-[var(--mg-accent)]"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-[12px] text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)]"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy || !body.trim()}
            className="flex items-center gap-1 rounded-lg bg-[var(--mg-accent)] px-2.5 py-1 text-[12px] font-medium text-[var(--mg-bg)] transition disabled:opacity-40"
          >
            <Icon name="add_comment" size={14} />
            指摘する
          </button>
        </div>
      </div>
    </div>
  );
}
