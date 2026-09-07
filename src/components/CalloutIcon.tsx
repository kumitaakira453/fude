import { useEffect, useState } from "react";
import { EmojiBoard } from "./EmojiBoard";

// コールアウトのアイコンを選び直す盤と、読むときの掴み方。
//
// 盤（IconBoard）は出す場所と選ばれたときの手だけを受け取る。読むときはアイコンが
// 生 HTML から出るので React の要素として掴めず、目印（data-mg-callout-ico）への
// 押下を本文ごと拾って盤を出す。編集面は節点を持っているので、掴み方は向こうにある。

// 囲みのアイコンを選ぶ盤。中身は本文の絵文字と同じものを使い、ここでは
// 「アイコンを外す」の口だけを足す。
export function IconBoard({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  // 選んだアイコン。空文字はアイコンを外す。
  onPick: (icon: string) => void;
  onClose: () => void;
}) {
  return (
    <EmojiBoard
      x={x}
      y={y}
      onPick={onPick}
      onClear={() => onPick("")}
      onClose={onClose}
    />
  );
}

export function CalloutIcon({
  content,
  contentKey,
  onPick,
}: {
  content: HTMLElement | null;
  contentKey: string;
  // 選んだアイコン。空文字はアイコンを外す。
  onPick: (blockIndex: number, icon: string) => void;
}) {
  // seq は開くたびに増やす。盤を作り直させて、前に打った絞り込みを持ち越さない。
  const [open, setOpen] = useState<{
    seq: number;
    index: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => setOpen(null), [contentKey]);

  useEffect(() => {
    if (!content) return;
    const onClick = (e: MouseEvent) => {
      const ico = (e.target as Element | null)?.closest?.(
        "[data-mg-callout-ico]",
      );
      if (!ico) return;
      const blockEl = ico.closest("[data-mg-block]");
      const index = Number(blockEl?.getAttribute("data-mg-block"));
      if (!Number.isFinite(index)) return;
      e.preventDefault();
      e.stopPropagation();
      const box = ico.getBoundingClientRect();
      setOpen((was) => ({
        seq: (was?.seq ?? 0) + 1,
        index,
        x: box.left,
        y: box.bottom + 6,
      }));
    };
    content.addEventListener("click", onClick);
    return () => content.removeEventListener("click", onClick);
  }, [content]);

  if (!open) return null;

  return (
    <IconBoard
      key={open.seq}
      x={open.x}
      y={open.y}
      onPick={(icon) => {
        onPick(open.index, icon);
        setOpen(null);
      }}
      onClose={() => setOpen(null)}
    />
  );
}
