import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { GRAMMARS } from "../lib/md/grammars";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import { splitHref } from "../lib/anchors";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CellEditor } from "./CellEditor";
import { CodeBlock } from "./CodeBlock";
import { Icon } from "./Icon";
import { markdownContext } from "./MarkdownContext";
import { CALLOUT_RE } from "../lib/callout";
import { openHtmlContainers } from "../lib/htmlBlocks";
import { remarkSoftBreaks } from "../lib/md/softBreaks";
import { rehypeSummaryInline } from "../lib/md/summaryInline";
import { foldKey, recallFold, rememberFold } from "../lib/folds";
import { MdImage } from "./MdImage";
import { Mermaid } from "./Mermaid";

const remarkPlugins = [
  remarkGfm,
  // 日本語で **強調（かっこ)**を数える のように閉じ記号の直後が CJK 文字だと
  // CommonMark のフランキング規則で太字が成立しない問題を解消する
  remarkCjkFriendly,
  remarkMath,
  [remarkFrontmatter, ["yaml"]] as const,
];
// 単独の改行を改行として描く構成。会話に近いもの（コメント）に使う。
// 並びはモジュールで持つ。描画のたびに新しい配列を渡すと、react-markdown が
// 同じ本文でも作り直す。
const remarkPluginsWithBreaks = [...remarkPlugins, remarkSoftBreaks];
const rehypePlugins = [
  rehypeRaw,
  rehypeSummaryInline,
  rehypeSlug,
  rehypeKatex,
  // detect は付けない。言語指定のないコードフェンス 1 個ごとに highlight.js の
  // 言語自動判定が走り、全登録文法との照合で約 90ms かかる。本文はブロック単位に
  // 分けて描画するため、この分だけでファイルを開くのに数秒かかっていた。
  // 言語指定ありのフェンスは従来どおり色が付く。
  // 語彙は編集面と同じ一覧（lib/md/grammars）に揃える。片方だけ狭いと、
  // 書いている間は色が付いた言語が読むときに素になる。
  [rehypeHighlight, { ignoreMissing: true, languages: GRAMMARS }] as const,
];

// トグル。開いて始めるかは原文のタグで決まり、押して変えた分はファイルを
// 開いているあいだ覚える。
function Toggle({
  node,
  open,
  children,
}: {
  node?: unknown;
  open?: boolean;
  children?: ReactNode;
}) {
  const ctx = useContext(markdownContext);
  const key = foldKey(ctx?.docPath ?? null, summaryText(node));
  const [shown, setShown] = useState(() => recallFold(key, open === true));
  return (
    <details
      className={hollow(node) ? "is-empty" : undefined}
      open={shown}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setShown(next);
        rememberFold(key, next);
      }}
    >
      {children}
    </details>
  );
}

// 題のほかに中身が無いか。開けるものが無いトグルは薄く描く。
function hollow(node: unknown): boolean {
  const kids = (node as { children?: HastChild[] } | undefined)?.children ?? [];
  return kids.every((c) => c.tagName === "summary" || !textOf(c).trim());
}

// トグルの題の字。鍵に使うので、印の中の字も拾って繋げる。
function summaryText(node: unknown): string {
  const kids = (node as { children?: HastChild[] } | undefined)?.children ?? [];
  const head = kids.find((c) => c.tagName === "summary");
  return head ? textOf(head) : "";
}

function textOf(node: HastChild): string {
  if (node.type === "text") return node.value ?? "";
  return ((node as { children?: HastChild[] }).children ?? [])
    .map(textOf)
    .join("");
}

function childrenToString(children: ReactNode): string {
  return Children.toArray(children)
    .map((c) => {
      if (typeof c === "string") return c;
      if (isValidElement(c))
        return childrenToString((c.props as { children?: ReactNode }).children);
      return "";
    })
    .join("");
}

// ---- エディトリアル組版（ベータ）用のヘルパー ----

const CALLOUT: Record<string, { k: string; cls: string; icon: string }> = {
  NOTE: { k: "Note", cls: "note", icon: "info" },
  TIP: { k: "Tip", cls: "tip", icon: "lightbulb" },
  IMPORTANT: { k: "Important", cls: "important", icon: "priority_high" },
  WARNING: { k: "Warning", cls: "warning", icon: "warning" },
  CAUTION: { k: "Caution", cls: "caution", icon: "report" },
};

// blockquote 先頭の [!TYPE] マーカーを表示から取り除く
function stripCalloutMarker(children: ReactNode): ReactNode {
  const arr = Children.toArray(children);
  let done = false;
  return arr.map((child) => {
    if (done) return child;
    if (typeof child === "string") {
      done = true;
      return child.replace(/^\s*\[![^\]]+\]\s*\n?/, "");
    }
    if (isValidElement(child)) {
      done = true;
      const el = child as ReactElement<{ children?: ReactNode }>;
      const kids = Children.toArray(el.props.children).map((k, j) =>
        j === 0 && typeof k === "string"
          ? k.replace(/^\s*\[![^\]]+\]\s*\n?/, "")
          : k,
      );
      return cloneElement(el, undefined, kids);
    }
    return child;
  });
}

// タスクのチェックボックス。クリック直後に見た目を反転させ（楽観的更新）、
// 保存 → 再パースの往復を待たせない。markdown 側が更新されるとブロックごと
// 再マウントされるため、このローカル状態は自然に破棄される。
function TaskCheck({
  checked,
  onToggle,
}: {
  checked: boolean;
  // 押されたボタンを渡す。どのブロックのタスクかは、呼ばれた側が
  // この要素から辿る（ブロック番号を props で配ると、番号がずれるたびに
  // 全ブロックの再描画になる）。
  onToggle?: (el: HTMLElement) => void;
}) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const on = optimistic ?? checked;
  const icon = on ? "check_box" : "check_box_outline_blank";
  if (!onToggle) {
    return (
      <span className="mg-task-check" aria-hidden>
        <Icon name={icon} size={20} fill={on} />
      </span>
    );
  }
  return (
    <button
      type="button"
      className="mg-task-check"
      aria-label={on ? "未完了に戻す" : "完了にする"}
      onClick={(e) => {
        setOptimistic(!on);
        // 線と色は項目に付くので、そちらも押した瞬間に進める。本文を組み
        // 直したときに同じ値が入り直る。
        e.currentTarget.closest("li")?.setAttribute("data-checked", String(!on));
        onToggle(e.currentTarget);
      }}
    >
      <Icon name={icon} size={20} fill={on} />
    </button>
  );
}

function Callout({ type, children }: { type: string; children: ReactNode }) {
  const c = CALLOUT[type] ?? CALLOUT.NOTE;
  return (
    <div className={`mg-callout ${c.cls}`}>
      <span className="mg-callout-ico">
        <Icon name={c.icon} size={17} fill />
      </span>
      <div className="mg-callout-body">
        <div className="mg-callout-k">{c.k}</div>
        {children}
      </div>
    </div>
  );
}

function LinkCard({ href, text }: { href: string; text: string }) {
  let domain = href;
  try {
    domain = new URL(href).hostname.replace(/^www\./, "");
  } catch {
    /* URL パース不能ならそのまま表示 */
  }
  return (
    <a
      className="mg-linkcard"
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void openUrl(href);
      }}
    >
      <span className="mg-lc-fav">
        <Icon name="link" size={17} />
      </span>
      <span className="mg-lc-t">
        <b>{text || href}</b>
        <span>{domain}</span>
      </span>
    </a>
  );
}

// 段落の中身が「単一の外部リンクだけ」かを判定し、リンク情報を返す
function standaloneLink(
  children: ReactNode,
): { href: string; text: string } | null {
  const sig = Children.toArray(children).filter(
    (c) => !(typeof c === "string" && c.trim() === ""),
  );
  if (sig.length !== 1 || !isValidElement(sig[0])) return null;
  const props = (sig[0] as ReactElement).props as {
    href?: string;
    children?: ReactNode;
  };
  if (typeof props.href === "string" && /^https?:/.test(props.href)) {
    return { href: props.href, text: childrenToString(props.children) };
  }
  return null;
}

// スクロール等での親再レンダー時に再パースしないよう body でメモ化する。
// （再パースは画像 blob の revoke や mermaid のチカチカを引き起こす）
export interface CellEditInfo {
  blockIndex: number;
  cellStart: number;
  colIndex: number;
  rowKind: "head" | "body";
  rowIndex: number;
}

// ダブルクリックされた箇条書き項目の位置。実際に編集するソース範囲は
// EditableBody がこの位置を含む行から求める（マーカーとネスト項目は除く）。
export interface ItemEditInfo {
  blockIndex: number;
  anchor: number;
}

interface HastChild {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: { checked?: boolean };
  children?: HastChild[];
  // 合成ノードでは position ごと、あるいは start / end が欠けることがある
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

// 項目の中に入っている並び。組んだあとの要素から見分ける。上書きを通した
// ものには元の節点が付いてくるので、そちらも見る。
function isNestedList(kid: ReactNode): boolean {
  if (!isValidElement<{ node?: HastChild }>(kid)) return false;
  if (kid.type === "ul" || kid.type === "ol") return true;
  const tag = kid.props.node?.tagName;
  return tag === "ul" || tag === "ol";
}

// タスクの項目か。そうならチェックの状態を返す。組んだあとの子からは
// 見分けが付かないので、元の節点に残っている checkbox から拾う。
function itemChecked(node: unknown): boolean | null {
  const box = (node as HastChild | null)?.children?.find(
    (c) => c.type === "element" && c.tagName === "input",
  );
  return box ? !!box.properties?.checked : null;
}

// 項目の開始オフセット。実際に編集する範囲は EditableBody 側がソースの行から
// 決めるので、ここでは「どの項目か」を特定できる位置だけを返す。
// rehype-raw / rehype-katex を通すと子ノードの position が落ちることがあるため、
// li 自身の position を基点にする。
function itemAnchor(node: unknown, back: (at: number) => number): number | null {
  const n = node as HastChild | null | undefined;
  const s = n?.position?.start?.offset;
  return typeof s === "number" ? back(s) : null;
}

export const Markdown = memo(function Markdown({
  body,
  editorial,
  breaks,
  onToggleTask,
  editCell,
  onCellCommit,
  onCellCancel,
  editItem,
  onItemCommit,
  onItemCancel,
}: {
  body: string;
  editorial: boolean;
  // 単独の改行を改行として描くか。文書では空白に潰すのが正しいが、
  // コメントでは Enter は改行の意図で押される。
  breaks?: boolean;
  // タスクチェックボックスのトグル用（ブロック内の何番目のタスクかと、
  // 押されたボタン）。渡されないときはチェックボックスを押せなくする。
  onToggleTask?: (ordinal: number, el: HTMLElement) => void;
  // テーブルのセル単位編集。編集対象セルは cellStart（ソース内オフセット）で特定。
  editCell?: { cellStart: number; value: string } | null;
  onCellCommit?: (v: string) => void;
  onCellCancel?: () => void;
  // 箇条書きの項目単位編集。編集対象は項目の開始オフセットで特定。
  editItem?: { anchor: number; value: string } | null;
  onItemCommit?: (v: string) => void;
  onItemCancel?: () => void;
}) {
  const ctx = useContext(markdownContext);
  // レンダーごとにリセットされるチェックボックスの通し番号
  const taskSeq = { n: 0 };

  // 行だけのタグで囲まれた塊は、そのままでは中の markdown が読まれない。
  // 描画にはほどいた文字列を渡す。
  const opened = useMemo(() => openHtmlContainers(body), [body]);
  // ほどくと文字数が動く。位置を頼りにする目印（セル・項目）は、原文の位置へ
  // 戻してから持たせる。ずれた目印で編集すると、別の場所を書き換えてしまう。
  const back = opened.back;

  // td/th 共通のレンダリング。編集対象セルはインラインエディタに差し替える。
  const renderCell = (
    tag: "td" | "th",
    node: unknown,
    children: ReactNode,
    rest: Record<string, unknown>,
  ) => {
    const Tag = tag;
    const at = (node as { position?: { start?: { offset?: number } } })
      ?.position?.start?.offset;
    const start = at === undefined ? undefined : back(at);
    if (editCell && start !== undefined && editCell.cellStart === start) {
      return (
        <Tag {...rest}>
          <div className="mg-cell mg-cell-editing">
            <CellEditor
              value={editCell.value}
              onCommit={(v) => onCellCommit?.(v)}
              onCancel={() => onCellCancel?.()}
            />
          </div>
        </Tag>
      );
    }
    return (
      // 選択からこのセルを特定するための目印。値は描画側が持っている
      // 正確なソースオフセットで、セル編集の照合にそのまま使える。
      <Tag {...rest} data-mg-cell={start}>
        <div className="mg-cell">{children}</div>
      </Tag>
    );
  };

  return (
    <ReactMarkdown
      // @ts-expect-error remark/rehype プラグインのタプル型は緩めに扱う
      remarkPlugins={breaks ? remarkPluginsWithBreaks : remarkPlugins}
      // @ts-expect-error 同上
      rehypePlugins={rehypePlugins}
      components={{
        code({ node: _node, className, children, ...props }) {
          const match = /language-([\w-]+)/.exec(className || "");
          if (match?.[1] === "mermaid") {
            return (
              <Mermaid code={childrenToString(children).replace(/\n$/, "")} />
            );
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        pre({ children }) {
          const child = Children.toArray(children)[0];
          if (isValidElement(child)) {
            const cls = (child.props as { className?: string }).className || "";
            if (/language-mermaid/.test(cls)) return <>{children}</>;
            const match = /language-([\w-]+)/.exec(cls);
            return (
              <CodeBlock language={match?.[1] ?? null}>{children}</CodeBlock>
            );
          }
          return <pre>{children}</pre>;
        },
        details: Toggle,
        p({ children }) {
          // 単独の外部リンク → リンクカード
          if (editorial) {
            const link = standaloneLink(children);
            if (link) return <LinkCard href={link.href} text={link.text} />;
          }
          return <p>{children}</p>;
        },
        blockquote({ children }) {
          if (editorial) {
            const m = CALLOUT_RE.exec(childrenToString(children));
            if (m) {
              return (
                <Callout type={m[1].toUpperCase()}>
                  {stripCalloutMarker(children)}
                </Callout>
              );
            }
            return <blockquote className="mg-pull">{children}</blockquote>;
          }
          return <blockquote>{children}</blockquote>;
        },
        ol({ children, start }) {
          // 番号は CSS の counter で描く。counter は start 属性を見ないので、
          // 途中から始まる並びは変数でも渡す。
          const from = typeof start === "number" ? start : 1;
          return (
            <ol
              className={editorial ? "mg-steps" : undefined}
              start={from === 1 ? undefined : from}
              style={from === 1 ? undefined : ({ "--mg-start": from - 1 } as CSSProperties)}
            >
              {children}
            </ol>
          );
        },
        // 箇条書きはリスト全体ではなくダブルクリックした 1 項目だけを編集する。
        li({ node, children, ...rest }) {
          const anchor = itemAnchor(node, back);
          const checked = itemChecked(node);
          // 済みの項目は字を薄くして線を引く（index.css）。
          const done = checked === null ? undefined : String(checked);
          if (editItem && anchor !== null && editItem.anchor === anchor) {
            // チェックは編集の対象ではないが、消さずに残す。消えると、
            // どの項目を直しているのか分からなくなる。押せる状態のまま
            // 残すと、押した拍子に確定が走るので飾りとして描き直す。
            // 子は描画済みの要素で、チェックは input の上書きが作ったもの。
            // 型では見分けられないので props で拾う。
            const box = Children.toArray(children).find(
              (c) =>
                isValidElement<{ type?: string }>(c) &&
                c.props.type === "checkbox",
            );
            const checked =
              isValidElement<{ checked?: boolean }>(box) && !!box.props.checked;
            return (
              // 横に並べる指定はチェックがある行だけ（has-check）。箇条書きの
              // 行に付けると list-item でなくなり、記号（•）が消える。チェックの
              // 行はもともと記号を出さないので、付けても失うものが無い。
              <li
                {...rest}
                data-checked={done}
                className={
                  [rest.className, "mg-item-editing", box ? "has-check" : null]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              >
                {box ? <TaskCheck checked={checked} /> : null}
                <CellEditor
                  value={editItem.value}
                  onCommit={(v) => onItemCommit?.(v)}
                  onCancel={() => onItemCancel?.()}
                />
              </li>
            );
          }
          if (checked !== null) {
            // 済みの印は項目自身の字にだけ掛ける（index.css）。入れ子の並びは
            // 包みの外に置く。中に入れると飾りがそこまで届き、子の済み・未済と
            // 食い違って見える。
            const kids = Children.toArray(children);
            const cut = kids.findIndex(isNestedList);
            return (
              <li {...rest} data-checked={done} data-mg-item={anchor ?? undefined}>
                <span className="mg-task-line">
                  {cut < 0 ? kids : kids.slice(0, cut)}
                </span>
                {cut < 0 ? null : kids.slice(cut)}
              </li>
            );
          }
          return (
            // 選択からこの項目を特定するための目印（ソースオフセット）。
            <li {...rest} data-mg-item={anchor ?? undefined}>
              {children}
            </li>
          );
        },
        input({ type, checked }) {
          if (type !== "checkbox") {
            return <input type={type} checked={checked} readOnly />;
          }
          // ネイティブ checkbox を Material アイコンに統一。クリックでトグル。
          const ordinal = taskSeq.n++;
          return (
            <TaskCheck
              checked={!!checked}
              onToggle={
                onToggleTask ? (el) => onToggleTask(ordinal, el) : undefined
              }
            />
          );
        },
        a({ href, children, ...props }) {
          const h = href ?? "";
          if (/^(https?:|mailto:|tel:)/.test(h)) {
            // WKWebView では target=_blank でも本体が遷移してしまう。
            // opener で外部（既定ブラウザ/メールクライアント）に開く。
            return (
              <a
                href={h}
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl(h);
                }}
                {...props}
              >
                {children}
              </a>
            );
          }
          if (h.startsWith("#")) {
            // 素の遷移では寄らない（本文を送っているのはペインの入れ物で、
            // 窓ではない）。行き先は描く側に任せる。
            return (
              <a
                href={h}
                onClick={(e) => {
                  e.preventDefault();
                  ctx?.onAnchor?.(splitHref(h).id);
                }}
                {...props}
              >
                {children}
              </a>
            );
          }
          return (
            <a
              href={h}
              onClick={(e) => {
                e.preventDefault();
                if (h && ctx) ctx.onNavigate(h);
              }}
              {...props}
            >
              {children}
            </a>
          );
        },
        img({ src, alt, title }) {
          return (
            <MdImage
              src={typeof src === "string" ? src : undefined}
              alt={alt}
              title={title}
            />
          );
        },
        table({ children }) {
          return (
            <div className="mg-table-wrap overflow-x-auto">
              <table>{children}</table>
            </div>
          );
        },
        // 列幅は内容を包む .mg-cell（ブロック div）で制御する。table-layout:auto の
        // セルへの min/max-width は仕様上 undefined で WKWebView が無視するため。
        // ダブルクリックでそのセルだけをインライン編集できる（renderCell 参照）。
        td({ node, children, ...rest }) {
          return renderCell("td", node, children, rest);
        },
        th({ node, children, ...rest }) {
          return renderCell("th", node, children, rest);
        },
      }}
    >
      {opened.text}
    </ReactMarkdown>
  );
});
