import { startTransition, useEffect, useRef, useState } from "react";
import type { BlockChange } from "../../lib/blockDiff";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// 文書をブロック単位で描画する。差分がある場合は変わった箇所を
// 指摘時と現在の 2 段で示す。
//
// 対象の周辺だけを切り出すと、それが文書のどこの話なのか分からなくなるため
// 全体を出す。全ブロックを 1 回のペイントで描くと大きなファイルで固まるので、
// 本文と同じく先頭から順に足していく。

const FIRST_CHUNK = 24;
const NEXT_CHUNK = 40;

export function DiffView({
  diff,
  targetIndex,
  note,
  editorial,
  style,
}: {
  diff: BlockChange[];
  targetIndex: number;
  note: string;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  const [limit, setLimit] = useState(FIRST_CHUNK);
  const targetRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  useEffect(() => {
    setLimit(FIRST_CHUNK);
    scrolledRef.current = false;
  }, [diff]);

  useEffect(() => {
    if (limit >= diff.length) return;
    const id = requestAnimationFrame(() => {
      startTransition(() => setLimit((n) => Math.min(n + NEXT_CHUNK, diff.length)));
    });
    return () => cancelAnimationFrame(id);
  }, [limit, diff.length]);

  // 対象が描画された時点で 1 度だけそこへ寄せる。対象が特定できていなければ
  // 最初に変わった箇所へ寄せる。
  const firstChanged = diff.findIndex((c) => c.kind !== "same");
  const scrollTo = targetIndex >= 0 ? targetIndex : firstChanged;

  useEffect(() => {
    if (scrolledRef.current || !targetRef.current) return;
    scrolledRef.current = true;
    targetRef.current.scrollIntoView({ block: "center" });
  }, [limit]);

  if (diff.length === 0) {
    return (
      <p className="text-[12px] text-[var(--mg-muted)]">この文書は空です。</p>
    );
  }

  const shown = limit >= diff.length ? diff : diff.slice(0, limit);

  return (
    <div>
      <p className="mb-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--mg-muted)]">
        <Icon name="difference" size={14} className="mt-px shrink-0" />
        {note}
      </p>

      {shown.map((change, i) => (
        <div
          key={i}
          ref={i === scrollTo ? targetRef : undefined}
          className={i === targetIndex ? "mg-diff-target mb-2" : "mb-2"}
        >
          <Entry change={change} editorial={editorial} style={style} />
        </div>
      ))}

      {limit < diff.length && (
        <p className="py-2 text-[11.5px] text-[var(--mg-muted)]">
          残り {diff.length - limit} ブロックを読み込んでいます…
        </p>
      )}
    </div>
  );
}

function Entry({
  change,
  editorial,
  style,
}: {
  change: BlockChange;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  if (change.kind === "same") {
    return (
      <div className="mg-prose prose" style={style}>
        <Markdown body={change.head.src} editorial={editorial} />
      </div>
    );
  }

  if (change.kind === "added") {
    return (
      <Framed tone="add" label="追加" style={style}>
        <Markdown body={change.head.src} editorial={editorial} />
      </Framed>
    );
  }

  if (change.kind === "removed") {
    return (
      <Framed tone="del" label="削除" style={style}>
        <Markdown body={change.base.src} editorial={editorial} />
      </Framed>
    );
  }

  return (
    <div className="space-y-1.5">
      <Framed tone="del" label="指摘した時点" style={style}>
        <Markdown body={change.base.src} editorial={editorial} />
      </Framed>
      <Framed tone="add" label="現在" style={style}>
        <Markdown body={change.head.src} editorial={editorial} />
      </Framed>
    </div>
  );
}

function Framed({
  tone,
  label,
  style,
  children,
}: {
  tone: "add" | "del";
  label: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div className={`mg-diff mg-diff-${tone}`}>
      <div className="mg-diff-label">{label}</div>
      <div className="mg-prose prose" style={style}>
        {children}
      </div>
    </div>
  );
}
