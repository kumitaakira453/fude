import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  COLS,
  emojiReady,
  GROUPS,
  loadEmoji,
  recentEmoji,
  rememberEmoji,
  searchEmoji,
  type Emoji,
} from "../lib/emoji";
import { CALLOUT_COLORS } from "../lib/callout";
import { Icon } from "./Icon";

// 絵文字を選ぶ盤。
//
// 本文の `:`、スラッシュコマンドの /emoji、囲みのアイコンが同じものを出す。
// 「最近使った」も同じ控えを見るので、どこで選んだものでも次に出てくる。
//
// 字形は OS のものをそのまま使う（画像は持たない）。データは 700KB ほど
// あるので、初めて開いたときに読む。読めるまでは骨組みを出す。

// 探しているときに出す数。多すぎると画面に収まらず、探し直しの妨げになる。
const FOUND = 60;

// 盤に出すひとかたまり。from は、盤ぜんたいを 1 本の列と見たときの通し番号。
interface Shelf {
  key: string;
  label: string | null;
  group?: number;
  chars: string[];
  from: number;
}

export function EmojiBoard({
  x,
  y,
  // 打ち込みで絞り込む文字。本文で `:` を打っているときは、そちらが持つ。
  query,
  // 呼び出し側が矢印キーを持っているときの、選ばれている番号。
  active,
  onPick,
  onClose,
  // 渡したときだけ「アイコンを外す」を出す（囲み専用）。
  onClear,
  colors,
}: {
  x: number;
  y: number;
  query?: string;
  active?: number;
  onPick: (char: string) => void;
  onClose: () => void;
  onClear?: () => void;
  // 渡したときだけ色の並びを出す（囲み専用）。空文字は色なし。
  colors?: { now: string | null; onPick: (color: string) => void };
}) {
  const [all, setAll] = useState<Emoji[] | null>(emojiReady());
  // 盤が自分で持つ検索の文字。呼び出し側が query を渡すときは使わない。
  const [typed, setTyped] = useState("");
  // 盤が自分で持つ選び位置。呼び出し側が active を持つときは使わない。
  const [spot, setSpot] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let alive = true;
    void loadEmoji().then((list) => {
      if (alive) setAll(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      close.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const onResize = () => close.current();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const want = query ?? typed;
  const found = useMemo(
    () => (all && want ? searchEmoji(all, want, FOUND) : null),
    [all, want],
  );
  const recent = useMemo(() => recentEmoji(), [all]);

  // 盤に出すもの。矢印キーはこの並びを、出てくる順に動く。
  const shelves = useMemo<Shelf[]>(() => {
    const out: Shelf[] = [];
    let from = 0;
    const add = (one: Omit<Shelf, "from">) => {
      if (one.chars.length === 0) return;
      out.push({ ...one, from });
      from += one.chars.length;
    };
    if (found) {
      add({ key: "found", label: null, chars: found.map((one) => one.char) });
      return out;
    }
    add({ key: "recent", label: "最近使った", chars: recent });
    for (const group of GROUPS) {
      add({
        key: String(group.group),
        label: group.label,
        group: group.group,
        chars: (all ?? []).filter((one) => one.group === group.group).map((one) => one.char),
      });
    }
    return out;
  }, [found, recent, all]);

  const total = shelves.reduce((n, one) => n + one.chars.length, 0);
  const here = active ?? spot;
  const charAt = (at: number): string | null => {
    for (const shelf of shelves) {
      if (at >= shelf.from && at < shelf.from + shelf.chars.length) {
        return shelf.chars[at - shelf.from];
      }
    }
    return null;
  };

  // 探し直したら先頭へ戻す。前の位置に居ると、別のものが当たったままになる。
  useEffect(() => setSpot(0), [want]);

  const choose = (char: string) => {
    rememberEmoji(char);
    onPick(char);
  };

  // 欄の中の字送りより、盤の移動を先に取る。打った流れのまま選んで決められる。
  const onKeyDown = (e: React.KeyboardEvent) => {
    const move = (step: number) => {
      e.preventDefault();
      setSpot((at) => Math.max(0, Math.min(total - 1, at + step)));
    };
    if (e.key === "ArrowRight") return move(1);
    if (e.key === "ArrowLeft") return move(-1);
    if (e.key === "ArrowDown") return move(COLS);
    if (e.key === "ArrowUp") return move(-COLS);
    if (e.key !== "Enter") return;
    const char = charAt(here);
    if (!char) return;
    e.preventDefault();
    choose(char);
  };

  // 選ばれているものを見えるところへ送る。
  const hot = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    hot.current?.scrollIntoView({ block: "nearest" });
  }, [here, want]);

  // 列の数は打鍵の上下移動と揃える。CSS に別の数を書くと食い違う。
  const grid = { gridTemplateColumns: `repeat(${COLS}, 1fr)` };

  const cell = (char: string, key: string, at: number) => (
    <button
      key={key}
      ref={at === here ? hot : undefined}
      type="button"
      className={at === here ? "is-on" : undefined}
      // 押しても本文の選択やカーソルを動かさない。
      onMouseDown={(e) => {
        e.preventDefault();
        choose(char);
      }}
    >
      {char}
    </button>
  );

  const shelfOf = (shelf: Shelf) => (
    <div className="mg-ico-grid" style={grid}>
      {shelf.chars.map((char, i) => cell(char, `${shelf.key}:${char}`, shelf.from + i))}
    </div>
  );

  return createPortal(
    <div
      ref={boxRef}
      style={{
        left: Math.min(x, window.innerWidth - 330),
        top: Math.min(y, window.innerHeight - 380),
      }}
      className="mg-ico-pick mg-emoji-pick"
    >
      {query === undefined && (
        <div className="mg-ico-head">
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="電球 / bulb"
            className="mg-ico-input"
          />
          {onClear && (
            <button type="button" title="アイコンを外す" onClick={onClear}>
              <Icon name="delete" size={18} />
            </button>
          )}
        </div>
      )}

      {colors && (
        <div className="mg-ico-colors">
          <button
            type="button"
            title="色なし"
            onClick={() => colors.onPick("")}
            className={`mg-ico-color is-none${colors.now === null ? " is-on" : ""}`}
          >
            <Icon name="format_color_reset" size={14} />
          </button>
          {CALLOUT_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              title={color.name}
              onClick={() => colors.onPick(color.id)}
              style={{ background: `var(--mg-callout-${color.id})` }}
              className={`mg-ico-color${colors.now === color.id ? " is-on" : ""}`}
            />
          ))}
        </div>
      )}

      <div className="mg-emoji-body">
        {!all ? (
          <div className="mg-emoji-wait">読み込んでいます…</div>
        ) : total === 0 ? (
          <div className="mg-emoji-wait">見つかりません</div>
        ) : (
          shelves.map((shelf) => (
            <div key={shelf.key} data-mg-emoji-group={shelf.group}>
              {shelf.label && <div className="mg-ico-label">{shelf.label}</div>}
              {shelfOf(shelf)}
            </div>
          ))
        )}
      </div>

      {all && !found && (
        // 分類のタブ。押すとその見出しへ送る。
        <div className="mg-emoji-tabs">
          {GROUPS.map((group) => (
            <button
              key={group.group}
              type="button"
              title={group.label}
              onMouseDown={(e) => {
                e.preventDefault();
                boxRef.current
                  ?.querySelector(`[data-mg-emoji-group="${group.group}"]`)
                  ?.scrollIntoView({ block: "start" });
              }}
            >
              <Icon name={group.icon} size={16} />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
