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
  track,
  onSubmit,
  onClose,
}: {
  anchorRect: AnchorHit;
  selection: string;
  busy: boolean;
  // 対象が今どこに居るかを測る。スクロールで動いた分だけ小窓も動かす。
  track?: () => { top: number; left: number } | null;
  onSubmit: (body: string) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 開いた時点からの対象のずれ。これを足して追いかける。
  const [shift, setShift] = useState({ x: 0, y: 0 });
  // 小窓の高さ。画面の端で止めるのに要る（入力欄が伸びると変わる）。
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const from = track?.() ?? null;
    const update = () => {
      const now = track?.() ?? null;
      if (from && now) setShift({ x: now.left - from.left, y: now.top - from.top });
      else setShift({ x: 0, y: 0 });
    };
    // 本文は内側の入れ物がスクロールするので、捕捉で全部の scroll を拾う。
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [track]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const anchor = {
    top: anchorRect.top + shift.y,
    bottom: anchorRect.bottom + shift.y,
    left: anchorRect.left + shift.x,
  };
  // 画面外に出ないように寄せる
  const left = Math.min(Math.max(GAP, anchor.left), window.innerWidth - WIDTH - GAP);
  // 下に開いて下へ伸びるのが基本。書いた文が下に足されていく向きと揃う。
  // 上に開くのは、下では小窓が成り立たないほど狭く、かつ上の方が広いときだけ。
  // 向きは開いた時点で決める。書いている途中で上下が入れ替わると読めなくなる。
  const upwardRef = useRef<boolean | null>(null);
  if (upwardRef.current === null) {
    const below = window.innerHeight - anchor.bottom - GAP * 2;
    const above = anchor.top - GAP * 2;
    upwardRef.current = below < CHROME + MIN_INPUT && above > below;
  }
  const openUpward = upwardRef.current;
  // 入力欄の上限。画面に収まる高さと、画面の 45% の小さい方。
  const maxInput = Math.max(
    MIN_INPUT,
    Math.min(
      window.innerHeight - CHROME - GAP * 2,
      window.innerHeight * MAX_INPUT_RATIO,
    ),
  );
  // 対象について動き、画面の上端・下端で止まる。対象が画面から出ても、
  // 小窓は端に留まって書き続けられる。
  const wanted = openUpward ? anchor.top - GAP - height : anchor.bottom + GAP;
  const top = Math.min(
    Math.max(GAP, wanted),
    Math.max(GAP, window.innerHeight - height - GAP),
  );
  const style = { left, top, visibility: height > 0 ? "visible" : "hidden" } as const;

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
