import { getVersion } from "@tauri-apps/api/app";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useOptimisticSetting } from "../hooks/useOptimisticSetting";
import { excludeRules } from "../lib/exclude";
import { FONTS } from "../lib/fonts";
import { cleanDir, DEFAULT_DIR } from "../lib/images";
import { THEMES } from "../lib/themes";
import {
  editorialAtom,
  excludeAtom,
  fontAtom,
  imageDirAtom,
  liveEditAtom,
  notionKeysAtom,
  readingWidthAtom,
  settingsOpenAtom,
  showOtherFilesAtom,
  shortcutsOpenAtom,
  themeAtom,
  updateCheckNonceAtom,
  updateStatusAtom,
} from "../state/atoms";
import { AppIcon } from "./AppIcon";
import { AutoTextarea } from "./AutoTextarea";
import { Icon } from "./Icon";

// 設定。⌘, で開く。
// 引き出しに収まる量を越えたので 1 枚にまとめた。全部を縦に並べると画面から
// はみ出すので、左の見出しで切り替えて高さを固定する。
// テーマと書体は言葉より見た目で選ぶものなので、名前の横に実物を出す。

type Tab = "look" | "text" | "beta" | "app";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "look", label: "テーマ", icon: "palette" },
  { id: "text", label: "本文", icon: "text_fields" },
  { id: "beta", label: "試験中", icon: "science" },
  { id: "app", label: "このアプリ", icon: "info" },
];

const WIDTHS: ["cozy" | "wide" | "full", string, string][] = [
  ["cozy", "標準", "読み物として落ち着く幅"],
  ["wide", "広め", "表や図を大きく見せる"],
  ["full", "最大", "画面いっぱいに使う"],
];

export function Settings() {
  const [open, setOpen] = useAtom(settingsOpenAtom);
  const [tab, setTab] = useState<Tab>("look");
  const [themeValue, setThemeValue] = useAtom(themeAtom);
  const [fontValue, setFontValue] = useAtom(fontAtom);
  const [widthValue, setWidthValue] = useAtom(readingWidthAtom);
  const [editorialValue, setEditorialValue] = useAtom(editorialAtom);
  const [liveValue, setLiveValue] = useAtom(liveEditAtom);
  const [notionValue, setNotionValue] = useAtom(notionKeysAtom);
  const [showOtherValue, setShowOtherValue] = useAtom(showOtherFilesAtom);
  const [exclude, setExclude] = useAtom(excludeAtom);
  const [imageDir, setImageDir] = useAtom(imageDirAtom);
  // 押した瞬間に選択状態を切り替える（反映に伴う再描画を待たせない）
  const [theme, setTheme] = useOptimisticSetting(themeValue, setThemeValue);
  const [font, setFont] = useOptimisticSetting(fontValue, setFontValue);
  const [width, setWidth] = useOptimisticSetting(widthValue, setWidthValue);
  const [editorial, setEditorial] = useOptimisticSetting(
    editorialValue,
    setEditorialValue,
  );
  const [live, setLive] = useOptimisticSetting(liveValue, setLiveValue);
  const [notion, setNotion] = useOptimisticSetting(notionValue, setNotionValue);
  const [showOther, setShowOther] = useOptimisticSetting(
    showOtherValue,
    setShowOtherValue,
  );
  // いま効いている数。書き方を間違えた行（空・覚書）が落ちるので、数で分かる。
  const dropCount = useMemo(() => excludeRules(exclude).length, [exclude]);
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
    if (!open) setChecked(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

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

        <div className="mg-set-main">
          <nav className="mg-set-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`mg-set-tab${t.id === tab ? " is-on" : ""}`}
              >
                <Icon name={t.icon} size={16} />
                {t.label}
              </button>
            ))}
          </nav>

          <div className="mg-set-body">
            {tab === "look" && (
              <section className="mg-set-sec">
                <div className="mg-set-sub">明るい</div>
                {themeGrid(THEMES.filter((t) => !t.dark))}
                <div className="mg-set-sub">暗い</div>
                {themeGrid(THEMES.filter((t) => t.dark))}
              </section>
            )}

            {tab === "text" && (
              <>
                <section className="mg-set-sec">
                  <h3>書体</h3>
                  <div className="mg-set-fonts">
                    {FONTS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFont(f.id)}
                        className={`mg-set-font${f.id === font ? " is-on" : ""}`}
                      >
                        <span className="mg-set-font-name">{f.label}</span>
                        <span
                          className="mg-set-font-eg"
                          style={{ fontFamily: f.stack }}
                        >
                          本文の見本 Aa 123
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="mg-set-sec">
                  <h3>本文幅</h3>
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
                </section>

                <section className="mg-set-sec">
                  <h3>ファイル一覧</h3>
                  <button
                    type="button"
                    onClick={() => setShowOther(!showOther)}
                    className="mg-set-row"
                  >
                    <Icon
                      name="image"
                      size={18}
                      fill={showOther}
                      className={
                        showOther ? "text-[var(--mg-accent)]" : "text-[var(--mg-muted)]"
                      }
                    />
                    <span className="mg-set-row-main">
                      <span className="mg-set-row-name">Markdown 以外も並べる</span>
                      <span className="mg-set-note">
                        画像・HTML・PDF と字で書かれたファイルをツリーに出す。切ると
                        読み物だけの一覧になる（1 枚だけ開く経路はどちらでも通る）
                      </span>
                    </span>
                    <span className={`mg-switch${showOther ? " is-on" : ""}`}>
                      <i />
                    </span>
                  </button>

                  <div className="mg-set-drop">
                    <span className="mg-set-row-name">一覧から外すもの</span>
                    <span className="mg-set-note">
                      1 行に 1 つ。<code>log</code> のように拡張子だけでも、
                      <code>*.min.js</code> のように <code>*</code>（任意の並び）と
                      <code>?</code>（1 文字）でも書ける。<code>#</code> で始まる行は覚書
                    </span>
                    <AutoTextarea
                      value={exclude}
                      onChange={(e) => setExclude(e.target.value)}
                      placeholder={"*.lock\nlog\n.DS_Store"}
                      minRows={3}
                      maxRows={10}
                      spellCheck={false}
                    />
                    <span className="mg-set-note">
                      {dropCount > 0 ? `${dropCount} 件で外しています` : "いまは何も外していません"}
                    </span>
                  </div>

                  <div className="mg-set-drop">
                    <span className="mg-set-row-name">取り込んだ画像の置き場所</span>
                    <span className="mg-set-note">
                      貼った画像・落とした画像は、文書と同じところに作ったこの名前の
                      フォルダへ入る。本文には <code>./{cleanDir(imageDir)}/…</code> として書かれる
                    </span>
                    <input
                      value={imageDir}
                      onChange={(e) => setImageDir(e.target.value)}
                      placeholder={DEFAULT_DIR}
                      spellCheck={false}
                    />
                  </div>
                </section>
              </>
            )}

            {tab === "beta" && (
              <section className="mg-set-sec">
                <h3>試験中の機能</h3>
                <button
                  type="button"
                  onClick={() => setLive(!live)}
                  className="mg-set-row"
                >
                  <Icon
                    name="edit_note"
                    size={18}
                    fill={live}
                    className={
                      live ? "text-[var(--mg-accent)]" : "text-[var(--mg-muted)]"
                    }
                  />
                  <span className="mg-set-row-main">
                    <span className="mg-set-row-name">
                      リアルタイム編集機能
                      <span className="mg-set-beta">Beta</span>
                    </span>
                    <span className="mg-set-note">
                      組版されたまま直接書ける編集面でファイルを開く。切ると読む画面になり、直すのは本文のダブルクリックから
                    </span>
                  </span>
                  <span className={`mg-switch${live ? " is-on" : ""}`}>
                    <i />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setNotion(!notion)}
                  className="mg-set-row"
                >
                  <Icon
                    name="keyboard"
                    size={18}
                    fill={notion}
                    className={
                      notion ? "text-[var(--mg-accent)]" : "text-[var(--mg-muted)]"
                    }
                  />
                  <span className="mg-set-row-main">
                    <span className="mg-set-row-name">
                      Notion 風の打ち込み
                      <span className="mg-set-beta">Beta</span>
                    </span>
                    <span className="mg-set-note">
                      {"`>` でトグル、`|` で引用を作る。切ると Markdown どおり `>` が引用"}
                    </span>
                  </span>
                  <span className={`mg-switch${notion ? " is-on" : ""}`}>
                    <i />
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setEditorial(!editorial)}
                  className="mg-set-row"
                >
                  <Icon
                    name="brush"
                    size={18}
                    fill={editorial}
                    className={
                      editorial
                        ? "text-[var(--mg-accent)]"
                        : "text-[var(--mg-muted)]"
                    }
                  />
                  <span className="mg-set-row-main">
                    <span className="mg-set-row-name">
                      メイクアップ版
                      <span className="mg-set-beta">Beta</span>
                    </span>
                    <span className="mg-set-note">
                      字間・行間から見出し・箇条書き・引用の組み方まで作り込んで描く
                    </span>
                  </span>
                  <span className={`mg-switch${editorial ? " is-on" : ""}`}>
                    <i />
                  </span>
                </button>
              </section>
            )}

            {tab === "app" && (
              <section className="mg-set-sec">
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
                        <Icon
                          name="progress_activity"
                          size={14}
                          className="mg-spin"
                        />
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
                {/* 押したら開く。案内だけ置いても、押して何も起きなければ
                    壊れていると受け取られる。 */}
                <button
                  type="button"
                  className="mg-set-row"
                  onClick={() => {
                    setOpen(false);
                    setShortcuts(true);
                  }}
                >
                  <Icon
                    name="keyboard"
                    size={18}
                    className="text-[var(--mg-muted)]"
                  />
                  <span className="mg-set-row-main">
                    <span className="mg-set-row-name">キー操作の一覧</span>
                    <span className="mg-set-note">⌘/ でいつでも開けます</span>
                  </span>
                  <Icon
                    name="chevron_right"
                    size={16}
                    className="text-[var(--mg-muted)]"
                  />
                </button>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
