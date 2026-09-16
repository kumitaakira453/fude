// 写し取り。使えない場（許可の無い文脈・古い WebView）もあるので、
// 成否を返して呼び手に知らせる。黙って諦めると、写せたつもりで貼りに行かれる。

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
