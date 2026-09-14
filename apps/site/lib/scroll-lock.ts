// Dialogs and drawers can overlap and close in either order.
let locks = 0;
let originalOverflow = '';
export function lockDocumentScroll() {
  if (locks++ === 0) { originalOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = originalOverflow;
  };
}
