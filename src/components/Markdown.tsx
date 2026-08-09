import {
  Children,
  isValidElement,
  memo,
  useContext,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { CodeBlock } from "./CodeBlock";
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

// スクロール等での親再レンダー時に再パースしないよう body でメモ化する。
// （再パースは画像 blob の revoke や mermaid のチカチカを引き起こす）
export const Markdown = memo(function Markdown({ body }: { body: string }) {
  const ctx = useContext(markdownContext);

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
        a({ href, children, ...props }) {
          const h = href ?? "";
          if (/^(https?:|mailto:|tel:)/.test(h)) {
            return (
              <a href={h} target="_blank" rel="noreferrer" {...props}>
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
