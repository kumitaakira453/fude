// 画面の周り（ボタン・メニュー・欄）の絵。Tabler Icons の線画で描く。
//
// 部品はこれまでどおり Material Symbols の名前で絵を指す。ここに対応がある名前は
// Tabler の線画で描き、無い名前（本文の注記の印・書式の絵など）は今の字形のまま
// 出す。線の太さと形を 1 系統にそろえ、柔らかい塗りの絵を周りから無くすため。

const outline = import.meta.glob(
  "/node_modules/@tabler/icons/icons/outline/{x,trash,loader-2,copy,check,external-link,folder,plus,folder-open,file-text,chevron-right,chevron-down,chevron-up,pencil,arrows-maximize,link,grip-vertical,folder-plus,selector,file-plus,code,message-circle,sparkles,message-plus,search,device-floppy,dots-vertical,dots,unlink,history,messages,list,bolt,arrow-right,arrow-left,binary-tree,eye,eye-off,layout-columns,layout-rows,arrows-horizontal,message-2,keyboard,info-circle,photo,arrow-up,arrow-down,checks,circle-check,square,square-check,settings,toggle-right,list-tree,terminal-2,switch-horizontal,send,rocket,layout-sidebar,layout-sidebar-left-collapse,layout-sidebar-left-expand,layout-sidebar-right,layout-sidebar-right-collapse,arrow-back-up,restore,current-location,palette,list-details,html,file-diff,copy-plus,tag,zoom-out,zoom-in,maximize,arrow-bar-to-up,arrow-bar-to-down,playlist-x,icons,folders,mail,minus,file-pencil,clock,layers-subtract,arrow-autofit-width,minimize,file-code}.svg",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const filled = import.meta.glob(
  "/node_modules/@tabler/icons/icons/filled/{square-check,circle-check,folder,folders}.svg",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

function inners(raw: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [path, svg] of Object.entries(raw)) {
    const name = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
    const inner = svg
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none" \/>/, "")
      .replace(/>\s+</g, "><")
      .trim();
    out.set(name, inner);
  }
  return out;
}

const LINE = inners(outline);
const SOLID = inners(filled);

// Material Symbols の名前 → Tabler の名前。1 つの意味に 1 つの絵を当てる。
export const UI_ICONS: Record<string, string> = {
  close: "x",
  cancel: "x",
  delete: "trash",
  progress_activity: "loader-2",
  content_copy: "copy",
  file_copy: "copy",
  check: "check",
  done: "check",
  done_all: "checks",
  check_circle: "circle-check",
  check_box: "square-check",
  check_box_outline_blank: "square",
  open_in_new: "external-link",
  folder: "folder",
  folder_open: "folder-open",
  folder_copy: "folders",
  folders: "folders",
  add: "plus",
  remove: "minus",
  description: "file-text",
  draft: "file-pencil",
  edit_note: "file-pencil",
  chevron_right: "chevron-right",
  expand_more: "chevron-down",
  expand_less: "chevron-up",
  keyboard_arrow_up: "chevron-up",
  keyboard_arrow_down: "chevron-down",
  edit: "pencil",
  drive_file_rename_outline: "pencil",
  zoom_out_map: "arrows-maximize",
  fit_screen: "maximize",
  link: "link",
  link_off: "unlink",
  drag_indicator: "grip-vertical",
  create_new_folder: "folder-plus",
  note_add: "file-plus",
  unfold_more: "selector",
  unfold_less: "layers-subtract",
  code: "code",
  html: "html",
  chat_bubble: "message-circle",
  chat: "message-circle",
  forum: "messages",
  rate_review: "messages",
  add_comment: "message-plus",
  auto_awesome: "sparkles",
  search: "search",
  save: "device-floppy",
  save_as: "device-floppy",
  more_vert: "dots-vertical",
  more_horiz: "dots",
  history: "history",
  restore: "restore",
  undo: "arrow-back-up",
  format_list_bulleted: "list",
  list: "list",
  list_alt: "list-details",
  toc: "list-tree",
  account_tree: "binary-tree",
  bolt: "bolt",
  arrow_forward: "arrow-right",
  arrow_back: "arrow-left",
  arrow_upward: "arrow-up",
  arrow_downward: "arrow-down",
  visibility: "eye",
  visibility_off: "eye-off",
  vertical_split: "layout-columns",
  splitscreen: "layout-columns",
  horizontal_split: "layout-rows",
  swap_horiz: "arrows-horizontal",
  sync_alt: "switch-horizontal",
  keyboard: "keyboard",
  info: "info-circle",
  image: "photo",
  tune: "settings",
  toggle_on: "toggle-right",
  terminal: "terminal-2",
  send: "send",
  rocket_launch: "rocket",
  left_panel_open: "layout-sidebar-left-expand",
  left_panel_close: "layout-sidebar-left-collapse",
  right_panel_close: "layout-sidebar-right-collapse",
  my_location: "current-location",
  palette: "palette",
  difference: "file-diff",
  playlist_remove: "playlist-x",
  interests: "icons",
  close_fullscreen: "minimize",
  vertical_align_top: "arrow-bar-to-up",
  vertical_align_bottom: "arrow-bar-to-down",
  zoom_in: "zoom-in",
  zoom_out: "zoom-out",
  label: "tag",
  mail: "mail",
  schedule: "clock",
  viewport: "arrow-autofit-width",
  code_blocks: "file-code",
  workspaces: "folders",
};

// 線画の中身（外枠を除いた SVG の要素）。塗りを頼まれ、塗りの形があればそれを返す。
export function uiGlyph(name: string, fill = false): { inner: string; solid: boolean } | null {
  const tabler = UI_ICONS[name];
  if (!tabler) return null;
  const solid = fill ? SOLID.get(tabler) : undefined;
  if (solid) return { inner: solid, solid: true };
  const line = LINE.get(tabler);
  return line ? { inner: line, solid: false } : null;
}

// 対応表に挙げた Tabler の名前（取り込み漏れを試験で拾う）。
export const usedUiGlyphs = (): string[] => [...new Set(Object.values(UI_ICONS))];
export const hasUiGlyph = (tabler: string): boolean => LINE.has(tabler);
