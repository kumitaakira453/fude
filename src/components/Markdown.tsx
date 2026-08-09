import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CodeBlock } from "./CodeBlock";
import { Icon } from "./Icon";
import { markdownContext } from "./MarkdownContext";
import { MdImage } from "./MdImage";
import { Mermaid } from "./Mermaid";

const remarkPlugins = [
  remarkGfm,
  remarkMath,
  [remarkFrontmatter, ["yaml"]] as const,
];
const rehypePlugins = [
  rehypeRaw,
  rehypeSlug,
  rehypeKatex,
  [rehypeHighlight, { ignoreMissing: true, detect: true }] as const,
];

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
const CALLOUT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

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

const NUMERIC_RE = /^[+\-−]?[\d,]+(\.\d+)?\s*%?$/;

// スクロール等での親再レンダー時に再パースしないよう body でメモ化する。
// （再パースは画像 blob の revoke や mermaid のチカチカを引き起こす）
export const Markdown = memo(function Markdown({
  body,
  editorial,
}: {
  body: string;
  editorial: boolean;
}) {
  const ctx = useContext(markdownContext);
  // レンダーごとにリセットされる、先頭段落（リード文）の消費フラグ
  const lead = { used: false };

  return (
    <ReactMarkdown
      // @ts-expect-error remark/rehype プラグインのタプル型は緩めに扱う
      remarkPlugins={remarkPlugins}
      // @ts-expect-error 同上
      rehypePlugins={rehypePlugins}
      components={{
        code({ className, children, ...props }) {
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
        p({ children }) {
          if (editorial) {
            // 単独の外部リンク → リンクカード
            const link = standaloneLink(children);
            if (link) return <LinkCard href={link.href} text={link.text} />;
            // 本文の最初の段落 → リード文
            if (!lead.used) {
              lead.used = true;
              return <p className="mg-lead">{children}</p>;
            }
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
        ol({ children }) {
          return (
            <ol className={editorial ? "mg-steps" : undefined}>{children}</ol>
          );
        },
        td({ children }) {
          const isNum =
            editorial && NUMERIC_RE.test(childrenToString(children).trim());
          return <td className={isNum ? "mg-num" : undefined}>{children}</td>;
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
            return (
              <a href={h} {...props}>
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
      }}
    >
      {body}
    </ReactMarkdown>
  );
});
