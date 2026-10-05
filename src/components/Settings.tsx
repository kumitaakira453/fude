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
import { WorkspacesPane } from "./settings/WorkspacesPane";
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
  note: "⌘⇧P の一覧に、動いている Claude Code のセッションを並べる。選ぶと、そのセッションが書いたファイルをタブにしたワークスペースができ、書き足すたびに追いかける。名前と状態も追う",
};

const ROWS: Row[] = [
  {
    kind: "pick",
    pick: "theme",
    id: "theme",
    face: "look",
    group: "テーマ",
    name: "テーマ",
    note: "明るい / 暗いの配色を選ぶ",
    aliases: ["theme", "color", "配色", "色", "ダーク", "ライト"],
  },
  {
    kind: "pick",
    pick: "font",
    id: "font",
    face: "look",
    group: "書体",
    name: "書体",
    note: "本文の書体を選ぶ",
    aliases: ["font", "typeface", "フォント", "ゴシック", "明朝"],
  },
  {
    kind: "pick",
    pick: "width",
    id: "width",
    face: "look",
    group: "本文幅",
    name: "本文幅",
    note: "1 行の長さを決める",
    aliases: ["width", "幅", "余白"],
  },
  {
    kind: "switch",
    id: "widetable",
    face: "look",
    group: "表示",
    beta: true,
    atom: wideTableAtom,
    name: "幅の長い表を読みやすくする",
    note: "横に送っても先頭の列を置いていく。溢れている表には「大きく開く」を出し、画面いっぱいで見渡せるようにする",
    aliases: ["table", "表", "テーブル", "横スクロール", "列"],
  },
  {
    kind: "switch",
    id: "live",
    face: "write",
    group: "編集",
    atom: liveEditAtom,
    name: "リアルタイム編集",
    note: "組版されたまま直接書ける編集面でファイルを開く。切ると読む面で開く（書き換えるのはチェックとコールアウトだけ）",
    aliases: ["live", "編集", "wysiwyg"],
  },
  {
    kind: "switch",
    id: "notion",
    face: "write",
    group: "編集",
    beta: true,
    atom: notionKeysAtom,
    name: "Notion 風の打ち込み",
    note: "`>` でトグル、`|` で引用を作る。切ると Markdown どおり `>` が引用",
    aliases: ["notion", "打鍵", "shortcut"],
  },
  {
    kind: "marks",
    id: "taskmarks",
    face: "write",
    group: "タスク",
    beta: true,
    atom: taskMarksAtom,
    name: "タスクの特殊な印",
    note: "`- [/] ` のように書いた印を、四角の中にそのまま出す。入れた印だけが読まれ、切ってあるものは今までどおり字のまま",
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
    name: "画像の置き場所",
    note: "貼った画像・落とした画像は、文書と同じところに作ったこの名前のフォルダへ入る",
    aliases: ["image", "画像", "写真", "フォルダ", "images"],
  },
  {
    kind: "switch",
    id: "showother",
    face: "files",
    group: "一覧",
    atom: showOtherFilesAtom,
    name: "Markdown 以外も並べる",
    note: "画像・HTML・PDF と字で書かれたファイルをツリーに出す。切ると読み物だけの一覧になる（1 枚だけ開く経路はどちらでも通る）",
    aliases: ["tree", "一覧", "ツリー", "画像", "html", "pdf"],
  },
  {
    kind: "words",
    id: "ignore",
    face: "files",
    group: "一覧",
    lines: "many",
    atom: ignoreAtom,
    placeholder: "node_modules/\n*.lock\n.DS_Store",
    name: "一覧から外すもの",
    note: ".gitignore と同じ書き方。末尾の / は置き場ごと（worktrees/ なら中身も箱も）、途中に / があれば根からの道筋、!残す.md で戻せる。外したものは検索にも出ない",
    aliases: ["exclude", "ignore", "除外", "隠す"],
  },
  {
    kind: "pane",
    pane: "workspaces",
    id: "workspaces",
    face: "workspaces",
    group: "",
    name: "ワークスペース",
    note: "名前・色・並べるフォルダ・列に出すか・消す",
    aliases: ["workspace", "ワークスペース", "列", "フォルダ", "色", "名前", "消す"],
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
    name: "キー操作",
    note: "キーボードでの操作の一覧",
    aliases: ["key", "shortcut", "キー", "ショートカット", ...KEY_WORDS],
  },
  {
    kind: "about",
    id: "about",
    face: "app",
    group: "",
    name: "fude",
    note: "版を確かめ、更新を取りに行く",
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
        return <Words row={row} foot={`本文には ./${cleanDir(imageDir)}/… として書かれる`} />;
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
                className="mg-quiet mg-set-btn mg-set-check"
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
        );
      case "pane":
        return null;
    }
  };

  // 面ひとつ分を受け持つ部品。自分で見出しと箱を持つ。
  const pane = (row: Row & { kind: "pane" }, q: string) => {
    switch (row.pane) {
      case "workspaces":
        return <WorkspacesPane query={q} />;
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
              ローカルの Markdown を読み、コメントを書き残すための道具です。
              読み込みもコメントの保存も、すべて端末の中で完結します。
            </p>
          )}
        </section>
      );
    });

  const faceInfo = FACES.find((f) => f.id === face);

  return (
    <div className="mg-set" role="dialog" aria-label="設定">
      <aside className="mg-set-nav">
        <button
          type="button"
          className="mg-set-leave"
          onClick={() => setOpen(false)}
          title="戻る（Esc）"
        >
          <Icon name="arrow_back" size={17} />
          戻る
        </button>
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
                        title={`${f.label} の面へ`}
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
