import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { KINDS, kindName, type CommentKind, type KindInfo } from "../../lib/commentKind";

// コメントの種類の札と、書く欄の頭で「/」を打って種類を選ぶ口。

// 色の札。onRemove を渡すと ×（書く欄の頭に付けたもの）、onPick を渡すと押して
// 種類を替えられる。faint は種類が無い書き込み（修正として扱う）を薄く出す。
export function KindChip({
  kind,
  faint,
  onRemove,
  onPick,
  choices,
}: {
  kind: CommentKind;
  faint?: boolean;
  onRemove?: () => void;
  onPick?: (kind: CommentKind) => void;
  choices?: KindInfo[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  return (
    <span
      ref={box}
      data-kind={kind}
      className={`mg-kind${faint ? " is-faint" : ""}${onPick ? " is-pick" : ""}`}
      onClick={(e) => {
        if (!onPick) return;
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      {kindName(kind)}
      {onRemove && (
        <span
          role="button"
          aria-label="種類を外す"
          className="mg-kind-x"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </span>
      )}
      {open && onPick && (
        <KindList
          anchor={box}
          items={choices ?? KINDS.filter((k) => !k.replyOnly)}
          at={KINDS.findIndex((k) => k.id === kind)}
          onPick={(k) => {
            setOpen(false);
            onPick(k);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </span>
  );
}

// 種類の一覧。窓に対して置き（右の欄は外を切っているので欄の中に置かない）、
// 外を押すか Esc で閉じる。
function KindList({
  anchor,
  items,
  at,
  onPick,
  onClose,
}: {
  anchor: RefObject<HTMLElement>;
  items: KindInfo[];
  at: number;
  onPick: (kind: CommentKind) => void;
  onClose?: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = anchor.current;
    const r = el?.getBoundingClientRect();
    // 書く欄から出すときは 1 行目の下に、札から出すときは札の下に置く。
    if (r) setPos({ top: el instanceof HTMLTextAreaElement ? r.top + 26 : r.bottom + 4, left: r.left });
  }, [anchor]);
  useEffect(() => {
    if (!onClose) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away, true);
      window.removeEventListener("keydown", esc, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={box}
      role="listbox"
      aria-label="コメントの種類"
      className="mg-kind-list"
      style={pos ?? { visibility: "hidden", top: 0, left: 0 }}
    >
      {items.map((k, i) => (
        <button
          key={k.id}
          type="button"
          role="option"
          aria-selected={i === at}
          className={`mg-kind-opt${i === at ? " is-on" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation();
            onPick(k.id);
          }}
        >
          <span data-kind={k.id} className="mg-kind">
            {k.name}
          </span>
          <code>/{k.id}</code>
        </button>
      ))}
    </div>,
    document.body,
  );
}

// 書く欄の頭で「/」を打つと種類の一覧を出し、選んだ種類を欄の頭に札で付ける。
// 札は欄の 1 行目の頭に重ね、字はその分だけ字下げして続ける。札は × か、欄の
// 頭での ⌫ で外す。送るときは withKind で本文の頭に印を足す。
//
// 使い方：欄の onChange で change、onKeyDown の頭で keyDown を呼ぶ（true なら
// その打鍵はここで受けた）。field で欄を包む。
export function useKindSlash({
  input,
  initial,
  reply,
  setText,
}: {
  input: RefObject<HTMLTextAreaElement>;
  initial: CommentKind | null;
  // 返信の欄か。承認は返信にだけ付けられる。
  reply: boolean;
  setText: (value: string) => void;
}) {
  const [kind, setKind] = useState<CommentKind | null>(initial);
  const [menu, setMenu] = useState<{ items: KindInfo[]; at: number } | null>(null);
  const allowed = KINDS.filter((k) => reply || !k.replyOnly);

  const listFor = (value: string) => {
    if (!value.startsWith("/") || /\s/.test(value)) return null;
    const q = value.slice(1).toLowerCase();
    const items = allowed.filter((k) => k.id.startsWith(q) || k.name.startsWith(q));
    return items.length ? items : null;
  };
  const change = (value: string) => {
    setText(value);
    const items = listFor(value);
    setMenu(items ? { items, at: 0 } : null);
  };
  const pick = (k: CommentKind) => {
    setKind(k);
    setText("");
    setMenu(null);
    input.current?.focus();
  };
  const keyDown = (e: React.KeyboardEvent<HTMLElement>): boolean => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
    if (menu) {
      const n = menu.items.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setMenu({ ...menu, at: (menu.at + step + n) % n });
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(menu.items[menu.at].id);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
        return true;
      }
    }
    const el = input.current;
    if (e.key === "Backspace" && kind && el && el.selectionStart === 0 && el.selectionEnd === 0) {
      e.preventDefault();
      setKind(null);
      return true;
    }
    return false;
  };
  const reset = () => {
    setKind(initial);
    setMenu(null);
  };

  // 札の幅だけ 1 行目を字下げする。
  const chip = useRef<HTMLSpanElement>(null);
  const [indent, setIndent] = useState(0);
  useLayoutEffect(() => {
    setIndent(kind && chip.current ? chip.current.getBoundingClientRect().width + 6 : 0);
  }, [kind]);

  const field = (children: ReactNode) => (
    <div className="mg-kind-field" style={{ ["--mg-kind-indent" as string]: `${indent}px` }}>
      {kind && (
        <span ref={chip} className="mg-kind-seat">
          <KindChip kind={kind} onRemove={() => setKind(null)} />
        </span>
      )}
      {children}
      {menu && (
        <KindList
          anchor={input}
          items={menu.items}
          at={menu.at}
          onPick={pick}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );

  return { kind, change, keyDown, field, reset, open: menu !== null };
}
