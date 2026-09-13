import { useEffect, useRef } from "react";
import { useImeSafeEnter } from "../hooks/useImeSafeEnter";

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// テーブルの 1 セルだけをその場で編集する軽量エディタ。
// セルのソース Markdown（`**bold**` や `code` も可）を編集し、
// Enter / blur で確定、Esc で取消。改行はセルに入れられないため Enter=確定。
export function CellEditor({
  value,
  onCommit,
  onCancel,
}: {
  value: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);
  // 変換の確定に使った Enter で確定させない。確定してしまうと入力欄が消える
  // 一方で IME は確定した字をもう一度入れにくるので、同じ文が二重に残る。
  const ime = useImeSafeEnter();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autosize(el);
    // 表は枠の中で横にスクロールする。足したばかりの列は枠の外に出るので、
    // 入ったセルが見える位置まで寄せる。列を足した直後は表が組み直されている
    // 途中なので、1 フレーム置いてから測る。
    const at = requestAnimationFrame(() => {
      (el.closest("td, th") ?? el).scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    });
    return () => cancelAnimationFrame(at);
  }, []);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(ref.current?.value ?? value);
  };
  return (
    <textarea
      ref={ref}
      className="mg-cell-editor"
      defaultValue={value}
      rows={1}
      spellCheck={false}
      onInput={(e) => autosize(e.currentTarget)}
      onKeyUp={ime.onKeyUp}
      onCompositionStart={ime.onCompositionStart}
      onCompositionEnd={ime.onCompositionEnd}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          if (ime.isComposing(e)) return;
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          committed.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
    />
  );
}
