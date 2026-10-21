// The /work/ description pages (real systems, written up for this site, no real code): the theme switch and the hidden
// ASCII mode, as on every page. The banner's words come from the page (<body data-banner>).

import { setupAscii } from "./ascii";
import { mountNodePanels } from "./node-panel";
import { setupThemeToggle } from "./lib/theme-toggle";

document.documentElement.classList.add("js");
setupThemeToggle();
setupAscii(document.body.dataset.banner ?? "Hubert Jablonski");
// The drawings: pointing at a box, tapping or focusing it shows its details under the drawing.
mountNodePanels();
