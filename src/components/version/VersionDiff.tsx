import { useMemo, useState } from "react";
import type { Block } from "../../lib/blocks";
import { compare, unchanged, type DiffRow } from "../../lib/versions";
import { Icon } from "../Icon";
import { Markdown } from "../Markdown";

// バージョンとバージョンの差分。閲覧専用。
//
// 行ではなくブロックで突き合わせる。散文は 1 段落がソースの 1 行なので、
// 行差分では「段落全体が変わった」しか分からない。ブロックなら変更前と
// 変更後をそれぞれ描いて並べられる。
//
// 変わっていないところは畳む。同じものが延々と続くと、どこが変わったのかを
// 目で探すことになる。

export type Layout = "unified" | "split";

// 何が起きた組か。枠線の左上に出す。
const TAG: Record<string, string> = {
  changed: "書き換え",
  added: "追加",
  removed: "削除",
  meta: "見出し情報",
};

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

  if (unchanged(rows)) {
    return (
      <p className="mg-ver-note-line">
        <Icon name="check" size={15} />
        本文は同じです。
      </p>
    );
  }

  return (
    <div className="mg-ver-diff">
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
    <div className={`mg-ver-pair is-${layout}`}>
      <span className="mg-ver-tag">{TAG[row.kind]}</span>
      <Side kind="base" body={before} layout={layout} />
      <Side kind="head" body={after} layout={layout} />
    </div>
  );
}

const SIDE = {
  base: { icon: "remove", label: "変更前" },
  head: { icon: "add", label: "変更後" },
} as const;

// 変更前 / 変更後の片側。
//
// 色だけでは前後を言い分けられない（テーマによって danger とアクセントが
// 同系色になる）。記号と語を必ず添える。
//
// 片側しか無い組では、分割のときだけ「無い」ことを言う。統合では並べる相手が
// 無いので、言わなくても片側だけだと分かる。
function Side({
  kind,
  body,
  layout,
}: {
  kind: "base" | "head";
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
        <Icon name={SIDE[kind].icon} size={13} />
        {SIDE[kind].label}
      </div>
      {body}
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
