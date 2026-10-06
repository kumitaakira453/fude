import { getVersion } from "@tauri-apps/api/app";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOptimisticSetting } from "../hooks/useOptimisticSetting";
import { FONTS } from "../lib/fonts";
import { cleanDir, DEFAULT_DIR } from "../lib/images";
import { THEMES } from "../lib/themes";
import { inEditable } from "../lib/ui";
import {
  claudeLinkAtom,
  fontAtom,
  ignoreAtom,
  imageDirAtom,
  liveEditAtom,
  notionKeysAtom,
  readingWidthAtom,
  settingsFaceAtom,
  settingsOpenAtom,
  showOtherFilesAtom,
  taskMarksAtom,
  themeAtom,
  updateCheckNonceAtom,
  updateStatusAtom,
  wideTableAtom,
} from "../state/atoms";
import { AppIcon } from "./AppIcon";
import { ClaudeMark } from "./ClaudeMark";
import { Icon } from "./Icon";
import { ClaudePane } from "./settings/ClaudePane";
import { KEY_WORDS, KeysPane } from "./settings/KeysPane";
import { IgnoreWords, Marks, Switch, Words } from "./settings/SettingRow";
import { FACES, grouped, matches, type Face, type Row, type SwitchRow } from "./settings/rows";

// 設定。⌘, で開く。読む画面の代わりに、ウィンドウ全体がこの画面になる
// （暗くして重ねる小窓にはしない。読む画面は隠れているだけで、閉じれば戻る）。
//
// 面は**責務**で分ける。熟し具合（試験中）や成り立ちで分けると、探している設定が
// どこにあるか読めない。項目は表で持ち、描くのは 1 つの部品に任せる。
// 面をまたいで探せるよう、左上に絞り込みの欄を置く。

const WIDTHS: ["cozy" | "wide" | "full", string, string][] = [
  ["cozy", "標準", "読み物として落ち着く幅"],
  ["wide", "広め", "表や図を大きく見せる"],
  ["full", "最大", "画面いっぱいに使う"],
];

const CLAUDE_TOGGLE: SwitchRow = {
  kind: "switch",
  id: "claude-link",
  face: "claude",
  group: "",
  beta: true,
  atom: claudeLinkAtom,
  name: "Claude のセッションからワークスペースを作る",
  note: "ツールバーの ＋ に、実行中の Claude Code のセッションが表示されます。選ぶと、そのセッションが作成・編集したファイルをタブで開いたワークスペースを作成します。その後もファイルの追加、セッション名の変更、作業状態が自動で反映されます",
};

const ROWS: Row[] = [
  {
    kind: "pick",
    pick: "theme",
    id: "theme",
    face: "look",
    group: "テーマ",
    name: "テーマ",
    note: "画面の配色を選びます",
    aliases: ["theme", "color", "配色", "色", "ダーク", "ライト"],
  },
  {
    kind: "pick",
    pick: "font",
    id: "font",
    face: "look",
    group: "フォント",
    name: "フォント",
    note: "本文のフォントを選びます",
    aliases: ["font", "typeface", "フォント", "ゴシック", "明朝"],
  },
  {
    kind: "pick",
    pick: "width",
    id: "width",
    face: "look",
    group: "本文幅",
    name: "本文幅",
    note: "本文の 1 行の長さを選びます",
    aliases: ["width", "幅", "余白"],
  },
  {
    kind: "switch",
    id: "widetable",
    face: "look",
    group: "表示",
    beta: true,
    atom: wideTableAtom,
    name: "横に長い表を見やすくする",
    note: "横にスクロールしても先頭の列を固定します。はみ出す表には「拡大表示」ボタンを出し、画面いっぱいに表示できるようにします",
    aliases: ["table", "表", "テーブル", "横スクロール", "列"],
  },
  {
    kind: "switch",
    id: "live",
    face: "write",
    group: "編集",
    atom: liveEditAtom,
    name: "リアルタイム編集",
    note: "表示された見た目のまま、直接編集できる画面でファイルを開きます。オフにすると閲覧用の画面で開きます（閲覧用の画面で変更できるのは、チェックボックスとコールアウトだけです）",
    aliases: ["live", "編集", "wysiwyg"],
  },
  {
    kind: "switch",
    id: "notion",
    face: "write",
    group: "編集",
    beta: true,
    atom: notionKeysAtom,
    name: "Notion 風の入力",
    note: "`>` でトグル、`|` で引用を作成します。オフにすると Markdown の書き方どおり `>` で引用になります",
    aliases: ["notion", "打鍵", "shortcut"],
  },
  {
    kind: "marks",
    id: "taskmarks",
    face: "write",
    group: "タスク",
    beta: true,
    atom: taskMarksAtom,
    name: "タスクの追加の記号",
    note: "`- [/] ` のように書いた記号を、チェックボックスの中に表示します。オンにした記号だけが対象で、それ以外はそのまま文字として表示されます",
    aliases: ["task", "todo", "タスク", "チェック", "印", "進行中", "取りやめ", "先送り", "疑問", "重要"],
  },
  {
    kind: "words",
    id: "imagedir",
    face: "write",
    group: "画像",
    lines: "one",
    atom: imageDirAtom,
    placeholder: DEFAULT_DIR,
    name: "画像の保存先フォルダ",
    note: "貼り付けた画像やドロップした画像は、文書と同じ場所にあるこの名前のフォルダに保存されます",
    aliases: ["image", "画像", "写真", "フォルダ", "images"],
  },
  {
    kind: "switch",
    id: "showother",
    face: "files",
    group: "ファイル一覧",
    atom: showOtherFilesAtom,
    name: "Markdown 以外のファイルも表示する",
    note: "画像・HTML・PDF・テキストファイルもファイル一覧に表示します。オフにすると Markdown だけを表示します（ファイルを単体で開く場合はどちらでも開けます）",
    aliases: ["tree", "一覧", "ツリー", "画像", "html", "pdf"],
  },
  {
    kind: "words",
    id: "ignore",
    face: "files",
    group: "ファイル一覧",
    lines: "many",
    atom: ignoreAtom,
    placeholder: "node_modules/\n*.lock\n.DS_Store",
    name: "ファイル一覧から除外するもの",
    note: ".gitignore と同じ書き方です。末尾に / を付けるとフォルダごと除外し（worktrees/ ならフォルダと中身すべて）、途中に / を含むとフォルダの先頭からのパスとして扱います。!残す.md のように書くと除外を取り消せます。除外したファイルは検索にも出ません",
    aliases: ["exclude", "ignore", "除外", "隠す"],
  },
  {
    kind: "pane",
    pane: "claude",
    id: "claude",
    face: "claude",
    group: "",
    beta: true,
    name: CLAUDE_TOGGLE.name,
    note: CLAUDE_TOGGLE.note,
    aliases: ["claude", "agent", "セッション", "エージェント", "ai"],
  },
  {
    kind: "pane",
    pane: "keys",
    id: "keys",
    face: "keys",
    group: "",
    name: "キーボードショートカット",
    note: "キーボードショートカットの一覧",
    aliases: ["key", "shortcut", "キー", "ショートカット", ...KEY_WORDS],
  },
  {
    kind: "about",
    id: "about",
    face: "app",
    group: "",
    name: "fude",
    note: "バージョンの確認とアップデート",
    aliases: ["version", "update", "版", "更新", "about"],
  },
];

function FaceIcon({ face, size = 17 }: { face: Face; size?: number }) {
  if (face === "claude") return <ClaudeMark size={size - 2} />;
  const icon = FACES.find((f) => f.id === face)?.icon ?? "tune";
  return <Icon name={icon} size={size} />;
}

export function Settings() {
  const [open, setOpen] = useAtom(settingsOpenAtom);
  const [face, setFace] = useAtom(settingsFaceAtom);
  const [query, setQuery] = useState("");
  // 探した当たりから移ったとき、その項目を少しの間だけ光らせる。
  const [flash, setFlash] = useState<string | null>(null);
  const find = useRef<HTMLInputElement>(null);
  const page = useRef<HTMLElement>(null);

  const [themeValue, setThemeValue] = useAtom(themeAtom);
  const [fontValue, setFontValue] = useAtom(fontAtom);
  const [widthValue, setWidthValue] = useAtom(readingWidthAtom);
  const [theme, setTheme] = useOptimisticSetting(themeValue, setThemeValue);
  const [font, setFont] = useOptimisticSetting(fontValue, setFontValue);
  const [width, setWidth] = useOptimisticSetting(widthValue, setWidthValue);

  const imageDir = useAtomValue(imageDirAtom);

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
    if (open) return;
    setChecked(false);
    setQuery("");
  }, [open]);

  // 面を替えたら頭から読む。
  useEffect(() => {
    page.current?.scrollTo({ top: 0 });
  }, [face]);

  useEffect(() => {
    if (!flash) return;
    const el = page.current?.querySelector(`[data-row-id="${flash}"]`);
    el?.scrollIntoView({ block: "center" });
    const t = window.setTimeout(() => setFlash(null), 1400);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!open) return;
    // 本文向けのキー（⌘F の検索など）より先に受ける。
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (query) setQuery("");
        else setOpen(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        e.stopPropagation();
        find.current?.focus();
        find.current?.select();
        return;
      }
      // 面は上下で移る。打ち込みの欄の中（探す欄で何か打っているときも）は
      // 文字の行き来を邪魔しない。
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const inFind = e.target === find.current;
      if ((inFind && query) || (!inFind && inEditable(e.target))) return;
      e.preventDefault();
      const at = FACES.findIndex((f) => f.id === face);
      const step = e.key === "ArrowDown" ? 1 : FACES.length - 1;
      setFace(FACES[(at + step) % FACES.length].id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen, face, setFace, query]);

  // 絞り込んでいるあいだは面をまたいで出す。どの面のものかを添えないと、
  // 次に同じ設定を探すときにまた絞り込むことになる。
  const hits = useMemo(
    () => (query.trim() ? ROWS.filter((row) => matches(row, query)) : null),
    [query],
  );
  const shown = hits ?? ROWS.filter((row) => row.face === face);

  if (!open) return null;

  const jump = (row: Row) => {
    setQuery("");
    setFace(row.face);
    setFlash(row.id);
  };

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

  const pick = (row: Row & { kind: "pick" }) => {
    if (row.pick === "theme") {
      return (
        <div className="mg-set-pick">
          <div className="mg-set-sub">明るい</div>
          {themeGrid(THEMES.filter((t) => !t.dark))}
          <div className="mg-set-sub">暗い</div>
          {themeGrid(THEMES.filter((t) => t.dark))}
        </div>
      );
    }
    if (row.pick === "font") {
      return (
        <div className="mg-set-pick mg-set-fonts">
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
      <div className="mg-set-pick mg-set-widths">
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
  };

  // 箱の中の 1 行。
  const draw = (row: Row) => {
    switch (row.kind) {
      case "switch":
        return <Switch row={row} />;
      case "words":
        // 一覧から外すものは、共通とフォルダごとを切り替えて書く。
        if (row.id === "ignore") return <IgnoreWords row={row} />;
        return <Words row={row} foot={`本文には ./${cleanDir(imageDir)}/… と書き込まれます`} />;
      case "marks":
        return <Marks row={row} />;
      case "pick":
        return pick(row);
      case "about":
        return (
          <div className="mg-set-row is-static">
            <AppIcon size={22} className="text-[var(--mg-accent)]" />
            <span className="mg-set-row-main">
              <span className="mg-set-row-name">fude</span>
              <span className="mg-set-note">
                {isTauri
                  ? version
                    ? `v${version}`
                    : "バージョンを確認しています…"
                  : "ブラウザで実行しています"}
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
                className="mg-quiet mg-set-btn mg-set-check"
              >
                {checked && updateStatus === "checking" && (
                  <Icon name="progress_activity" size={14} className="mg-spin" />
                )}
                {!checked
                  ? "アップデートを確認"
                  : updateStatus === "checking"
                    ? "確認中…"
                    : updateStatus === "uptodate"
                      ? "最新版です"
                      : updateStatus === "available"
                        ? "アップデートがあります"
                        : updateStatus === "error"
                          ? "確認できませんでした"
                          : "アップデートを確認"}
              </button>
            )}
          </div>
        );
      case "pane":
        return null;
    }
  };

  // 面ひとつ分を受け持つ部品。自分で見出しと箱を持つ。
  const pane = (row: Row & { kind: "pane" }, q: string) => {
    switch (row.pane) {
      case "claude":
        return <ClaudePane toggle={CLAUDE_TOGGLE} />;
      case "keys":
        return <KeysPane query={q} />;
    }
  };

  // 行の並びを、まとまりごとの箱にして出す。
  const groupsOf = (rows: Row[], q: string) =>
    grouped(rows).map(({ group, rows: inGroup }) => {
      const panes = inGroup.filter((r): r is Row & { kind: "pane" } => r.kind === "pane");
      if (panes.length > 0) {
        return (
          <div key={`pane-${panes[0].id}`} data-row-id={panes[0].id}>
            {pane(panes[0], q)}
          </div>
        );
      }
      return (
        <section key={`${inGroup[0].face}-${group}`} className="mg-set-group">
          {group && <h3 className="mg-set-group-title">{group}</h3>}
          <div className="mg-set-card">
            {inGroup.map((row) => (
              <div
                key={row.id}
                data-row-id={row.id}
                className={flash === row.id ? "mg-set-flash" : undefined}
              >
                {draw(row)}
              </div>
            ))}
          </div>
          {inGroup[0].kind === "about" && (
            <p className="mg-set-about">
              ローカルの Markdown を読んだり、コメントを残したりするためのアプリです。
              ファイルの読み込みもコメントの保存も、すべてこのパソコンの中で行います。
            </p>
          )}
        </section>
      );
    });

  const faceInfo = FACES.find((f) => f.id === face);

  return (
    <div className="mg-set" role="dialog" aria-label="設定">
      <div className="mg-screenbar mg-set-bar" data-tauri-drag-region>
        <button
          type="button"
          className="mg-set-leave"
          onClick={() => setOpen(false)}
          data-tip="戻る"
          data-key="Esc"
        >
          <Icon name="chevron_left" size={16} />
          戻る
        </button>
        <span className="mg-screenbar-kind" data-tauri-drag-region>設定</span>
      </div>
      <aside className="mg-set-nav">
        <div className="mg-set-find">
          <Icon name="search" size={16} className="text-[var(--mg-muted)]" />
          <input
            ref={find}
            autoFocus
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
        <nav className="mg-set-tabs">
          {FACES.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setQuery("");
                setFace(f.id);
              }}
              className={`mg-set-tab${!hits && f.id === face ? " is-on" : ""}`}
            >
              <FaceIcon face={f.id} />
              <span className="flex-1">{f.label}</span>
              {f.beta && <span className="mg-set-beta">Beta</span>}
            </button>
          ))}
        </nav>
      </aside>

      <main ref={page} className="mg-set-page">
        <div className="mg-set-inner">
          {hits ? (
            <>
              <h1 className="mg-set-h1">「{query}」</h1>
              {hits.length === 0 ? (
                <p className="mg-set-none">「{query}」に当たる設定はありません</p>
              ) : (
                FACES.filter((f) => hits.some((r) => r.face === f.id)).map((f) => {
                  const rows = hits.filter((r) => r.face === f.id);
                  return (
                    <div key={f.id} className="mg-set-hits">
                      <button
                        type="button"
                        className="mg-set-where"
                        onClick={() => jump(rows[0])}
                        title={`${f.label} を開く`}
                      >
                        <FaceIcon face={f.id} size={14} />
                        {f.label}
                        <Icon name="chevron_right" size={14} />
                      </button>
                      {groupsOf(rows, query)}
                    </div>
                  );
                })
              )}
            </>
          ) : (
            <>
              <h1 className="mg-set-h1">
                {faceInfo?.label}
                {faceInfo?.beta && <span className="mg-set-beta">Beta</span>}
              </h1>
              {groupsOf(shown, "")}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
