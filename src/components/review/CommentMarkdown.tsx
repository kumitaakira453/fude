import type { CSSProperties } from "react";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// コメントを Markdown として読む・書くための部品。
//
// 本文は書いた記法のまま台帳に残り、出すときだけ組版する。書く側は素の記法を
// 打つ入力欄のままで、書いたものの見た目は「見る」に切り替えて確かめる。
// 切り替えのボタンは呼ぶ側の足元に置く（並びが場所ごとに違う）。

// 済んだコメントの本文。
export function CommentBody({
  body,
  className,
}: {
  body: string;
  className?: string;
}) {
  return (
    <div
      className={`mg-md mg-prose prose${className ? ` ${className}` : ""}`}
      // 押せる札の中に置かれることもある（ホバーカード）。本文のリンクは
      // リンクとして働かせ、札の操作までは届かせない。
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) e.stopPropagation();
      }}
    >
      <Markdown body={body} editorial={false} breaks />
    </div>
  );
}

// 書いている途中のものを、出したときの姿で見せる。
export function CommentPreview({
  body,
  style,
}: {
  body: string;
  style?: CSSProperties;
}) {
  const text = body.trim();
  return (
    <div className="mg-md-preview mg-md mg-prose prose" style={style}>
      {text ? (
        <Markdown body={text} editorial={false} breaks />
      ) : (
        <span className="mg-md-blank">まだ何も書いていません</span>
      )}
    </div>
  );
}

export function PreviewToggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={on ? "記法を書く" : "書いたものを見る"}
      className={`mg-md-toggle${on ? " is-on" : ""}`}
    >
      <Icon name={on ? "edit" : "visibility"} size={13} />
      {on ? "書く" : "見る"}
    </button>
  );
}
