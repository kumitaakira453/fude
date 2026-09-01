import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AnchorHit } from "../../lib/review";
import { Icon } from "../Icon";

// 読書中に選択した箇所へ指摘を書く小窓。書くことだけを担い、
// 付いている指摘を読む・返信する・解決するのはレビュー画面が受け持つ。
// スクロールで位置が崩れる状態を作らないよう、書き終わるまでの短い時間だけ出す。

const WIDTH = 420;
const GAP = 8;
// 入力欄以外（引用の見出し・ボタンの並び・余白）が使う高さの目安。
// 小窓に許される高さからこれを引いた分を入力欄に渡す。
const CHROME = 116;
// 入力欄の下限と上限。上限は画面に収まる範囲でさらに抑える。
const MIN_INPUT = 66;
const MAX_INPUT_RATIO = 0.45;

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

  // 画面外に出ないように寄せる
  const left = Math.min(Math.max(GAP, anchorRect.left), window.innerWidth - WIDTH - GAP);
  // 下に開いて下へ伸びるのが基本。書いた文が下に足されていく向きと揃う。
  // 上に開くのは、下では小窓が成り立たないほど狭く、かつ上の方が広いときだけ。
  const roomBelow = window.innerHeight - anchorRect.bottom - GAP * 2;
  const roomAbove = anchorRect.top - GAP * 2;
  const openUpward = roomBelow < CHROME + MIN_INPUT && roomAbove > roomBelow;
  const room = openUpward ? roomAbove : roomBelow;
  // 入力欄の上限。空いている側に収まる高さと、画面の 45% の小さい方。
  const maxInput = Math.max(
    MIN_INPUT,
    Math.min(room - CHROME, window.innerHeight * MAX_INPUT_RATIO),
  );
  const style = openUpward
    ? { left, bottom: window.innerHeight - anchorRect.top + GAP }
    : { left, top: anchorRect.bottom + GAP };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 書いた分だけ入力欄を伸ばす。固定の高さだと、長い指摘を書いている間に
  // 自分が書いた文が上へ流れて見えなくなる。上限に達したら中をスクロールする。
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxInput)}px`;
  }, [body, maxInput]);

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
          style={{ minHeight: MIN_INPUT, maxHeight: maxInput }}
          placeholder="指摘を書く…（⌘Enter で送信）"
          className="block w-full resize-none rounded-lg border border-[var(--mg-border)] bg-[var(--mg-input-bg)] px-2.5 py-1.5 text-[13px] leading-relaxed outline-none transition placeholder:text-[var(--mg-muted)] focus:border-[var(--mg-accent)]"
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
