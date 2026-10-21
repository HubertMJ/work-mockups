// The vLLM manager mock-up (/work/vllm/): a full-page app that runs entirely in the browser on
// made-up data, with the slim bar's About drawer. The theme switch and ASCII mode as on every page
// (this page has no switch button and no banner, so both stay quiet unless asked).

import { setupAscii } from "./ascii";
import { mountNodePanels } from "./node-panel";
import { setupThemeToggle } from "./lib/theme-toggle";
import { setupAbout } from "./vllm/demo/about";
import { mountDemo } from "./vllm/demo/app";

document.documentElement.classList.add("js");
setupThemeToggle();
setupAscii(document.body.dataset.banner ?? "");
setupAbout();
// The About drawer's drawing: a box's details under it, as on the other pages.
mountNodePanels();
const root = document.getElementById("vdemo");
if (root) mountDemo(root);
