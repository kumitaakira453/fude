import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useWorkspace } from "../hooks/useWorkspace";
import { RAIL_ROOM } from "../lib/sidebar";
import { closePane, splitInto } from "../lib/ui";
import {
  activeFolderIdAtom,
  activePaneIdAtom,
  soleAtom,
  canBackAtom,
  canForwardAtom,
  paletteOpenAtom,
  panesAtom,
  sidebarOpenAtom,
  sidebarTabAtom,
  railAtom,
  type Rail,
} from "../state/atoms";
import { openTotalAtom, reviewScreenAtom } from "../state/review";
import { AppIcon } from "./AppIcon";
import { MenuButton } from "./MenuButton";
import { Icon } from "./Icon";
import { SettingsButton } from "./SettingsButton";
import { draftRelAtom } from "../state/drafts";

// 右の欄に出せるもの。択一なので、そのまま 1 つの入口の中身になる。
const RAILS: { id: Rail; icon: string; label: string; keys?: string }[] = [
  { id: "none", icon: "right_panel_close", label: "出さない" },
  { id: "toc", icon: "toc", label: "目次", keys: "⌘⇧O" },
  { id: "comments", icon: "chat", label: "コメント", keys: "⌘⇧K" },
];
const RAIL_ICON: Record<Rail, string> = {
  none: "right_panel_close",
  toc: "toc",
  comments: "chat",
};

function IconButton({
  onClick,
  title,
  active,
  disabled,
  icon,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  icon: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      // 押した瞬間に縮める。押してから画面が変わるまでに間があるとき、
      // 手応えが無いと反応していないように見える。
      className={`grid h-8 w-8 place-items-center rounded-lg transition duration-100 active:scale-90 ${
        disabled
          ? "cursor-not-allowed text-[var(--mg-muted)] opacity-40"
          : active
            ? "bg-[var(--mg-accent-soft)] text-[var(--mg-accent)] hover:bg-[var(--mg-hover)]"
            : "text-[var(--mg-fg-dim)] hover:bg-[var(--mg-hover)]"
      }`}
    >
      <Icon name={icon} size={20} fill={active} />
    </button>
  );
}

export function Toolbar() {
  const store = useStore();
  const openTotal = useAtomValue(openTotalAtom);
  const isDraft = useAtomValue(draftRelAtom) !== null;
  const setReviewOpen = useSetAtom(reviewScreenAtom);
  const setActiveFolderId = useSetAtom(activeFolderIdAtom);
  const setSole = useSetAtom(soleAtom);
  const [sidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const [rail, setRail] = useAtom(railAtom);
  const [, setTab] = useAtom(sidebarTabAtom);
  const [, setPalette] = useAtom(paletteOpenAtom);
  const panes = useAtomValue(panesAtom);
  const canBack = useAtomValue(canBackAtom);
  const canForward = useAtomValue(canForwardAtom);
  const isSplit = panes.length > 1;
  const { holdDraft } = useWorkspace();

  const goHome = () => {
    setSole(null);
    setActiveFolderId(null);
  };
  const isLg = useMediaQuery(RAIL_ROOM);
  // 右の欄は lg 以上かつ単一ペインのときのみ表示可能
  const canRail = isLg && !isSplit;

  return (
    <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-[var(--mg-border)] bg-[var(--mg-panel)] px-2">
      <IconButton
        onClick={() => setSidebarOpen((v) => !v)}
        title="サイドバー (⌘B)"
        active={sidebarOpen}
        icon={sidebarOpen ? "left_panel_close" : "left_panel_open"}
      />
      <button
        onClick={() => {
          // 下書きのままなら、行き先を決めてから戻る。
          if (!holdDraft(goHome)) goHome();
        }}
        title="スタート画面へ"
        className="mx-1 flex select-none items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-[var(--mg-hover)]"
      >
        <AppIcon size={19} className="text-[var(--mg-accent)]" />
        <span className="mg-wordmark text-[15px] font-bold tracking-tight">
          fude
        </span>
      </button>

      <div className="mx-0.5 h-5 w-px bg-[var(--mg-border)]" />
      <IconButton
        onClick={() => history.back()}
        title="戻る (⌘[)"
        icon="arrow_back"
        disabled={!canBack}
      />
      <IconButton
        onClick={() => history.forward()}
        title="進む (⌘])"
        icon="arrow_forward"
        disabled={!canForward}
      />

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton
          onClick={() => setPalette(true)}
          title="クイックオープン (⌘P)"
          icon="bolt"
        />
        {/* 目次とコメントは同じ場所を取り合うので、択一として 1 つの入口に置く。 */}
        <MenuButton
          icon={RAIL_ICON[canRail ? rail : "none"]}
          title="右の欄"
          active={canRail && rail !== "none"}
          items={RAILS.map((it) => ({
            icon: it.icon,
            label: it.label,
            keys: it.keys,
            on: canRail ? rail === it.id : it.id === "none",
            disabled: !canRail && it.id !== "none",
            why: canRail ? undefined : "画面幅が狭い / 分割中は出せません",
            run: () => setRail(it.id),
          }))}
        />
        <MenuButton
          icon="splitscreen"
          title="分割"
          active={isSplit}
          items={[
            {
              icon: "vertical_split",
              label: "右に分割",
              keys: "⌘\\",
              run: () => splitInto(store, "row"),
            },
            {
              icon: "horizontal_split",
              label: "下に分割",
              run: () => splitInto(store, "col"),
            },
            {
              icon: "close_fullscreen",
              label: "分割を解除",
              disabled: !isSplit,
              run: () => closePane(store, store.get(activePaneIdAtom)),
            },
          ]}
        />
        <MenuButton
          icon="more_horiz"
          title="そのほか"
          items={[
            {
              icon: "search",
              label: "全文検索",
              keys: "⌘⇧F",
              run: () => {
                setSidebarOpen(true);
                setTab("search");
              },
            },
          ]}
        />
        <div className="mx-1 h-5 w-px bg-[var(--mg-border)]" />
        {/* 下書きには指摘を付けない。行き先が決まってからのものなので、
            一覧の口も閉じておく。 */}
        <button
          onClick={() => setReviewOpen(true)}
          disabled={isDraft}
          title={
            isDraft
              ? "コメントは保存先を決めてから"
              : openTotal > 0
                ? `コメント一覧 — このフォルダに未解決 ${openTotal} 件 (⌘⇧R)`
                : "コメント一覧 (⌘⇧R)"
          }
          className="relative flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] text-[var(--mg-muted)] transition hover:bg-[var(--mg-hover)] hover:text-[var(--mg-fg)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--mg-muted)]"
        >
          <Icon name="rate_review" size={18} />
          {openTotal > 0 && (
            <span className="rounded-full bg-[var(--mg-accent-soft)] px-1.5 text-[10.5px] font-medium text-[var(--mg-accent)]">
              {openTotal}
            </span>
          )}
        </button>
        <div className="mx-1 h-5 w-px bg-[var(--mg-border)]" />
        <SettingsButton />
      </div>
    </div>
  );
}
