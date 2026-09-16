import { useState } from "react";
import { createPortal } from "react-dom";
import { copyText } from "../lib/clip";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

// リンクを指したときに出す札。行き先を見せ、写しと打ち直しの入口を置く。
//
// 本文の中のリンクは、選び直さないと行き先を確かめられなかった（帯は文字を
// 選んでから出るので、リンクそのものを相手にできない）。

export function LinkCard({
  href,
  at,
  onOpen,
  onEdit,
}: {
  href: string;
  // 出す場所。リンクの左下。ビューポート座標。
  at: { left: number; top: number };
  // 行き先へ進む。窓に任せると、アプリの中の道筋まで外のブラウザで開く。
  onOpen: () => void;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!(await copyText(href))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return createPortal(
    <div className="mg-link-card" style={{ left: at.left, top: at.top }}>
      <Icon name="language" size={15} className="mg-link-globe" />
      <button type="button" className="mg-link-href" onClick={onOpen} title="開く">
        {href}
      </button>
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
