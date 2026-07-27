/**
 * Handing a generated file to the browser.
 *
 * The object URL is revoked on the next frame rather than immediately: some
 * browsers have not started reading the blob by the time click() returns, and
 * revoking too early produces a silently empty download.
 */

export const downloadText = (filename: string, text: string, mimeType: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  requestAnimationFrame(() => URL.revokeObjectURL(url));
};
