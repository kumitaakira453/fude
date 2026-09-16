import { useEffect, useMemo, useRef, useState } from "react";
import type { Block } from "../../lib/blocks";
import { applyDiffMarks } from "../../lib/diffMarks";
import { compare, unchanged, type DiffRow } from "../../lib/versions";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// バージョンとバージョンの差分を、組版を通した姿で比べる。閲覧専用。
//
// 行ではなくブロックで突き合わせる。散文は 1 段落がソースの 1 行なので、
// 行差分では「段落全体が変わった」しか分からない。ブロックなら変更前と
// 変更後をそれぞれ描いて並べられる。
//
// 見立ては校正刷り。変更前は少し退けた濃さで置き、変更後を本文の濃さで読ませる。
// 枠で囲まず、左の罫と行頭の記号だけで区切る。

export type Layout = "unified" | "split";

export function VersionDiff({
  base,
  head,
  layout,
  editorial,
  style,
}: {
  base: string;
  head: string;
  layout: Layout;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  const rows = useMemo(() => compare(base, head), [base, head]);
  const root = useRef<HTMLDivElement>(null);
  // 描き終わったあとに、変わった字へ印を付ける。
  useEffect(
    () => applyDiffMarks(root.current),
    [rows, layout, editorial, style],
  );

  if (unchanged(rows)) {
    return (
      <p className="mg-ver-note-line">
        <Icon name="check" size={15} />
        本文は同じです。
      </p>
    );
  }

  return (
    <div ref={root} className="mg-ver-diff">
      {rows.map((row, i) => (
        <Row
          key={i}
          row={row}
          layout={layout}
          editorial={editorial}
          style={style}
        />
      ))}
    </div>
  );
}

function Row({
  row,
  layout,
  editorial,
  style,
}: {
  row: DiffRow;
  layout: Layout;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);

  if (row.kind === "gap") {
    if (!open) {
      return (
        <button className="mg-ver-gap" onClick={() => setOpen(true)}>
          <Icon name="unfold_more" size={14} />
          変わっていない {row.blocks.length} ブロック
        </button>
      );
    }
    return (
      <>
        <button className="mg-ver-gap is-open" onClick={() => setOpen(false)}>
          <Icon name="unfold_less" size={14} />
          畳む
        </button>
        {row.blocks.map((block) => (
          <Kept key={block.index} block={block} editorial={editorial} style={style} />
        ))}
      </>
    );
  }

  if (row.kind === "kept") {
    return <Kept block={row.block} editorial={editorial} style={style} />;
  }

  // フロントマターは本文のブロックに割れないので、書いたままの形で並べる。
  const before =
    row.kind === "meta" ? (
      <pre className="mg-ver-meta">{row.base.trim()}</pre>
    ) : "base" in row ? (
      <Prose src={row.base.src} editorial={editorial} style={style} />
    ) : null;
  const after =
    row.kind === "meta" ? (
      <pre className="mg-ver-meta">{row.head.trim()}</pre>
    ) : "head" in row ? (
      <Prose src={row.head.src} editorial={editorial} style={style} />
    ) : null;

  return (
    <div className={`mg-ver-pair is-${layout}`} data-diff-pair="" data-mg-change="">
      <Side kind="base" of={row.kind} body={before} layout={layout} />
      <Side kind="head" of={row.kind} body={after} layout={layout} />
    </div>
  );
}

const MARK = { base: "remove", head: "add" } as const;

// 何が起きたかは、片側だけの組では「追加」「削除」で言い切れる。
function labelOf(kind: "base" | "head", of: DiffRow["kind"]): string {
  if (of === "added") return "追加";
  if (of === "removed") return "削除";
  return kind === "base" ? "変更前" : "変更後";
}

// 変更前 / 変更後の片側。
//
// 色だけでは前後を言い分けられない（テーマによって danger とアクセントが
// 同系色になる）。記号と語を必ず添える。
//
// 片側しか無い組では、分割のときだけ「無い」ことを言う。統合では並べる相手が
// 無いので、言わなくても片側だけだと分かる。
function Side({
  kind,
  of,
  body,
  layout,
}: {
  kind: "base" | "head";
  of: DiffRow["kind"];
  body: React.ReactNode;
  layout: Layout;
}) {
  if (!body) {
    if (layout === "unified") return null;
    return (
      <div className="mg-ver-side is-void">
        <span>（このバージョンにはない）</span>
      </div>
    );
  }
  return (
    <div className={`mg-ver-side is-${kind}`}>
      <div className="mg-ver-side-head">
        <Icon name={MARK[kind]} size={13} />
        {labelOf(kind, of)}
      </div>
      <div data-diff-side={kind}>{body}</div>
    </div>
  );
}

// 変わっていないブロック。周りの文脈として置く。
function Kept({
  block,
  editorial,
  style,
}: {
  block: Block;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  return (
    <div className="mg-ver-kept">
      <Prose src={block.src} editorial={editorial} style={style} />
    </div>
  );
}

function Prose({
  src,
  editorial,
  style,
}: {
  src: string;
  editorial: boolean;
  style: React.CSSProperties;
}) {
  return (
    <div className={`mg-prose prose ${editorial ? "mg-editorial" : ""}`} style={style}>
      <Markdown body={src} editorial={editorial} />
    </div>
  );
}
