import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

// リンクを指したときに出す札。行き先を見せ、写しと打ち直しの入口を置く。
//
// 本文の中のリンクは、選び直さないと行き先を確かめられなかった（帯は文字を
// 選んでから出るので、リンクそのものを相手にできない）。

export function LinkCard({
  href,
  at,
  onEdit,
  onEnter,
  onLeave,
}: {
  href: string;
  // 出す場所。リンクの左下。ビューポート座標。
  at: { left: number; top: number };
  onEdit: () => void;
  // 札へ手を運ぶ間に消えないよう、出している側へ知らせる。
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* 写せない環境では何もしない */
    }
  };

  return createPortal(
    <div
      className="mg-link-card"
      style={{ left: at.left, top: at.top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <Icon name="language" size={15} className="mg-link-globe" />
      <a className="mg-link-href" href={href} target="_blank" rel="noreferrer">
        {href}
      </a>
      <Tooltip label={copied ? "写した" : "行き先を写す"} side="bottom" tone="dark">
        <button type="button" aria-label="行き先を写す" onClick={() => void copy()}>
          <Icon name={copied ? "check" : "content_copy"} size={15} />
        </button>
      </Tooltip>
      <button type="button" className="mg-link-edit" onClick={onEdit}>
        編集
      </button>
    </div>,
    document.body,
  );
}
