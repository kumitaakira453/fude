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
}: {
  x: number;
  y: number;
  query?: string;
  active?: number;
  onPick: (char: string) => void;
  onClose: () => void;
  onClear?: () => void;
}) {
  const [all, setAll] = useState<Emoji[] | null>(emojiReady());
  // 盤が自分で持つ検索の文字。呼び出し側が query を渡すときは使わない。
  const [typed, setTyped] = useState("");
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

  const choose = (char: string) => {
    rememberEmoji(char);
    onPick(char);
  };

  // 選ばれているものを見えるところへ送る。呼び出し側が矢印キーを持つときだけ。
  const hot = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    hot.current?.scrollIntoView({ block: "nearest" });
  }, [active, want]);

  // 列の数は打鍵の上下移動と揃える。CSS に別の数を書くと食い違う。
  const grid = { gridTemplateColumns: `repeat(${COLS}, 1fr)` };

  const cell = (char: string, key: string, at: number | null) => (
    <button
      key={key}
      ref={at !== null && at === active ? hot : undefined}
      type="button"
      className={at !== null && at === active ? "is-on" : undefined}
      // 押しても本文の選択やカーソルを動かさない。
      onMouseDown={(e) => {
        e.preventDefault();
        choose(char);
      }}
    >
      {char}
    </button>
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

      <div className="mg-emoji-body">
        {!all ? (
          <div className="mg-emoji-wait">読み込んでいます…</div>
        ) : found ? (
          found.length === 0 ? (
            <div className="mg-emoji-wait">見つかりません</div>
          ) : (
            <div className="mg-ico-grid" style={grid}>
              {found.map((one, i) => cell(one.char, one.char, i))}
            </div>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <div className="mg-ico-label">最近使った</div>
                <div className="mg-ico-grid" style={grid}>
                  {recent.map((char) => cell(char, `r:${char}`, null))}
                </div>
              </>
            )}
            {GROUPS.map((group) => (
              <div key={group.group} data-mg-emoji-group={group.group}>
                <div className="mg-ico-label">{group.label}</div>
                <div className="mg-ico-grid" style={grid}>
                  {all
                    .filter((one) => one.group === group.group)
                    .map((one) => cell(one.char, one.char, null))}
                </div>
              </div>
            ))}
          </>
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
