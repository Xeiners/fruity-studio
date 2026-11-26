import { call } from "./invoke";

export type NetworkId = "tiktok" | "youtube";

export interface NetworkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Les appels s'executent dans l'ordre : afficher puis masquer ne doit jamais s'inverser.
let queue: Promise<unknown> = Promise.resolve();

function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

export const networksApi = {
  show: (id: NetworkId, bounds: NetworkBounds) => inOrder(() => call<void>("network_show", { id, bounds })),
  setBounds: (id: NetworkId, bounds: NetworkBounds) => inOrder(() => call<void>("network_set_bounds", { id, bounds })),
  hideAll: () => inOrder(() => call<void>("network_hide_all")),
  reload: (id: NetworkId) => call<void>("network_reload", { id }),
  openExternal: (id: NetworkId) => call<void>("network_open_external", { id }),
};
