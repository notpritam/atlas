import { reviewLegacySave } from "./legacy-review.js";
import * as db from "./db.js";
import {
  $,
  title,
  sourceUrl,
  domain,
  ago,
  icon,
  hydrateIcons,
  message,
  openDialog,
  wireDialog,
} from "./ui.js";
import { bindConnections } from "./connections.js";
const state = { type: "", tag: null, category: null, q: "" };
const types = [
  ["", "All captures", "grid"],
  ["screenshot", "Screenshots", "screenshot"],
  ["highlight", "Highlights", "highlight"],
  ["bookmark", "Links", "bookmark"],
  ["image", "Images", "image"],
  ["note", "Notes", "note"],
];
let gridUrls = [],
  detailUrls = [],
  loadSequence = 0,
  activeCapture,
  noteSaving = false;
hydrateIcons();
for (const id of ["overlay", "settings", "noteDialog"]) wireDialog($(id));
const connectionSettings = bindConnections($("connections"));
function release(urls) {
  urls.forEach(URL.revokeObjectURL);
  urls.length = 0;
}
function mediaUrl(blob, urls) {
  const url = URL.createObjectURL(blob);
  urls.push(url);
  return url;
}
const isFiltered = () =>
  !!(state.type || state.tag || state.category || state.q);
function textElement(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}
function renderCard(c) {
  const button = document.createElement("button");
  button.className = "capture-card";
  button.dataset.type = c.type;
  button.dataset.capture = c.id;
  button.dataset.focusKey = "capture:" + c.id;
  const visual = (c.type === "screenshot" || c.type === "image") && c.blob;
  if (visual) {
    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = "";
    img.loading = "lazy";
    img.src = mediaUrl(c.blob, gridUrls);
    button.append(img);
  }
  const body = document.createElement("span");
  body.className = "card-body";
  const meta = document.createElement("span");
  meta.className = "card-meta";
  meta.innerHTML = icon(c.type);
  meta.append(textElement("span", "", c.type === "bookmark" ? "Link" : c.type));
  const time = textElement("time", "", ago(c.createdAt));
  time.dateTime = new Date(c.createdAt).toISOString();
  meta.append(time);
  body.append(meta);
  body.append(
    textElement(
      "span",
      "card-title",
      c.type === "highlight" ? c.selectionText || title(c) : title(c),
    ),
  );
  if (!visual && c.type === "bookmark" && (c.description || c.articleText))
    body.append(
      textElement("span", "card-description", c.description || c.articleText),
    );
  body.append(
    textElement(
      "span",
      "card-source",
      c.sourceUrl ? domain(c.sourceUrl) : "Your notebook",
    ),
  );
  if (c.tags?.length) {
    const tags = document.createElement("span");
    tags.className = "card-tags";
    for (const tag of c.tags.slice(0, 4))
      tags.append(textElement("span", "card-tag", tag));
    body.append(tags);
  }
  button.append(body);
  button.onclick = () => openDetail(c.id, button).catch(showError);
  return button;
}
function renderFilters(all, facets) {
  $("typeFilters").replaceChildren();
  for (const [id, label, shape] of types) {
    const button = document.createElement("button");
    button.className = "nav-item" + (state.type === id ? " on" : "");
    button.dataset.type = id;
    button.dataset.focusKey = "type:" + id;
    button.setAttribute("aria-pressed", String(state.type === id));
    button.innerHTML = icon(shape);
    button.append(
      textElement("span", "", label),
      textElement(
        "span",
        "count",
        String(id ? all.filter((c) => c.type === id).length : all.length),
      ),
    );
    button.onclick = () => {
      state.type = id;
      load();
    };
    $("typeFilters").append(button);
  }
  $("tagFilters").replaceChildren();
  $("tagEmpty").hidden = !!facets.tags.length;
  for (const tag of facets.tags.slice(0, 12)) {
    const button = document.createElement("button");
    button.dataset.focusKey = "tag:" + tag.name;
    button.className =
      "nav-item tag-filter" + (state.tag === tag.name ? " on" : "");
    button.setAttribute("aria-pressed", String(state.tag === tag.name));
    button.append(
      textElement("span", "tag-symbol", "#"),
      textElement("span", "tag-name", tag.name),
      textElement("span", "count", String(tag.count)),
    );
    button.onclick = () => {
      state.tag = state.tag === tag.name ? null : tag.name;
      load();
    };
    $("tagFilters").append(button);
  }
  $("facetFilters").replaceChildren();
  for (const category of facets.categories.slice(0, 6)) {
    const button = textElement(
      "button",
      "category" + (state.category === category.name ? " on" : ""),
      category.name,
    );
    button.dataset.focusKey = "category:" + category.name;
    button.setAttribute(
      "aria-pressed",
      String(state.category === category.name),
    );
    button.onclick = () => {
      state.category = state.category === category.name ? null : category.name;
      load();
    };
    $("facetFilters").append(button);
  }
  $("resetFilters").hidden = !isFiltered();
  $("libraryTitle").replaceChildren(
    document.createTextNode(
      state.tag ? `#${state.tag}` : types.find((t) => t[0] === state.type)[1],
    ),
    textElement("span", "accent", "."),
  );
}
function showError(error) {
  $("loadError").hidden = false;
  message(
    $("loadError"),
    error?.message || "Could not load your library. Reload to try again.",
  );
}
async function load() {
  const sequence = ++loadSequence;
  try {
    const all = await db.listCaptures({ limit: 100000 });
    const rows = db.filterCaptureRows(all, { ...state, limit: 100000 });
    const facets = db.facetsFrom(all);
    if (sequence !== loadSequence) return;
    if ($("sort").value === "oldest") rows.reverse();
    const focused = document.activeElement,
      focusKey = focused?.dataset?.focusKey;
    release(gridUrls);
    $("grid").replaceChildren(...rows.map(renderCard));
    $("grid").hidden = !rows.length;
    $("empty").hidden = !!rows.length;
    $("loadError").hidden = true;
    $("totalCount").textContent =
      `${all.length} ${all.length === 1 ? "capture" : "captures"} saved`;
    $("resultCount").textContent =
      `${rows.length} ${rows.length === 1 ? "capture" : "captures"}`;
    $("emptyTitle").textContent = isFiltered()
      ? "Nothing here just yet."
      : "Make room for a good find.";
    $("emptyCopy").textContent = isFiltered()
      ? "Try another keyword or clear your filters to see all your captures."
      : "Use the FoundKeep extension to keep a page, an image, or a line that stays with you. Your captures will appear here.";
    $("emptyAction").textContent = isFiltered()
      ? "Clear filters"
      : "Write your first note";
    renderFilters(all, facets);
    if (focusKey && !focused.isConnected)
      document.querySelectorAll("[data-focus-key]").forEach((el) => {
        if (el.dataset.focusKey === focusKey) el.focus({ preventScroll: true });
      });
  } catch (error) {
    if (sequence === loadSequence) showError(error);
  }
}
function resetFilters() {
  clearTimeout(searchTimer);
  Object.assign(state, { type: "", tag: null, category: null, q: "" });
  $("q").value = "";
  load();
}
function detailField(label, value) {
  const section = document.createElement("section");
  section.className = "detail-field";
  section.append(textElement("h3", "", label), textElement("p", "", value));
  return section;
}
async function openDetail(id, opener) {
  const c = await db.getCapture(id);
  if (!c) return;
  activeCapture = c;
  release(detailUrls);
  const body = $("detailBody");
  body.replaceChildren();
  $("detailType").textContent =
    `${c.type === "bookmark" ? "Link" : c.type} · Saved locally`;
  const source = sourceUrl(c.sourceUrl);
  $("sourceLink").hidden = !source;
  $("sourceLink").removeAttribute("href");
  if (source) $("sourceLink").href = source;
  if (c.blob && ["screenshot", "image"].includes(c.type)) {
    const img = document.createElement("img");
    img.className = "full";
    img.alt = c.description || c.sourceTitle || "Saved capture";
    img.src = mediaUrl(c.blob, detailUrls);
    body.append(img);
  }
  const heading = textElement("h2", "", title(c));
  heading.id = "detailTitle";
  body.append(heading);
  if (c.type === "highlight" && c.selectionText)
    body.append(textElement("blockquote", "", c.selectionText));
  if (c.type === "note" && c.noteText)
    body.append(detailField("Note", c.noteText));
  if (c.summary && c.summary !== title(c))
    body.append(detailField("Summary", c.summary));
  if (c.description) body.append(detailField("Description", c.description));
  if (c.category || c.tags?.length)
    body.append(
      detailField(
        "Filed under",
        [c.category, ...(c.tags || []).map((t) => "#" + t)]
          .filter(Boolean)
          .join(" · "),
      ),
    );
  if (c.articleText) body.append(detailField("Saved page text", c.articleText));
  if (c.ocrText) body.append(detailField("Recognized text", c.ocrText));
  if (c.cloudAccountId)
    body.append(
      detailField(
        "Account sync",
        c.cloudStatus === "synced"
          ? "Saved to your FoundKeep account. Open the dashboard for its organized version."
          : c.cloudError ||
              "Saved in this browser and waiting to sync to its connected account.",
      ),
    );
  $("detailDate").textContent = new Date(c.createdAt).toLocaleString(
    undefined,
    { dateStyle: "medium", timeStyle: "short" },
  );
  history.replaceState(null, "", `#capture=${encodeURIComponent(id)}`);
  openDialog($("overlay"), opener);
}
$("closeDetail").onclick = () => $("overlay").close();
$("overlay").addEventListener("close", () => {
  release(detailUrls);
  activeCapture = null;
  history.replaceState(null, "", location.pathname + location.search);
});
$("deleteCapture").onclick = async () => {
  if (
    !activeCapture ||
    !confirm(
      "Delete this capture from this browser? Its account copy, if synced, stays in your dashboard. This local deletion cannot be undone.",
    )
  )
    return;
  try {
    await db.deleteCapture(activeCapture.id);
    $("overlay").close();
    await load();
    $("q").focus();
  } catch (error) {
    showError(error);
  }
};
$("settingsBtn").onclick = async () => {
  openDialog($("settings"));
  try {
    await connectionSettings.load();
  } catch {
    message(
      $("dataFeedback"),
      "Could not load settings. Close and reopen to retry.",
      "error",
    );
  }
};
$("settingsClose").onclick = () => $("settings").close();
$("exportBtn").onclick = async () => {
  try {
    const rows = await db.listCaptures({ limit: 100000 });
    const clean = rows.map(({ blob, ...row }) => ({ ...row, hasBlob: !!blob }));
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `foundkeep-metadata-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    message(
      $("dataFeedback"),
      "Metadata export downloaded. Image files are not included.",
      "success",
    );
  } catch {
    message(
      $("dataFeedback"),
      "Could not export metadata. Try again.",
      "error",
    );
  }
};
$("clearBtn").onclick = async () => {
  if (!confirm("Delete ALL captures from this browser? This cannot be undone."))
    return;
  try {
    await db.clearAll();
    $("settings").close();
    resetFilters();
  } catch {
    message(
      $("dataFeedback"),
      "Could not clear the library. Try again.",
      "error",
    );
  }
};
function newNote() {
  message($("noteFeedback"), "");
  openDialog($("noteDialog"));
  $("libraryNote").focus();
}
$("newNote").onclick = newNote;
$("noteClose").onclick = () => $("noteDialog").close();
$("emptyAction").onclick = () => (isFiltered() ? resetFilters() : newNote());
$("resetFilters").onclick = resetFilters;
$("noteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const draft = $("libraryNote").value,
    text = draft.trim();
  if (!text || noteSaving) return;
  noteSaving = true;
  $("saveLibraryNote").disabled = true;
  try {
    await reviewLegacySave('note', { text, attachPage: false });
    message($("noteFeedback"), "Choose where to save in the sidebar. Your draft stays here until you finish.");
  } catch {
    message(
      $("noteFeedback"),
      "Could not save. Your draft is still here; try again.",
      "error",
    );
  } finally {
    noteSaving = false;
    $("saveLibraryNote").disabled = false;
  }
});
$("libraryNote").addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    $("noteForm").requestSubmit();
  }
});
let searchTimer;
$("q").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const query = e.target.value.trim();
  searchTimer = setTimeout(() => {
    state.q = query;
    load();
  }, 160);
});
$("sort").onchange = load;
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) &&
    !document.querySelector("dialog[open]")
  ) {
    e.preventDefault();
    $("q").focus();
  }
});
chrome.runtime.onMessage.addListener((m) => {
  if (m.kind === "atlas-changed") {
    load();
    if ($("settings").open) connectionSettings.refreshCloud();
  }
});
window.addEventListener("focus", load);
window.addEventListener("pagehide", () => {
  release(gridUrls);
  release(detailUrls);
});
load().then(() => {
  const id = new URLSearchParams(location.hash.slice(1)).get("capture");
  if (id) openDetail(id, $("q")).catch(showError);
});
