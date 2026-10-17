import type { CSSProperties, ReactNode, Ref } from "react";
import { FileIcon } from "./FileIcon";

// 探して選ぶ一覧（⌘J・札の ＋・⌘L）の入れ物。左に一覧、右に選んでいる行の中身を
// 並べる。中身は呼び出し側が組み、ここは寸法と幕・閉じ方だけを持つ。
//
// 右の中身は説明文を書かず、種類・名前・要点・節だけを並べる（PickDetail）。
export function PickPanel({
  label,
  onClose,
  head,
  list,
  listRef,
  detail,
  paper = false,
  foot,
}: {
  // 読み上げ用の名前。渡すと dialog として名乗る。
  label?: string;
  onClose: () => void;
  // 入力欄の段（.mg-pal-in）。
  head: ReactNode;
  list: ReactNode;
  listRef?: Ref<HTMLDivElement>;
  // 右の中身。null なら右の欄ごと出さない（フォルダを選ぶ段の間など）。
  detail: ReactNode | null;
  // 右の中身を欄の線で区切らず、紙として浮かせる（⌘P の本文の頭）。
  paper?: boolean;
  foot?: ReactNode;
}) {
  return (
    <div
      className="mg-scrim fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role={label ? "dialog" : undefined}
        aria-label={label}
        className={`mg-pop mg-pal is-wide${paper ? " is-paper" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {head}
        <div
          className={`mg-pal-split${detail === null ? " is-single" : ""}${paper ? " is-paper" : ""}`}
        >
          <div ref={listRef} className="mg-pick-list mg-pal-list">
            {list}
          </div>
          {detail !== null && <aside className="mg-pal-detail">{detail}</aside>}
        </div>
        {foot}
      </div>
    </div>
  );
}

// 右の中身。見出しの段に名前と要点の 1 行、その下に節を並べる。色を渡すと、
// 見出しの段の上端にその色の帯を引き、地をその色から下へ薄れさせる。
// 値の無い要点と、中身の無い節は出さない。
export function PickDetail({
  color,
  icon,
  title,
  facts = [],
  sections = [],
  body,
}: {
  // 見出しの段の色（CSS の色の値）。
  color?: string;
  // 名前の前に置く絵。
  icon?: ReactNode;
  title: ReactNode;
  // 数字は呼び出し側で <b> に包むと濃く出る。
  facts?: ReactNode[];
  sections?: [string, ReactNode][];
  // 節の後ろに見出し無しで置く中身（⌘P の本文の頭など）。
  body?: ReactNode;
}) {
  const shownFacts = facts.filter((f) => f !== null && f !== undefined && f !== false && f !== "");
  const shownSections = sections.filter(([, content]) => content !== null && content !== undefined);
  return (
    <>
      <div
        className={`mg-pal-detail-head${color ? " is-tinted" : ""}`}
        style={color ? ({ "--mg-tint": color } as CSSProperties) : undefined}
      >
        <div className="mg-pal-detail-title">
          {icon}
          <span>{title}</span>
        </div>
        {shownFacts.length > 0 && (
          <div className="mg-pal-detail-facts">
            {shownFacts.map((f, i) => (
              <span key={i}>{f}</span>
            ))}
          </div>
        )}
      </div>
      {shownSections.map(([label, content]) => (
        <section key={label} className="mg-pal-detail-sec">
          <h4>{label}</h4>
          {content}
        </section>
      ))}
      {body && <div className="mg-pal-detail-body">{body}</div>}
    </>
  );
}

// 道筋。最後の名前を濃く、上の階層を淡く出す。
export function PathText({ path }: { path: string }) {
  const cut = path.lastIndexOf("/") + 1;
  return (
    <span className="mg-pal-detail-path">
      <span className="is-up">{path.slice(0, cut)}</span>
      <span className="is-leaf">{path.slice(cut)}</span>
    </span>
  );
}

// 道筋の並び（ワークスペースの根など）。
export function PathList({ paths }: { paths: string[] }) {
  return (
    <div className="mg-pal-detail-paths">
      {paths.map((p) => (
        <PathText key={p} path={p} />
      ))}
    </div>
  );
}

// ファイル名の並び。種類の顔を付け、先頭から max 件と「ほか N 件」で出す。
export function FileNames({ names, max = 8 }: { names: string[]; max?: number }) {
  if (names.length === 0) return null;
  return (
    <ul className="mg-pal-detail-files">
      {names.slice(0, max).map((n, i) => (
        <li key={`${n}-${i}`}>
          <FileIcon name={n} size={14} />
          <span className="mg-pal-detail-fname">{n}</span>
        </li>
      ))}
      {names.length > max && <li className="is-more">ほか {names.length - max} 件</li>}
    </ul>
  );
}
