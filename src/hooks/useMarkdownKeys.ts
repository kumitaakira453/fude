import { useLayoutEffect, useRef } from "react";
import { useImeSafeEnter } from "./useImeSafeEnter";
import { continueList, linkAt, wrapWith, type Edit } from "../lib/mdInput";

// 素の入力欄で Markdown を書くための手当てを、キー操作として当てる。
// 何をどう書き換えるかは lib/mdInput が持ち、ここは入力欄との受け渡しだけ。
//
// 値は呼ぶ側の状態なので、書き換えたあとキャレットは自分で戻す。React が
// 値を描き直すまで位置は当てられないので、描画のあとに置く。
//
// 同じハンドラをプレビューの枠にも渡す。⌘⇧P で行き来できるようにするには、
// 入力欄が外れている間もキーを受ける先が要る。

export function useMarkdownKeys(
  onChange: (value: string) => void,
  onPreview?: () => void,
) {
  const ime = useImeSafeEnter();
  const back = useRef<{ el: HTMLTextAreaElement; edit: Edit } | null>(null);

  useLayoutEffect(() => {
    const wait = back.current;
    if (!wait) return;
    back.current = null;
    wait.el.setSelectionRange(wait.edit.start, wait.edit.end);
  });

  const apply = (el: HTMLTextAreaElement, edit: Edit) => {
    onChange(edit.value);
    back.current = { el, edit };
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      onPreview?.();
      return;
    }

    // ここから先は入力欄の中身を書き換える手当て。
    const el = e.currentTarget;
    if (!(el instanceof HTMLTextAreaElement)) return;
    const { value, selectionStart: from, selectionEnd: to } = el;

    if (e.key === "Enter" && !mod && !e.shiftKey) {
      // 変換の確定は改行ではない。選んでいる範囲があるときも素の改行に任せる。
      if (ime.isComposing(e) || from !== to) return;
      const next = continueList(value, from);
      if (!next) return;
      e.preventDefault();
      apply(el, next);
      return;
    }

    if (!mod || e.shiftKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      apply(el, wrapWith(value, from, to, "**"));
    } else if (key === "i") {
      e.preventDefault();
      apply(el, wrapWith(value, from, to, "*"));
    } else if (key === "k") {
      e.preventDefault();
      apply(el, linkAt(value, from, to));
    }
  };

  return {
    onKeyDown,
    onKeyUp: ime.onKeyUp,
    onCompositionStart: ime.onCompositionStart,
    onCompositionEnd: ime.onCompositionEnd,
  };
}
