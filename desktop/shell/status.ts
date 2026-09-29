/**
 * Status page script. The main process encodes the state in the query string;
 * everything is written with textContent, never as HTML.
 */

import type { ShellAction } from "../shared/constants";

const LABELS: Record<ShellAction, string> = {
  retry: "Try again",
  quit: "Quit Voltline",
  "restart-server": "Restart local server",
  "reload-window": "Reload window",
  dismiss: "Dismiss",
};

interface ShellApi {
  act(action: ShellAction): Promise<boolean>;
}

function render() {
  const params = new URLSearchParams(location.search);
  const kind = params.get("kind") ?? "starting";
  const card = document.querySelector("main");
  if (card) card.dataset.kind = kind;
  const title = params.get("title") ?? "Starting Voltline…";
  document.title = `Voltline — ${title}`;
  (document.getElementById("title") as HTMLElement).textContent = title;
  (document.getElementById("message") as HTMLElement).textContent = params.get("message") ?? "";
  const detail = document.getElementById("detail") as HTMLElement;
  const detailText = params.get("detail") ?? "";
  detail.textContent = detailText;
  detail.hidden = detailText.length === 0;

  const actions = document.getElementById("actions") as HTMLElement;
  actions.replaceChildren();
  const api = (window as unknown as { voltlineShell?: ShellApi }).voltlineShell;
  const requested = (params.get("actions") ?? "").split(",").filter(Boolean) as ShellAction[];
  requested.forEach((action, index) => {
    if (!(action in LABELS)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = LABELS[action];
    button.dataset.action = action;
    button.dataset.testid = `shell-action-${action}`;
    if (index === 0) button.className = "primary";
    button.addEventListener("click", () => {
      for (const other of actions.querySelectorAll("button")) other.disabled = true;
      void (api?.act(action) ?? Promise.resolve(false)).then((accepted) => {
        if (!accepted) for (const other of actions.querySelectorAll("button")) other.disabled = false;
      });
    });
    actions.append(button);
  });
}

render();
