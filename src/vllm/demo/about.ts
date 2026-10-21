// The slim bar's "About": a drawer about the real system this mock-up stands in for. The dialog is in the page's HTML
// (static words); this only opens it, keeps Tab inside it and gives focus back to the button.

import { trapTab } from "./ui";

export function setupAbout(): void {
  const dlg = document.getElementById("vd-about");
  const open = document.getElementById("vd-about-open");
  if (!(dlg instanceof HTMLDialogElement) || !open) return;
  trapTab(dlg);
  open.addEventListener("click", () => {
    dlg.showModal();
    dlg.querySelector<HTMLElement>("#vd-about-close")?.focus({ preventScroll: true });
  });
  for (const id of ["vd-about-close", "vd-about-done"]) document.getElementById(id)?.addEventListener("click", () => dlg.close());
  // Escape closes a modal dialog natively; either way focus goes back to the button that opened it.
  dlg.addEventListener("close", () => open.focus({ preventScroll: true }));
}
