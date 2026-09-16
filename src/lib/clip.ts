// 写し取り。
//
// ブラウザの口（navigator.clipboard）は安全な場（secure context）と、押した直後で
// あることを要る。アプリの画面は Tauri の独自の綴りで開いているので、口が無いか
// 断られる。アプリの中ではアプリ側（Rust）の口へ通し、その決まりから外れる。
//
// 成否は返す。黙って諦めると、写せたつもりで貼りに行かれる。

const inApp = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function copyText(text: string): Promise<boolean> {
  if (inApp()) {
    try {
      // 荷はアプリの中でだけ読む。
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      // アプリ側が使えないときは、ブラウザの口へ落ちる。
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// 画像をそのまま写し取る。
//
// 窓に描かせてから画素を取り出す。書式（jpeg / webp / heic …）ごとの解き方を
// こちらで持たずに済み、窓が描けるものは何でも写せる。アプリ側へ渡すのは
// 生の画素なので、Rust 側に絵の解読を足す必要も無い。
export async function copyImage(url: string): Promise<boolean> {
  try {
    const img = document.createElement("img");
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const paint = canvas.getContext("2d");
    // 寸法を持たない絵（寸法の無い SVG など）は描けない。
    if (!paint || !canvas.width || !canvas.height) return false;
    paint.drawImage(img, 0, 0);
    const { data } = paint.getImageData(0, 0, canvas.width, canvas.height);
    const { Image } = await import("@tauri-apps/api/image");
    const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const held = await Image.new(new Uint8Array(data), canvas.width, canvas.height);
    await writeImage(held);
    return true;
  } catch {
    return false;
  }
}
