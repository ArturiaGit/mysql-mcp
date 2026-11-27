export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }

  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    const activeDialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
    const mount = activeDialog ?? document.body;
    mount.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    if (textarea) {
      textarea.value = '';
      textarea.remove();
    }
  }
}
