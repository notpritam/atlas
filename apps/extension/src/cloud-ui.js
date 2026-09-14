import { CUSTOMER_ORIGIN } from "./cloud.js";
import { PRODUCT_NAME } from "./product.js";
import { message } from "./ui.js";

export function cloudMarkup({ compact = false } = {}) {
  const markup = `<section class="cloud-panel ${compact ? "compact" : ""}" aria-label="FoundKeep account">
    <div class="cloud-heading"><strong id="cloudAccount">Keep your finds together.</strong><button class="btn ${compact ? "secondary" : "primary"}" id="cloudAction" type="button">Connect ${PRODUCT_NAME}</button></div>
    <p id="cloudStatus" class="fine" role="status">Connect an account to sync new captures. Your local library stays available.</p>
    <div class="cloud-actions"><button class="cloud-text-button" id="cloudRetry" type="button" hidden>Try sync again</button>
    ${compact ? "" : `<button class="cloud-text-button" id="cloudImport" type="button" hidden>Import local captures</button><button class="cloud-text-button" id="cloudDisconnect" type="button" hidden>Disconnect this browser</button>`}</div>
    ${compact ? "" : `<p class="fine" id="cloudHistory"></p><div id="cloudImportPrompt" class="notice" hidden><p id="cloudImportText"></p><div class="cloud-actions"><button class="btn primary" id="cloudImportConfirm" type="button">Import captures</button><button class="btn secondary" id="cloudImportCancel" type="button">Cancel</button></div></div>`}
    <p id="cloudFeedback" class="statusline" role="status"></p>
  </section>`;
  return compact ? markup.replaceAll('id="cloud', 'id="popup-cloud') : markup;
}
export function bindCloud(
  container,
  { compact = false, showDashboard = true, onStatus = () => {} } = {},
) {
  container.innerHTML = cloudMarkup({ compact });
  const field = (id) =>
    container.querySelector("#" + (compact ? "popup-" : "") + id);
  let state = null,
    importAccount = null,
    sequence = 0;
  const request = async (message) => {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok)
      throw new Error(
        result?.error ||
          "Could not read your connection. Reopen FoundKeep and try again.",
      );
    return result;
  };
  const openAccount = () =>
    chrome.tabs
      .create({ url: CUSTOMER_ORIGIN + "/dashboard" })
      .catch(() =>
        message(
          field("cloudFeedback"),
          "Could not open FoundKeep. Try again.",
          "error",
        ),
      );
  field("cloudAction").onclick = openAccount;
  async function load() {
    const current = ++sequence;
    try {
      const result = await request({ kind: "cloud-status" });
      if (current !== sequence) return;
      state = result;
      field("cloudAccount").textContent =
        state.account?.email || "Keep your finds together.";
      field("cloudAction").hidden = !showDashboard && !!state.account && state.status !== "reconnect";
      field("cloudAction").textContent =
        state.status === "reconnect"
          ? "Reconnect"
          : state.account
            ? "Dashboard"
            : `Connect ${PRODUCT_NAME}`;
      const detail =
        state.status === "reconnect"
          ? "Reconnect this browser to resume syncing. Your captures are safe locally."
          : state.error
            ? state.error
            : state.account
              ? state.pending
                ? `${state.pending} capture${state.pending === 1 ? "" : "s"} waiting to sync. Saved in this browser.`
                : "New captures sync to your account. A copy stays in this browser."
              : "Connect an account to sync new captures. Your local library stays available.";
      message(field("cloudStatus"), detail, state.error ? "error" : "");
      field("cloudRetry").hidden =
        !state.account ||
        state.status === "reconnect" ||
        !(state.pending || state.failed || state.error);
      if (!compact) {
        field("cloudImport").hidden =
          !state.account || state.status === "reconnect" || !state.localOnly;
        field("cloudDisconnect").hidden = !state.account;
        field("cloudHistory").textContent = [
          state.localOnly
            ? `${state.localOnly} capture${state.localOnly === 1 ? " is" : "s are"} only in this browser. Importing is optional.`
            : "",
          state.otherAccount
            ? `${state.otherAccount} capture${state.otherAccount === 1 ? " stays" : "s stay"} assigned to a previous account.`
            : "",
        ]
          .filter(Boolean)
          .join(" ");
      }
      if (state.notice) message(field("cloudFeedback"), state.notice, "error");
      onStatus(state);
    } catch (error) {
      message(field("cloudStatus"), error.message, "error");
    }
    return state;
  }
  field("cloudRetry").onclick = async () => {
    field("cloudRetry").disabled = true;
    try {
      await request({ kind: "cloud-retry" });
      message(field("cloudFeedback"), "Trying sync again…");
      await load();
    } catch (error) {
      message(field("cloudFeedback"), error.message, "error");
    } finally {
      field("cloudRetry").disabled = false;
    }
  };
  if (!compact) {
    field("cloudImport").onclick = async () => {
      await load();
      if (!state?.account) return;
      importAccount = state.account.id;
      field("cloudImportText").textContent =
        `Upload ${state.localOnly} local capture${state.localOnly === 1 ? "" : "s"}, including their images and text, to ${state.account.email}? Captures assigned to another account will stay with that account.`;
      field("cloudImportPrompt").hidden = false;
      field("cloudImportCancel").focus();
    };
    field("cloudImportCancel").onclick = () => {
      field("cloudImportPrompt").hidden = true;
      importAccount = null;
      field("cloudImport").focus();
    };
    field("cloudImportConfirm").onclick = async () => {
      field("cloudImportConfirm").disabled = true;
      try {
        const result = await request({
          kind: "cloud-import",
          confirmed: true,
          accountId: importAccount,
        });
        field("cloudImportPrompt").hidden = true;
        importAccount = null;
        message(
          field("cloudFeedback"),
          `${result.imported} captures queued for your account. Copies stay in this browser.`,
          "success",
        );
        await load();
      } catch (error) {
        message(field("cloudFeedback"), error.message, "error");
      } finally {
        field("cloudImportConfirm").disabled = false;
      }
    };
    field("cloudDisconnect").onclick = async () => {
      if (
        !confirm(
          "Disconnect this browser from FoundKeep? Captures stay in this browser. Unsent captures remain assigned to their current account.",
        )
      )
        return;
      try {
        const result = await request({ kind: "cloud-disconnect" });
        await load();
        message(
          field("cloudFeedback"),
          result.warning ||
            "Disconnected. This browser credential has been revoked.",
          result.warning ? "error" : "success",
        );
      } catch (error) {
        await load();
        message(field("cloudFeedback"), error.message, "error");
      }
    };
  }
  return { load };
}
