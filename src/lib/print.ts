"use client";

/**
 * Print just one element (the visit sheet, the emergency card) instead of
 * the whole app. Clones the element into a blank window with the page's
 * stylesheets and a light theme, then prints.
 */
export function printElement(el: HTMLElement, title = "Hypochondriac") {
  const w = window.open("", "_blank", "noopener,width=820,height=1000");
  if (!w) {
    window.print();
    return;
  }
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((n) => n.outerHTML)
    .join("\n");
  w.document.write(`<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${styles}
<style>
  html,body{background:#fff !important;color:#000 !important;margin:0}
  body{padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .no-print{display:none !important}
  @page{margin:16mm}
</style></head><body>${el.outerHTML}</body></html>`);
  w.document.close();
  // Give fonts/styles a beat to apply.
  w.setTimeout(() => {
    w.focus();
    w.print();
  }, 300);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
