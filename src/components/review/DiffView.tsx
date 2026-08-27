import { useEffect, useRef } from "react";
import type { BlockChange } from "../../lib/blockDiff";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// 指摘した時点の版と現在の版の差分を、文脈ごと描画して見せる。
//
// ブロック 1 つだけを切り出しても、それが文書のどこの話でどう変わったのかは
// 判断できない。前後の変わっていないブロックも含めて並べ、変わった箇所だけを
// 指摘時と現在の 2 段で示す。

const BEFORE = 4; // 対象ブロックの前に添える文脈の数
const AFTER = 8; // 対象ブロックの後に添える文脈の数
const MAX_UNLOCATED = 12; // 対象が特定できないときに出す変更の上限

export interface DiffWindow {
  entries: { change: BlockChange; isTarget: boolean }[];
  omittedBefore: number;
  omittedAfter: number;
  located: boolean;
  totalChanges: number;
}

// 表示する範囲を決める。文書全体を一度に描くと大きなファイルで固まるため、
// 対象の周辺に絞る。
export function diffWindow(diff: BlockChange[], targetIndex: number): DiffWindow {
  const totalChanges = diff.filter((c) => c.kind !== "same").length;

  if (targetIndex >= 0) {
    const from = Math.max(0, targetIndex - BEFORE);
    const to = Math.min(diff.length, targetIndex + AFTER + 1);
    return {
      entries: diff.slice(from, to).map((change, i) => ({
        change,
        isTarget: from + i === targetIndex,
      })),
      omittedBefore: from,
      omittedAfter: diff.length - to,
      located: true,
      totalChanges,
    };
  }

  // 対象が特定できないときは、変わった箇所だけを並べる
  const changes = diff.filter((c) => c.kind !== "same").slice(0, MAX_UNLOCATED);
  return {
    entries: changes.map((change) => ({ change, isTarget: false })),
    omittedBefore: 0,
    omittedAfter: Math.max(0, totalChanges - changes.length),
    located: false,
    totalChanges,
  };
}

export function DiffView({
  window: win,
  editorial,
  style,
}: {
  window: DiffWindow;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "center" });
  }, [win]);

  if (win.entries.length === 0) {
    return (
      <p className="text-[12px] text-[var(--mg-muted)]">
        指摘した時点から、この文書は変わっていません。
      </p>
    );
  }

  return (
    <div>
      {!win.located && (
        <Note icon="help">
          指摘の対象がどのブロックか特定できませんでした。この文書で変わった箇所を
          {win.totalChanges} 件のうち {win.entries.length} 件まで並べています。
        </Note>
      )}
      {win.located && win.omittedBefore > 0 && (
        <Note icon="more_horiz">前に {win.omittedBefore} ブロック省略</Note>
      )}

      {win.entries.map(({ change, isTarget }, i) => (
        <div
          key={i}
          ref={isTarget ? targetRef : undefined}
          className={
            isTarget
              ? "-mx-3 mb-2 rounded-xl px-3 py-1 ring-2 ring-[color-mix(in_srgb,var(--mg-accent)_45%,transparent)]"
              : "mb-2"
          }
        >
          <Entry change={change} editorial={editorial} style={style} />
        </div>
      ))}

      {win.located && win.omittedAfter > 0 && (
        <Note icon="more_horiz">後ろに {win.omittedAfter} ブロック省略</Note>
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
    // 変わっていないブロックは文脈として淡く出す
    return (
      <div className="mg-prose prose opacity-60" style={style}>
        <Markdown body={change.head.src} editorial={editorial} />
      </div>
    );
  }

  if (change.kind === "added") {
    return (
      <Framed tone="add" label="追加">
        <div className="mg-prose prose" style={style}>
          <Markdown body={change.head.src} editorial={editorial} />
        </div>
      </Framed>
    );
  }

  if (change.kind === "removed") {
    return (
      <Framed tone="del" label="削除">
        <div className="mg-prose prose opacity-70" style={style}>
          <Markdown body={change.base.src} editorial={editorial} />
        </div>
      </Framed>
    );
  }

  return (
    <div className="space-y-1.5">
      <Framed tone="del" label="指摘した時点">
        <div className="mg-prose prose opacity-70" style={style}>
          <Markdown body={change.base.src} editorial={editorial} />
        </div>
      </Framed>
      <Framed tone="add" label="現在">
        <div className="mg-prose prose" style={style}>
          <Markdown body={change.head.src} editorial={editorial} />
        </div>
      </Framed>
    </div>
  );
}

function Framed({
  tone,
  label,
  children,
}: {
  tone: "add" | "del";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mg-diff mg-diff-${tone}`}>
      <div className="mg-diff-label">{label}</div>
      {children}
    </div>
  );
}

function Note({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="my-2 flex items-center gap-1.5 text-[11.5px] text-[var(--mg-muted)]">
      <Icon name={icon} size={14} />
      {children}
    </p>
  );
}
