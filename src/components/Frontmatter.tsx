import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Icon } from "./Icon";

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

function Val({ v }: { v: unknown }) {
  if (Array.isArray(v)) {
    return (
      <>
        {v.map((x, i) => (
          <span key={i}>
            {i > 0 && <span className="text-[var(--mg-muted)]"> / </span>}
            <Val v={x} />
          </span>
        ))}
      </>
    );
  }
  const s = fmt(v);
  if (typeof v === "string" && isUrl(v)) {
    return (
      <a
        href={v}
        onClick={(e) => {
          e.preventDefault();
          void openUrl(v);
        }}
        className="text-[var(--mg-accent)] underline decoration-[var(--mg-accent-soft)] underline-offset-2 transition hover:decoration-[var(--mg-accent)]"
      >
        {s}
      </a>
    );
  }
  return <>{s}</>;
}

const KEY_ICON: Record<string, string> = {
  author: "person",
  authors: "group",
  date: "calendar_today",
  created: "calendar_today",
  createdat: "calendar_today",
  published: "calendar_today",
  updated: "update",
  updatedat: "update",
  modified: "update",
  status: "flag",
  state: "flag",
  category: "category",
  categories: "category",
  url: "link",
  link: "link",
  source: "link",
  version: "label",
  id: "tag",
  slug: "tag",
  type: "label",
  priority: "priority_high",
  aliases: "alternate_email",
};

const norm = (k: string) => k.toLowerCase().replace(/[_-]/g, "");
const iconFor = (k: string) => KEY_ICON[norm(k)];

function fmt(v: unknown): string {
  if (v instanceof Date) return isNaN(v.getTime()) ? String(v) : v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const isLede = (k: string) => ["description", "summary", "excerpt", "subtitle"].includes(norm(k));

export function Frontmatter({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const title = typeof data.title === "string" ? data.title : undefined;
  const rawTags = data.tags ?? data.tag;
  const tags = Array.isArray(rawTags)
    ? rawTags.map(String)
    : typeof rawTags === "string"
      ? rawTags.split(/[,\s]+/).filter(Boolean)
      : [];

  const rest = Object.entries(data).filter(([k]) => {
    const n = norm(k);
    return n !== "title" && n !== "tags" && n !== "tag";
  });
  const lede = rest.find(([k]) => isLede(k));
  const metaFields = rest.filter(([k]) => !isLede(k));

  if (!title && tags.length === 0 && rest.length === 0) return null;

  const LIMIT = 8;
  const shown = expanded ? metaFields : metaFields.slice(0, LIMIT);
  const hidden = metaFields.length - shown.length;

  return (
    <header className="mg-frontmatter mb-8 border-b border-[var(--mg-border)] pb-5">
      {title && (
        <h1 className="!mb-0 !mt-0 !text-[2.1rem] !font-bold !leading-[1.15] tracking-[-0.02em]">
          {title}
        </h1>
      )}

      {lede && (
        <p className="!mb-0 mt-2 text-[14.5px] leading-relaxed text-[var(--mg-muted)]">
          {fmt(lede[1])}
        </p>
      )}

      {metaFields.length > 0 && (
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-[var(--mg-muted)]">
          {shown.map(([k, v]) => {
            const ic = iconFor(k);
            return (
              <span key={k} className="inline-flex max-w-full items-center gap-1.5">
                <Icon
                  name={ic ?? "chevron_right"}
                  size={14}
                  className="shrink-0 text-[var(--mg-accent)]/70"
                />
                {!ic && <span className="shrink-0 text-[var(--mg-muted)]">{k}:</span>}
                <span className="truncate text-[var(--mg-fg-dim)]" title={fmt(v)}>
                  <Val v={v} />
                </span>
              </span>
            );
          })}
          {hidden > 0 && !expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="text-[12px] font-medium text-[var(--mg-accent)] transition hover:opacity-80"
            >
              +{hidden}
            </button>
          )}
          {expanded && metaFields.length > LIMIT && (
            <button
              onClick={() => setExpanded(false)}
              className="text-[12px] font-medium text-[var(--mg-muted)] transition hover:opacity-80"
            >
              閉じる
            </button>
          )}
        </div>
      )}

      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-[var(--mg-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--mg-accent)]"
            >
              #{t}
            </span>
          ))}
        </div>
      )}
    </header>
  );
}
