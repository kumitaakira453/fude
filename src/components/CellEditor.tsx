import { useEffect, useRef } from "react";

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
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    autosize(el);
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
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
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
