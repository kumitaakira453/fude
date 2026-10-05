import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyText } from "../lib/clip";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";

// リンクを指したときに出す札。行き先を見せ、写しと打ち直しの入口を置く。
//
// 本文の中のリンクは、選び直さないと行き先を確かめられなかった（帯は文字を
// 選んでから出るので、リンクそのものを相手にできない）。

// 窓の縁から空けておく幅。
const EDGE = 8;

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
  const ref = useRef<HTMLDivElement>(null);
  // 窓の右端に近いリンクでは、左下に置くと札がはみ出す。測ってから内側へ寄せる。
  const [left, setLeft] = useState(at.left);
  useLayoutEffect(() => {
    const width = ref.current?.offsetWidth ?? 0;
    const room = window.innerWidth - EDGE;
    setLeft(Math.max(EDGE, Math.min(at.left, room - width)));
  }, [at.left, href]);

  const copy = async () => {
    if (!(await copyText(href))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return createPortal(
    <div ref={ref} className="mg-link-card" style={{ left, top: at.top }}>
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
