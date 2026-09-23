import { getVersion } from "@tauri-apps/api/app";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOptimisticSetting } from "../hooks/useOptimisticSetting";
import { FONTS } from "../lib/fonts";
import { cleanDir, DEFAULT_DIR } from "../lib/images";
import { THEMES } from "../lib/themes";
import {
  editorialAtom,
  fontAtom,
  ignoreAtom,
  imageDirAtom,
  liveEditAtom,
  notionKeysAtom,
  readingWidthAtom,
  settingsOpenAtom,
  showOtherFilesAtom,
  shortcutsOpenAtom,
  taskMarksAtom,
  themeAtom,
  updateCheckNonceAtom,
  updateStatusAtom,
} from "../state/atoms";
import { AppIcon } from "./AppIcon";
import { Icon } from "./Icon";
import { IgnoreWords, Marks, Switch, Words } from "./settings/SettingRow";
import { FACES, matches, type Face, type Row } from "./settings/rows";

// 設定。⌘, で開く。
//
// 面は**責務**で分ける。熟し具合（試験中）や成り立ちで分けると、探している設定が
// どこにあるか読めない。項目は表で持ち、描くのは 1 つの部品に任せる。
// 面をまたいで探せるよう、上に絞り込みの欄を置く。

const WIDTHS: ["cozy" | "wide" | "full", string, string][] = [
  ["cozy", "標準", "読み物として落ち着く幅"],
  ["wide", "広め", "表や図を大きく見せる"],
  ["full", "最大", "画面いっぱいに使う"],
];

const ROWS: Row[] = [
  {
    kind: "pick",
    pick: "theme",
    id: "theme",
    face: "look",
    name: "テーマ",
    note: "明るい / 暗いの配色を選ぶ",
    aliases: ["theme", "color", "配色", "色", "ダーク", "ライト"],
  },
  {
    kind: "pick",
    pick: "font",
    id: "font",
    face: "look",
    name: "書体",
    note: "本文の書体を選ぶ",
    aliases: ["font", "typeface", "フォント", "ゴシック", "明朝"],
  },
  {
    kind: "pick",
    pick: "width",
    id: "width",
    face: "look",
    name: "本文幅",
    note: "1 行の長さを決める",
    aliases: ["width", "幅", "余白"],
  },
  {
    kind: "switch",
    id: "editorial",
    face: "look",
    icon: "brush",
    beta: true,
    atom: editorialAtom,
    name: "メイクアップ版",
    note: "字間・行間から見出し・箇条書き・引用の組み方まで作り込んで描く",
    aliases: ["editorial", "組版", "typography"],
  },
  {
    kind: "switch",
    id: "live",
    face: "write",
    icon: "edit_note",
    beta: true,
    atom: liveEditAtom,
    name: "リアルタイム編集",
    note: "組版されたまま直接書ける編集面でファイルを開く。切ると読む画面になり、直すのは本文のダブルクリックから",
    aliases: ["live", "編集", "wysiwyg"],
  },
  {
    kind: "switch",
    id: "notion",
    face: "write",
    icon: "keyboard",
    beta: true,
    atom: notionKeysAtom,
    name: "Notion 風の打ち込み",
    note: "`>` でトグル、`|` で引用を作る。切ると Markdown どおり `>` が引用",
    aliases: ["notion", "打鍵", "shortcut"],
  },
  {
    kind: "marks",
    icon: "checklist",
    id: "taskmarks",
    face: "write",
    beta: true,
    atom: taskMarksAtom,
    name: "タスクの特殊な印",
    note: "`- [/] ` のように書いた印を、四角の中にそのまま出す。入れた印だけが読まれ、切ってあるものは今までどおり字のまま",
    aliases: ["task", "todo", "タスク", "チェック", "印", "進行中", "取りやめ", "先送り", "疑問", "重要"],
  },
  {
    kind: "words",
    icon: "image",
    id: "imagedir",
    face: "write",
    lines: "one",
    atom: imageDirAtom,
    placeholder: DEFAULT_DIR,
    name: "画像の置き場所",
    note: "貼った画像・落とした画像は、文書と同じところに作ったこの名前のフォルダへ入る",
    aliases: ["image", "画像", "写真", "フォルダ", "images"],
  },
  {
    kind: "switch",
    id: "showother",
    face: "files",
    icon: "folder_open",
    atom: showOtherFilesAtom,
    name: "Markdown 以外も並べる",
    note: "画像・HTML・PDF と字で書かれたファイルをツリーに出す。切ると読み物だけの一覧になる（1 枚だけ開く経路はどちらでも通る）",
    aliases: ["tree", "一覧", "ツリー", "画像", "html", "pdf"],
  },
  {
    kind: "words",
    icon: "filter_alt_off",
    id: "ignore",
    face: "files",
    lines: "many",
    atom: ignoreAtom,
    placeholder: "node_modules/\n*.lock\n.DS_Store",
    name: "一覧から外すもの",
    note: ".gitignore と同じ書き方。末尾の / は置き場ごと（worktrees/ なら中身も箱も）、途中に / があれば根からの道筋、!残す.md で戻せる。外したものは検索にも出ない",
    aliases: ["exclude", "ignore", "除外", "隠す"],
  },
  {
    kind: "about",
    id: "about",
    face: "app",
    name: "fude",
    note: "版を確かめ、更新を取りに行く",
    aliases: ["version", "update", "版", "更新", "about"],
  },
  {
    kind: "do",
    id: "keys",
    face: "app",
    icon: "keyboard",
    label: "キー操作の一覧",
    name: "キー操作の一覧",
    note: "⌘/ でいつでも開けます",
    aliases: ["key", "shortcut", "キー", "ショートカット"],
  },
];

export function Settings() {
  const [open, setOpen] = useAtom(settingsOpenAtom);
  const [face, setFace] = useState<Face>("look");
  const [query, setQuery] = useState("");
  const find = useRef<HTMLInputElement>(null);

  const [themeValue, setThemeValue] = useAtom(themeAtom);
  const [fontValue, setFontValue] = useAtom(fontAtom);
  const [widthValue, setWidthValue] = useAtom(readingWidthAtom);
  const [theme, setTheme] = useOptimisticSetting(themeValue, setThemeValue);
  const [font, setFont] = useOptimisticSetting(fontValue, setFontValue);
  const [width, setWidth] = useOptimisticSetting(widthValue, setWidthValue);

  const imageDir = useAtomValue(imageDirAtom);

  const setShortcuts = useSetAtom(shortcutsOpenAtom);
  const setUpdateNonce = useSetAtom(updateCheckNonceAtom);
  const updateStatus = useAtomValue(updateStatusAtom);
  const [version, setVersion] = useState("");
  // 「更新を確認」を押したか。起動時の自動チェックの結果は出さず、
  // 押したときだけ結果（確認中 / 最新 / 更新あり）を出す。
  const [checked, setChecked] = useState(false);
  const isTauri = "__TAURI_INTERNALS__" in window;

  useEffect(() => {
    if (!isTauri) return;
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  }, [isTauri]);

  useEffect(() => {
    if (open) {
      find.current?.focus();
      return;
    }
    setChecked(false);
    setQuery("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      // 面は上下で移る。絞り込みの途中は文字の行き来を邪魔しない。
      if (query || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
      e.preventDefault();
      const at = FACES.findIndex((f) => f.id === face);
      const step = e.key === "ArrowDown" ? 1 : FACES.length - 1;
      setFace(FACES[(at + step) % FACES.length].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, face, query]);

  // 絞り込んでいるあいだは面をまたいで出す。どの面のものかを添えないと、
  // 次に同じ設定を探すときにまた絞り込むことになる。
  const hits = useMemo(
    () => (query.trim() ? ROWS.filter((row) => matches(row, query)) : null),
    [query],
  );
  const shown = hits ?? ROWS.filter((row) => row.face === face);

  if (!open) return null;

  const themeGrid = (list: typeof THEMES) => (
    <div className="mg-set-themes">
      {list.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => setTheme(t.id)}
          className={`mg-set-theme${t.id === theme ? " is-on" : ""}`}
        >
          {/* テーマの色は data-theme に紐付いた変数なので、その属性を持たせた
              入れ物の中で読ませれば、そのテーマの実際の色で描ける。 */}
          <span className="mg-set-swatch" data-theme={t.id}>
            <span className="mg-set-swatch-fg" />
            <span className="mg-set-swatch-dim" />
            <span className="mg-set-swatch-dot" />
          </span>
          <span className="mg-set-theme-name">{t.label}</span>
          {t.id === theme && <Icon name="check" size={14} />}
        </button>
      ))}
    </div>
  );

  const draw = (row: Row) => {
    switch (row.kind) {
      case "switch":
        return <Switch row={row} />;
      case "words":
        // 一覧から外すものは、共通とフォルダごとを切り替えて書く。
        if (row.id === "ignore") return <IgnoreWords row={row} />;
        return (
          <Words
            row={row}
            foot={`本文には ./${cleanDir(imageDir)}/… として書かれる`}
          />
        );
      case "marks":
        return <Marks row={row} />;
      case "pick":
        if (row.pick === "theme") {
          return (
            <>
              <div className="mg-set-sub">明るい</div>
              {themeGrid(THEMES.filter((t) => !t.dark))}
              <div className="mg-set-sub">暗い</div>
              {themeGrid(THEMES.filter((t) => t.dark))}
            </>
          );
        }
        if (row.pick === "font") {
          return (
            <div className="mg-set-fonts">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFont(f.id)}
                  className={`mg-set-font${f.id === font ? " is-on" : ""}`}
                >
                  <span className="mg-set-font-name">{f.label}</span>
                  <span className="mg-set-font-eg" style={{ fontFamily: f.stack }}>
                    本文の見本 Aa 123
                  </span>
                </button>
              ))}
            </div>
          );
        }
        return (
          <div className="mg-set-widths">
            {WIDTHS.map(([id, label, note]) => (
              <button
                key={id}
                type="button"
                onClick={() => setWidth(id)}
                className={`mg-set-width${id === width ? " is-on" : ""}`}
              >
                <span className={`mg-set-width-eg is-${id}`}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="mg-set-width-name">{label}</span>
                <span className="mg-set-note">{note}</span>
              </button>
            ))}
          </div>
        );
      case "do":
        return (
          <button
            type="button"
            className="mg-set-row"
            onClick={() => {
              setOpen(false);
              setShortcuts(true);
            }}
          >
            <Icon name={row.icon} size={18} className="text-[var(--mg-muted)]" />
            <span className="mg-set-row-main">
              <span className="mg-set-row-name">{row.name}</span>
              <span className="mg-set-note">{row.note}</span>
            </span>
            <Icon name="chevron_right" size={16} className="text-[var(--mg-muted)]" />
          </button>
        );
      case "about":
        return (
          <>
            <div className="mg-set-row is-static">
              <AppIcon size={18} className="text-[var(--mg-accent)]" />
              <span className="mg-set-row-main">
                <span className="mg-set-row-name">fude</span>
                <span className="mg-set-note">
                  {isTauri
                    ? version
                      ? `v${version}`
                      : "バージョンを取得中…"
                    : "ブラウザで動かしています"}
                </span>
              </span>
              {isTauri && (
                <button
                  type="button"
                  onClick={() => {
                    setChecked(true);
                    setUpdateNonce((n) => n + 1);
                  }}
                  disabled={updateStatus === "checking"}
                  className="mg-quiet mg-set-check"
                >
                  {checked && updateStatus === "checking" && (
                    <Icon name="progress_activity" size={14} className="mg-spin" />
                  )}
                  {!checked
                    ? "更新を確認"
                    : updateStatus === "checking"
                      ? "確認中…"
                      : updateStatus === "uptodate"
                        ? "最新です"
                        : updateStatus === "available"
                          ? "更新あり"
                          : updateStatus === "error"
                            ? "確認できず"
                            : "更新を確認"}
                </button>
              )}
            </div>
            <p className="mg-set-about">
              ローカルの Markdown を読み、コメントを書き残すための道具です。
              読み込みもコメントの保存も、すべて端末の中で完結します。
            </p>
          </>
        );
    }
  };

  return createPortal(
    <div className="mg-set-back" onClick={() => setOpen(false)}>
      <div
        className="mg-set"
        role="dialog"
        aria-label="設定"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mg-set-head">
          <Icon name="tune" size={17} className="text-[var(--mg-accent)]" />
          <span className="mg-set-title">設定</span>
          <span className="flex-1" />
          <button
            type="button"
            className="mg-set-close"
            onClick={() => setOpen(false)}
            title="閉じる（Esc）"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="mg-set-find">
          <Icon name="search" size={16} className="text-[var(--mg-muted)]" />
          <input
            ref={find}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="設定を探す"
            aria-label="設定を探す"
            spellCheck={false}
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} title="消す">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="mg-set-main">
          {!hits && (
            <nav className="mg-set-tabs">
              {FACES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFace(f.id)}
                  className={`mg-set-tab${f.id === face ? " is-on" : ""}`}
                >
                  <Icon name={f.icon} size={16} />
                  {f.label}
                </button>
              ))}
            </nav>
          )}

          <div className="mg-set-body">
            {shown.length === 0 ? (
              <p className="mg-set-none">「{query}」に当たる設定はありません</p>
            ) : (
              shown.map((row) => (
                <section key={row.id} className="mg-set-sec">
                  {/* 絞り込み中はどの面のものかを添える。添えないと、次に同じ
                      設定を探すときにまた絞り込むことになる。 */}
                  {hits && (
                    <span className="mg-set-where">
                      {FACES.find((f) => f.id === row.face)?.label}
                    </span>
                  )}
                  {/* 見本を出して選ぶものだけ題が要る。他は行が名前を持っている。 */}
                  {row.kind === "pick" && <h3>{row.name}</h3>}
                  {draw(row)}
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
