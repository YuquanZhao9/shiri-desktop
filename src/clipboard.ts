// 复制文字：电脑版走系统剪贴板（主进程拒绝了页面的所有权限，navigator.clipboard 会失败），
// 网页先用 Clipboard API，不行再用 execCommand（部分 iOS / 非安全上下文）。

type DesktopCopy = { copyText?: (text: string) => Promise<{ ok: boolean; error?: string }> };

export async function copyText(text: string): Promise<void> {
  const desktop = (window as unknown as { desktop?: DesktopCopy }).desktop;
  if (desktop?.copyText) {
    const result = await desktop.copyText(text);
    if (result.ok) return;
  }
  try { await navigator.clipboard.writeText(text); return; } catch { /* 下面再试 */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('复制失败');
}
