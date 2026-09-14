import { bindCloud } from "./cloud-ui.js";

export function bindConnections(container, options = {}) {
  container.innerHTML = `<div id="accountSettings"></div>
    <section class="setting-group"><h3>Local library</h3><p>Copies stay in this browser. Keep the extension installed to retain them. Deleting a local copy does not delete its account copy; manage account captures in your library.</p></section>`;
  const field = (id) => container.querySelector("#" + id);
  const cloud = bindCloud(field("accountSettings"), options);
  return {
    refreshCloud: cloud.load,
    load: cloud.load,
  };
}
