import { api } from "./api.js";

if (window.location.hostname === "0.0.0.0") {
    const normalized = `${window.location.protocol}//localhost:${window.location.port}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(normalized);
}

const state = {
    user: null,
    lists: [],
    selectedListId: null,
    sentences: [],
    pendingSessions: [],
    settings: null,
    view: "dashboard",
    openSessionId: null,
    openSession: null,
    selectedSentenceId: null,
    mindMapData: null,
    mindMapPositions: {},
    mindMapLastPositions: null,
    draggingNodeId: null,
    mindMapJustDragged: false,
    currentSection: 0,
    listSearchQuery: "",
    sentencesPage: 0,
    sentencesHasMore: false,
    sentencesLoading: false,
    savedListScrollY: 0,
    mindMapScale: 1,
    mindMapPan: { x: 0, y: 0 },
    mindMapUserPan: { x: 0, y: 0 },
    mindMapPanning: false,
    mindMapFullscreenParent: null,
    openedListFromMindMap: false,
    restoreMindMapFullscreen: false
};

const appEl = document.getElementById("app");
const userBarEl = document.getElementById("userBar");

function html(strings, ...values) {
    return strings.reduce((acc, chunk, i) => acc + chunk + (values[i] ?? ""), "");
}

function escapeHtml(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;");
}

function notify(message) {
    window.alert(message);
}

function renderSentenceWithWordLinks(content) {
    if (!content || typeof content !== "string") return escapeHtml(content);
    return content.replace(/\w+(?:'\w+)*/g, (match) => {
        const safe = escapeHtml(match);
        const key = escapeHtml(match.toLowerCase());
        return `<span class="dict-word" data-word="${key}" title="Click to look up">${safe}</span>`;
    });
}

const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en";

let definitionModalEl = null;

function showDefinitionModal(word, isLoading = true, definitions = null, error = null) {
    if (!definitionModalEl) {
        definitionModalEl = document.createElement("div");
        definitionModalEl.id = "definitionModal";
        definitionModalEl.className = "definition-modal";
        definitionModalEl.innerHTML = `
          <div class="definition-modal-backdrop"></div>
          <div class="definition-modal-box">
            <div class="definition-modal-header">
              <h3 class="definition-modal-word"></h3>
              <button type="button" class="definition-modal-close" title="Close">&times;</button>
            </div>
            <div class="definition-modal-body"></div>
          </div>
        `;
        definitionModalEl.querySelector(".definition-modal-backdrop").addEventListener("click", hideDefinitionModal);
        definitionModalEl.querySelector(".definition-modal-close").addEventListener("click", hideDefinitionModal);
        document.body.appendChild(definitionModalEl);
    }
    const wordEl = definitionModalEl.querySelector(".definition-modal-word");
    const bodyEl = definitionModalEl.querySelector(".definition-modal-body");
    wordEl.textContent = word;
    if (isLoading) {
        bodyEl.innerHTML = "<p class=\"definition-loading\">Loading…</p>";
    } else if (error) {
        bodyEl.innerHTML = `<p class="definition-error">${escapeHtml(error)}</p>`;
    } else if (definitions && definitions.length > 0) {
        bodyEl.innerHTML = definitions.map((d) => `
          <div class="definition-item">
            <span class="definition-pos">${escapeHtml(d.partOfSpeech || "")}</span>
            <p class="definition-text">${escapeHtml(d.definition || "")}</p>
          </div>
        `).join("");
    } else {
        bodyEl.innerHTML = "<p class=\"definition-error\">No definition found.</p>";
    }
    definitionModalEl.classList.add("is-open");
}

function hideDefinitionModal() {
    if (definitionModalEl) definitionModalEl.classList.remove("is-open");
}

async function lookupWord(wordOrPhrase, fallbackWord = null) {
    const word = String(wordOrPhrase || "").trim().toLowerCase();
    if (!word) return;
    showDefinitionModal(word, true);
    try {
        const url = `${DICTIONARY_API}/${encodeURIComponent(word)}`;
        const res = await fetch(url);
        if (!res.ok) {
            if (res.status === 404 && fallbackWord) {
                return lookupWord(fallbackWord);
            }
            if (res.status === 404) {
                showDefinitionModal(word, false, null, "No definition found for \"" + word + "\".");
            } else {
                showDefinitionModal(word, false, null, "Could not load definition.");
            }
            return;
        }
        const data = await res.json();
        const out = [];
        for (const entry of data) {
            for (const meaning of entry.meanings || []) {
                for (const def of meaning.definitions || []) {
                    out.push({
                        partOfSpeech: meaning.partOfSpeech,
                        definition: def.definition
                    });
                }
            }
        }
        showDefinitionModal(word, false, out.length ? out : null);
    } catch (_e) {
        showDefinitionModal(word, false, null, "Could not load definition.");
    }
}

async function bootstrap() {
    document.addEventListener("click", (e) => {
        const span = e.target.closest(".dict-word");
        if (!span) return;
        e.preventDefault();
        e.stopPropagation();
        const word = span.getAttribute("data-word");
        const nextSpan = span.nextElementSibling;
        const nextWord = nextSpan && nextSpan.classList.contains("dict-word") ? nextSpan.getAttribute("data-word") : null;
        const phrase = nextWord ? `${word} ${nextWord}` : word;
        const fallback = nextWord ? word : null;
        lookupWord(phrase, fallback);
    });

    try {
        state.user = await api.me();
        await loadAppData();
        renderApp();
    } catch (_error) {
        renderAuth();
    }
}

async function loadAppData() {
    state.lists = await api.getLists();
    state.pendingSessions = await api.getPendingReviews();
    state.settings = await api.getSettings();
    if (state.selectedListId) {
        const data = await api.getSentencesPage(state.selectedListId, 0, 20);
        state.sentences = data.content || [];
        state.sentencesPage = 0;
        state.sentencesHasMore = data.hasMore === true;
        state.sentencesLoading = false;
    } else {
        state.sentences = [];
        state.sentencesPage = 0;
        state.sentencesHasMore = false;
        state.sentencesLoading = false;
    }
}

async function sentenceSpeak(id) {
    const sentence = state.sentences.find((s) => s.id === id);
    if (!sentence || !sentence.content) return;
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(sentence.content);
        utterance.lang = "en-US";
        window.speechSynthesis.speak(utterance);
    }
}

async function sentenceEdit(id) {
    const sentence = state.sentences.find((item) => item.id === id);
    if (!sentence) return;
    showSentenceActionPopup("edit", id, sentence);
}

async function sentenceDelete(id) {
    showSentenceActionPopup("delete", id);
}

async function sentenceMove(id) {
    showSentenceActionPopup("move", id);
}

async function sentenceSchedule(id) {
    const schedule = await api.getSchedule(id);
    showSentenceActionPopup("schedule", id, schedule);
}

let grammarPopupEl = null;

function closeGrammarPopup() {
    if (grammarPopupEl) grammarPopupEl.classList.remove("is-open");
}

function showGrammarResultPopup(correct, feedback, loading = false) {
    if (!grammarPopupEl) {
        grammarPopupEl = document.createElement("div");
        grammarPopupEl.className = "sentence-action-popup-backdrop grammar-popup-backdrop";
        grammarPopupEl.innerHTML = `
          <div class="sentence-action-popup grammar-result-popup">
            <h4 class="grammar-result-title"></h4>
            <p class="grammar-result-feedback"></p>
            <div class="popup-actions">
              <button type="button" class="popup-close-grammar secondary">Close</button>
            </div>
          </div>
        `;
        grammarPopupEl.querySelector(".grammar-result-popup").style.left = "50%";
        grammarPopupEl.querySelector(".grammar-result-popup").style.top = "50%";
        grammarPopupEl.querySelector(".grammar-result-popup").style.transform = "translate(-50%, -50%)";
        grammarPopupEl.addEventListener("click", (e) => { if (e.target === grammarPopupEl) closeGrammarPopup(); });
        grammarPopupEl.querySelector(".popup-close-grammar").addEventListener("click", closeGrammarPopup);
        document.body.appendChild(grammarPopupEl);
    }
    const titleEl = grammarPopupEl.querySelector(".grammar-result-title");
    const feedbackEl = grammarPopupEl.querySelector(".grammar-result-feedback");
    const actionsEl = grammarPopupEl.querySelector(".popup-actions");
    if (loading) {
        titleEl.textContent = "Checking grammar…";
        titleEl.className = "grammar-result-title";
        feedbackEl.textContent = "";
        feedbackEl.style.display = "none";
        actionsEl.style.display = "none";
    } else {
        titleEl.textContent = correct ? "✓ Correct" : "Issues found";
        titleEl.className = "grammar-result-title " + (correct ? "grammar-correct" : "grammar-incorrect");
        feedbackEl.textContent = feedback || "";
        feedbackEl.style.display = feedback ? "block" : "none";
        actionsEl.style.display = "block";
    }
    grammarPopupEl.classList.add("is-open");
}

function openPlayphrasePopup(sentenceContent) {
    const text = (sentenceContent || "").trim();
    if (!text) {
        notify("No sentence text.");
        return;
    }
    const q = encodeURIComponent(text);
    const url = `https://www.playphrase.me/#/search?q=${q}&language=en`;
    window.open(url, "_blank", "noopener,noreferrer");
}

function openYouglish(sentenceContent) {
    const text = (sentenceContent || "").trim();
    if (!text) {
        notify("No sentence text.");
        return;
    }
    const segment = text.replace(/\s+/g, "_");
    const url = `https://youglish.com/pronounce/${encodeURIComponent(segment)}/english`;
    window.open(url, "_blank", "noopener,noreferrer");
}

async function sentenceGrammar(id) {
    const sentence = state.sentences.find((s) => s.id === id);
    if (!sentence || !sentence.content) {
        notify("No sentence text to check.");
        return;
    }
    showGrammarResultPopup(false, "", true);
    try {
        const result = await api.checkGrammar(sentence.content);
        showGrammarResultPopup(!!result.correct, result.feedback || "");
    } catch (e) {
        showGrammarResultPopup(false, e.message || "Grammar check failed.");
    }
}

let sentenceActionPopupEl = null;
let listActionPopupEl = null;

function closeSentenceActionPopup() {
    if (sentenceActionPopupEl) {
        sentenceActionPopupEl.classList.remove("is-open");
    }
}

function closeListActionPopup() {
    if (listActionPopupEl) listActionPopupEl.classList.remove("is-open");
}

function showListActionPopup(action, listId, listName) {
    if (!listActionPopupEl) {
        listActionPopupEl = document.createElement("div");
        listActionPopupEl.className = "sentence-action-popup-backdrop list-action-popup-backdrop";
        listActionPopupEl.innerHTML = '<div class="sentence-action-popup list-action-popup"></div>';
        listActionPopupEl.querySelector(".sentence-action-popup").style.left = "50%";
        listActionPopupEl.querySelector(".sentence-action-popup").style.top = "50%";
        listActionPopupEl.querySelector(".sentence-action-popup").style.transform = "translate(-50%, -50%)";
        listActionPopupEl.addEventListener("click", (e) => {
            if (e.target === listActionPopupEl) closeListActionPopup();
        });
        document.body.appendChild(listActionPopupEl);
    }

    const popup = listActionPopupEl.querySelector(".sentence-action-popup");
    const safeName = escapeHtml(listName || "");

    if (action === "rename") {
        popup.innerHTML = `
            <h4>Rename list</h4>
            <input type="text" id="listRenameInput" value="${safeName}" placeholder="List name" />
            <div class="popup-actions">
                <button type="button" class="popup-cancel secondary">Cancel</button>
                <button type="button" class="popup-save list-rename-save">Save</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeListActionPopup);
        popup.querySelector(".list-rename-save").addEventListener("click", async () => {
            const name = popup.querySelector("#listRenameInput").value.trim();
            if (!name) return;
            await api.renameList(listId, { name });
            closeListActionPopup();
            await refreshAndRender();
        });
    } else if (action === "delete") {
        popup.innerHTML = `
            <h4>Delete list</h4>
            <p class="list-delete-message">Are you sure you want to delete "${safeName}"? All sentences in this list will be removed.</p>
            <div class="popup-actions">
                <button type="button" class="popup-cancel secondary">Cancel</button>
                <button type="button" class="popup-confirm danger">Delete</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeListActionPopup);
        popup.querySelector(".popup-confirm").addEventListener("click", async () => {
            await api.deleteList(listId);
            if (state.selectedListId === listId) {
                state.selectedListId = null;
            }
            closeListActionPopup();
            await refreshAndRender();
        });
    }

    listActionPopupEl.classList.add("is-open");
    if (action === "rename") {
        const input = popup.querySelector("#listRenameInput");
        if (input) {
            input.focus();
            input.select();
        }
    }
}

function showSentenceActionPopup(action, sentenceId, data) {
    if (!sentenceActionPopupEl) {
        sentenceActionPopupEl = document.createElement("div");
        sentenceActionPopupEl.className = "sentence-action-popup-backdrop";
        sentenceActionPopupEl.innerHTML = '<div class="sentence-action-popup"></div>';
        sentenceActionPopupEl.querySelector(".sentence-action-popup").style.left = "50%";
        sentenceActionPopupEl.querySelector(".sentence-action-popup").style.top = "50%";
        sentenceActionPopupEl.querySelector(".sentence-action-popup").style.transform = "translate(-50%, -50%)";
        sentenceActionPopupEl.addEventListener("click", (e) => {
            if (e.target === sentenceActionPopupEl) closeSentenceActionPopup();
        });
        document.body.appendChild(sentenceActionPopupEl);
    }

    const popup = sentenceActionPopupEl.querySelector(".sentence-action-popup");
    const sentence = state.sentences.find((s) => s.id === sentenceId);

    if (action === "edit") {
        popup.innerHTML = `
            <h4>✏️ Edit sentence</h4>
            <textarea id="sentencePopupEditInput" rows="3">${escapeHtml(sentence ? sentence.content : "")}</textarea>
            <div class="popup-actions">
                <button type="button" class="secondary popup-cancel">Cancel</button>
                <button type="button" class="popup-save">Save</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);
        popup.querySelector(".popup-save").addEventListener("click", async () => {
            const content = popup.querySelector("#sentencePopupEditInput").value.trim();
            if (!content) return;
            await api.editSentence(sentenceId, { content });
            closeSentenceActionPopup();
            await refreshAndRender();
        });
    } else if (action === "delete") {
        popup.innerHTML = `
            <h4>🗑️ Delete sentence?</h4>
            <p class="hint">This cannot be undone.</p>
            <div class="popup-actions">
                <button type="button" class="secondary popup-cancel">Cancel</button>
                <button type="button" class="danger popup-confirm">Delete</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);
        popup.querySelector(".popup-confirm").addEventListener("click", async () => {
            await api.deleteSentence(sentenceId);
            closeSentenceActionPopup();
            await refreshAndRender();
        });
    } else if (action === "move") {
        const otherLists = (state.lists || []).filter((l) => l.id !== state.selectedListId);
        popup.innerHTML = `
            <h4>➡️ Move to list</h4>
            <div class="move-list-options">
                ${otherLists.length === 0 ? "<p class=\"hint\">No other lists.</p>" : otherLists.map((l) => `<button type="button" class="move-list-option" data-list-id="${l.id}">${escapeHtml(l.name)}</button>`).join("")}
            </div>
            <div class="popup-actions">
                <button type="button" class="secondary popup-cancel">Cancel</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);
        popup.querySelectorAll(".move-list-option").forEach((btn) => {
            btn.addEventListener("click", async () => {
                await api.moveSentence(sentenceId, { targetListId: Number(btn.getAttribute("data-list-id")) });
                closeSentenceActionPopup();
                await refreshAndRender();
            });
        });
    } else if (action === "schedule") {
        const s = data || {};
        const intervals = (s.intervalMinutes || [60, 180, 360, 1440, 2880, 10080]).join(", ");
        popup.innerHTML = `
            <h4>📅 Schedule</h4>
            <label>Intervals (minutes, comma-separated)</label>
            <input type="text" id="sentencePopupIntervals" value="${escapeHtml(intervals)}" placeholder="60, 180, 360, 1440, 2880, 10080" />
            <label><input type="checkbox" id="sentencePopupOpenEnded" ${s.openEnded ? "checked" : ""} /> Open-ended weekly after final step</label>
            <label>End date (YYYY-MM-DD, optional)</label>
            <input type="text" id="sentencePopupEndDate" value="${escapeHtml(s.endDate || "")}" placeholder="Leave blank for none" />
            <div class="popup-actions">
                <button type="button" class="secondary popup-cancel">Cancel</button>
                <button type="button" class="popup-save">Save</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);
        popup.querySelector(".popup-save").addEventListener("click", async () => {
            const intervalsInput = popup.querySelector("#sentencePopupIntervals").value.trim();
            const openEnded = popup.querySelector("#sentencePopupOpenEnded").checked;
            const endDateInput = popup.querySelector("#sentencePopupEndDate").value.trim();
            await api.updateSchedule(sentenceId, {
                intervalMinutes: intervalsInput.split(",").map((v) => Number(v.trim())).filter(Boolean),
                openEnded,
                endDate: endDateInput || null
            });
            closeSentenceActionPopup();
            await refreshAndRender();
        });
    }

    sentenceActionPopupEl.classList.add("is-open");
}

function isSentenceActionPopupOpen() {
    return sentenceActionPopupEl && sentenceActionPopupEl.classList.contains("is-open");
}

function renderAuth() {
    userBarEl.innerHTML = "";
    appEl.innerHTML = html`
        <section class="container card">
            <h2>Login / Register</h2>
            <p class="hint">Use your own credentials to create account and login.</p>
            <div class="row">
                <input id="authEmail" type="email" placeholder="Email" />
                <input id="authPassword" type="password" placeholder="Password (min 8 chars)" />
            </div>
            <div class="row">
                <button id="loginBtn">Login</button>
                <button id="registerBtn" class="secondary">Register</button>
            </div>
        </section>
    `;

    document.getElementById("loginBtn").addEventListener("click", async () => {
        await authAction("login");
    });
    document.getElementById("registerBtn").addEventListener("click", async () => {
        await authAction("register");
    });
}

async function authAction(type) {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    try {
        if (type === "register") {
            await api.register({ email, password });
        }
        state.user = await api.login({ email, password });
        await loadAppData();
        renderApp();
    } catch (error) {
        notify(error.message);
    }
}

function renderUserBar() {
    userBarEl.innerHTML = html`
        <div>${escapeHtml(state.user.email)}</div>
        <button id="logoutBtn" class="secondary">Logout</button>
    `;
    document.getElementById("logoutBtn").addEventListener("click", async () => {
        await api.logout();
        state.user = null;
        state.selectedListId = null;
        renderAuth();
    });
}

function renderApp() {
    renderUserBar();
    if (state.view === "reviewSession" && state.openSession) {
        renderReviewSessionPage();
        return;
    }
    state.view = "dashboard";
    const selectedList = state.lists.find((list) => list.id === state.selectedListId);
    const notificationsCount = state.pendingSessions.filter((session) => session.isDueNow && !session.notificationRead).length;

    appEl.innerHTML = html`
      <section class="dashboard container">
        ${!state.selectedListId ? html`
        <div class="dashboard-tabs" role="tablist">
          <button type="button" class="dashboard-tab ${state.currentSection === 0 ? "active" : ""}" data-section="0" role="tab">Lists</button>
          <button type="button" class="dashboard-tab ${state.currentSection === 1 ? "active" : ""}" data-section="1" role="tab">Reviews</button>
          <button type="button" class="dashboard-tab ${state.currentSection === 2 ? "active" : ""}" data-section="2" role="tab">Settings</button>
          <button type="button" class="dashboard-tab ${state.currentSection === 3 ? "active" : ""}" data-section="3" role="tab">Mind Map</button>
        </div>
        ` : ""}
        <div class="dashboard-content">
          ${state.selectedListId ? html`
            <div class="dashboard-list-detail card">
              <button type="button" id="showListsBtn" class="show-lists-btn secondary">${state.openedListFromMindMap ? "← Mind Map" : "← Lists"}</button>
              <h2 class="dashboard-content-title">${selectedList ? escapeHtml(selectedList.name) : ""}</h2>
              ${selectedList ? html`
                <div class="row add-sentence-row">
                  <input id="newSentence" class="add-sentence-input input-soft" placeholder="Add sentence to memorize" />
                  <button id="addSentenceBtn" class="add-sentence-btn">Add sentence</button>
                </div>
                <div class="row list-search-row">
                  <input id="listSearchInput" type="search" class="input-soft" placeholder="Search in list…" value="${escapeHtml(state.listSearchQuery || "")}" autocomplete="off" />
                </div>
                <div class="hint">New sentences are auto-scheduled by default pattern (1h, 3h, 6h, 1d, 2d, 1w).</div>
                <ul class="sentence-list">
                  ${(() => {
                    const q = (state.listSearchQuery || "").trim().toLowerCase();
                    const filtered = q ? state.sentences.filter((s) => (s.content || "").toLowerCase().includes(q)) : state.sentences;
                    return filtered.map((sentence) => html`
                    <li class="sentence-item ${state.selectedSentenceId === sentence.id ? "selected" : ""}" data-sentence-id="${sentence.id}">
                      <div class="sentence-item-content" data-sentence-select="${sentence.id}">${renderSentenceWithWordLinks(sentence.content)}</div>
                      <div class="hint">${new Date(sentence.createdAt).toLocaleString()}</div>
                      <div class="row sentence-actions">
                        <button type="button" data-sentence-speak="${sentence.id}" class="btn-icon secondary" title="Listen">🔊</button>
                        <button type="button" data-sentence-playphrase="${sentence.id}" class="btn-icon secondary" title="Play phrase (playphrase.me)">▶️</button>
                        <button type="button" data-sentence-youglish="${sentence.id}" class="btn-icon secondary" title="Pronounce (YouGlish)">🔤</button>
                        <button type="button" data-sentence-test-review="${sentence.id}" class="btn-icon secondary" title="Test review">📋</button>
                        <button type="button" data-sentence-grammar="${sentence.id}" class="btn-icon secondary" title="Check grammar">✓</button>
                        <button type="button" data-sentence-edit="${sentence.id}" class="btn-icon secondary" title="Edit">✏️</button>
                        <button type="button" data-sentence-schedule="${sentence.id}" class="btn-icon secondary" title="Schedule">📅</button>
                        <button type="button" data-sentence-move="${sentence.id}" class="btn-icon secondary" title="Move">➡️</button>
                        <button type="button" data-sentence-delete="${sentence.id}" class="btn-icon danger" title="Delete">🗑️</button>
                      </div>
                    </li>
                  `).join("");
                  })()}
                </ul>
                <div id="sentenceListSentinel" class="sentence-list-sentinel" aria-hidden="true"></div>
              ` : ""}
            </div>
          ` : html`
            <div class="dashboard-panel card" data-section="0" style="display: ${state.currentSection === 0 ? "block" : "none"}">
              <h3>Sentence Lists</h3>
              <div class="row">
                <input id="newListName" class="input-soft" placeholder="New list name" />
                <button id="createListBtn">Create</button>
              </div>
              <ul class="lists-list">
                ${state.lists.map((list) => html`
                  <li class="list-item" data-list-id="${list.id}">
                    <div class="list-item-main" role="button" tabindex="0" title="Open list">
                      <div><b>${escapeHtml(list.name)}</b> <span class="list-item-sentence-count">${Number(list.sentenceCount) || 0} sentence${(Number(list.sentenceCount) || 0) === 1 ? "" : "s"}</span></div>
                      <div class="hint">Created: ${new Date(list.createdAt).toLocaleString()}</div>
                    </div>
                    <div class="row list-actions">
                      <button type="button" data-list-open="${list.id}" class="btn-icon secondary" title="Open">📂</button>
                      <button type="button" data-list-rename="${list.id}" class="btn-icon secondary" title="Rename">✏️</button>
                      <button type="button" data-list-delete="${list.id}" class="btn-icon danger" title="Delete">🗑️</button>
                    </div>
                  </li>
                `).join("")}
              </ul>
            </div>
            <div class="dashboard-panel card" data-section="1" style="display: ${state.currentSection === 1 ? "block" : "none"}">
              <h3>Pending Reviews (${notificationsCount})</h3>
              <div id="pendingReviews"></div>
            </div>
            <div class="dashboard-panel card" data-section="2" style="display: ${state.currentSection === 2 ? "block" : "none"}">
              <h3>Settings</h3>
              <div class="hint">Merge window defines how close due sentences are grouped in one session.</div>
              <div class="row">
                <input id="mergeWindowInput" type="number" class="input-soft" min="10" value="${state.settings.mergeWindowMinutes}" />
                <select id="weeklyDayInput" class="input-soft">
                  ${[1,2,3,4,5,6,7].map((d) => html`<option value="${d}" ${state.settings.weeklyReviewDay === d ? "selected" : ""}>Day ${d}</option>`).join("")}
                </select>
              </div>
              <input id="timezoneInput" class="input-soft" value="${escapeHtml(state.settings.timezone)}" placeholder="Timezone, e.g. UTC or Europe/Berlin" />
              <button id="saveSettingsBtn">Save settings</button>
            </div>
            <div class="dashboard-panel card mind-map-section" data-section="3" style="display: ${state.currentSection === 3 ? "block" : "none"}">
              <h3>Mind Map (all lists)</h3>
              <p class="hint">Circles from the same list are connected. Click a circle to open that list. Drag to move. Scroll to zoom.</p>
              <div class="mind-map-zoom-wrap">
                <div class="mind-map-zoom-controls">
                  <button type="button" id="mindMapZoomOut" class="btn-icon secondary" title="Zoom out">−</button>
                  <span class="mind-map-zoom-label" id="mindMapZoomLabel">100%</span>
                  <button type="button" id="mindMapZoomIn" class="btn-icon secondary" title="Zoom in">+</button>
                  <button type="button" id="mindMapFullscreen" class="btn-icon secondary" title="Full screen">⛶</button>
                </div>
                <canvas id="mindMap" width="900" height="480"></canvas>
              </div>
            </div>
          `}
        </div>
      </section>
    `;

    bindDashboardActions();
    bindDashboardTabs();
    renderPendingReviews();
    renderMindMap();

    if (state.savedListScrollY) {
        setTimeout(() => {
            window.scrollTo(0, state.savedListScrollY);
            state.savedListScrollY = 0;
        }, 0);
    }
}

function bindDashboardTabs() {
    document.querySelectorAll(".dashboard-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const section = parseInt(btn.getAttribute("data-section"), 10);
            if (Number.isNaN(section) || section === state.currentSection) return;
            state.currentSection = section;
            document.querySelectorAll(".dashboard-tab").forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".dashboard-panel").forEach((panel) => {
                const s = parseInt(panel.getAttribute("data-section"), 10);
                panel.style.display = s === section ? "block" : "none";
            });
            if (section === 3) {
                renderMindMap();
            }
        });
    });

    const showListsBtn = document.getElementById("showListsBtn");
    if (showListsBtn) {
        showListsBtn.addEventListener("click", () => {
            state.selectedListId = null;
            state.listSearchQuery = "";
            const wasFromMindMap = state.openedListFromMindMap;
            const wasRestoreFullscreen = state.restoreMindMapFullscreen;
            state.restoreMindMapFullscreen = false;
            state.openedListFromMindMap = false;
            state.currentSection = wasFromMindMap ? 3 : 0;
            renderApp();
            if (wasRestoreFullscreen) {
                setTimeout(() => openMindMapFullscreen(), 100);
            }
        });
    }

    const listSearchInput = document.getElementById("listSearchInput");
    if (listSearchInput) {
        listSearchInput.addEventListener("input", () => {
            state.listSearchQuery = listSearchInput.value;
            const q = state.listSearchQuery.trim().toLowerCase();
            document.querySelectorAll(".dashboard-list-detail .sentence-list .sentence-item").forEach((li) => {
                const contentEl = li.querySelector(".sentence-item-content");
                const text = (contentEl ? contentEl.textContent : "").toLowerCase();
                li.style.display = q === "" || text.includes(q) ? "" : "none";
            });
        });
    }
}

function renderReviewSessionPage() {
    const session = state.openSession;
    if (!session) {
        state.view = "dashboard";
        state.openSessionId = null;
        state.openSession = null;
        renderApp();
        return;
    }
    appEl.innerHTML = html`
      <section class="container card review-session-page">
        <h2>Review session</h2>
        <p class="hint">Due: ${new Date(session.startAt).toLocaleString()} — ${session.items.length} sentence(s) to review.</p>
        <ol class="review-sentences-list">
          ${session.items.map((item, idx) => html`
            <li class="review-sentence-item" data-review-idx="${idx}">
              <div class="review-sentence-main">
                <div class="review-sentence-content">${renderSentenceWithWordLinks(item.content)}</div>
                <div class="review-sentence-buttons">
                  <button type="button" class="btn-icon secondary review-speak" data-review-speak-idx="${idx}" title="Listen">🔊</button>
                  <button type="button" class="btn-icon secondary review-speak-check" data-review-speak-check-idx="${idx}" title="Speak and check">🎤</button>
                </div>
              </div>
              <div class="review-voice-result" data-review-voice-idx="${idx}" aria-live="polite"></div>
            </li>
          `).join("")}
        </ol>
        <div class="row review-session-actions">
          <button id="reviewSessionBackBtn" class="secondary">Back to dashboard</button>
          <button id="reviewSessionCompleteBtn">Mark as reviewed</button>
        </div>
      </section>
    `;

    document.getElementById("reviewSessionBackBtn").addEventListener("click", () => {
        state.view = "dashboard";
        state.openSessionId = null;
        state.openSession = null;
        renderApp();
    });

    document.getElementById("reviewSessionCompleteBtn").addEventListener("click", async () => {
        try {
            await api.completeReviewSession(session.id);
            state.view = "dashboard";
            state.openSessionId = null;
            state.openSession = null;
            state.selectedListId = null;
            state.currentSection = 1;
            await refreshAndRender();
        } catch (error) {
            notify(error.message);
        }
    });

    document.querySelectorAll("[data-review-speak-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-speak-idx"), 10);
            const item = session.items[idx];
            if (!item || !item.content) return;
            if (window.speechSynthesis) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(item.content);
                utterance.lang = "en-US";
                window.speechSynthesis.speak(utterance);
            }
        });
    });

    document.querySelectorAll("[data-review-speak-check-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-speak-check-idx"), 10);
            startReviewVoiceCheck(session, idx);
        });
    });
}

function normalizeForComparison(text) {
    const t = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
    // Remove apostrophes first so "friend's" and "friends'" both become "friends", "don't" becomes "dont"
    const noApostrophe = t.replace(/['\u2018\u2019`]/g, "");
    // Then strip remaining punctuation and collapse spaces
    return noApostrophe.replace(/[\s.,?!;:"\u201c\u201d\-—–()\[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
}

function runVoiceCheck(expectedContent, resultEl, buttonEl) {
    if (!expectedContent || !resultEl || !buttonEl) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        notify("Voice recognition is not supported in this browser. Try Chrome or Edge.");
        return;
    }

    resultEl.textContent = "";
    resultEl.className = "review-voice-result review-voice-listening";
    resultEl.style.display = "block";
    resultEl.textContent = "Listening… Speak the sentence.";
    buttonEl.disabled = true;

    const expected = normalizeForComparison(expectedContent);
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
        const transcript = (event.results[0] && event.results[0][0]) ? event.results[0][0].transcript : "";
        const said = normalizeForComparison(transcript);
        const match = expected === said;

        resultEl.className = "review-voice-result " + (match ? "review-voice-match" : "review-voice-mismatch");
        if (match) {
            resultEl.innerHTML = "✓ Match! You said it correctly.";
        } else {
            resultEl.innerHTML = `✗ You said: <strong>${escapeHtml(transcript.trim() || "(no speech heard)")}</strong><br>Expected: ${escapeHtml(expectedContent)}`;
        }
        buttonEl.disabled = false;
    };

    recognition.onerror = (event) => {
        resultEl.className = "review-voice-result review-voice-mismatch";
        const msg = event.error === "no-speech" ? "No speech heard. Try again." : (event.error === "not-allowed" ? "Microphone access denied." : `Error: ${event.error}`);
        resultEl.textContent = msg;
        buttonEl.disabled = false;
    };

    recognition.onend = () => {
        if (resultEl.classList.contains("review-voice-listening")) {
            resultEl.className = "review-voice-result review-voice-mismatch";
            resultEl.textContent = "Recognition ended. Click 🎤 to try again.";
            buttonEl.disabled = false;
        }
    };

    try {
        recognition.start();
    } catch (e) {
        resultEl.className = "review-voice-result review-voice-mismatch";
        resultEl.textContent = "Could not start voice recognition: " + (e.message || "unknown error");
        buttonEl.disabled = false;
    }
}

function startReviewVoiceCheck(session, idx) {
    const item = session?.items?.[idx];
    if (!item || !item.content) return;
    const resultEl = document.querySelector(`.review-voice-result[data-review-voice-idx="${idx}"]`);
    const buttonEl = document.querySelector(`[data-review-speak-check-idx="${idx}"]`);
    runVoiceCheck(item.content, resultEl, buttonEl);
}

let testReviewPopupEl = null;

function closeTestReviewPopup() {
    if (testReviewPopupEl) testReviewPopupEl.classList.remove("is-open");
}

function openTestReviewPopup(sentenceId) {
    const sentence = state.sentences.find((s) => s.id === sentenceId);
    if (!sentence || !sentence.content) return;

    if (!testReviewPopupEl) {
        testReviewPopupEl = document.createElement("div");
        testReviewPopupEl.className = "sentence-action-popup-backdrop test-review-popup-backdrop";
        testReviewPopupEl.addEventListener("click", (e) => { if (e.target === testReviewPopupEl) closeTestReviewPopup(); });
        document.body.appendChild(testReviewPopupEl);
    }

    testReviewPopupEl.innerHTML = `
      <div class="sentence-action-popup test-review-popup">
        <h4>Test review</h4>
        <p class="test-review-sentence"></p>
        <div class="row test-review-buttons">
          <button type="button" class="btn-icon secondary test-review-listen" title="Listen">🔊</button>
          <button type="button" class="btn-icon secondary test-review-speak-check" title="Speak and check">🎤</button>
        </div>
        <div class="review-voice-result test-review-voice-result" style="display:none;"></div>
        <div class="popup-actions">
          <button type="button" class="secondary test-review-close">Close</button>
        </div>
      </div>
    `;
    const popup = testReviewPopupEl.querySelector(".test-review-popup");
    popup.style.left = "50%";
    popup.style.top = "50%";
    popup.style.transform = "translate(-50%, -50%)";

    const sentenceEl = testReviewPopupEl.querySelector(".test-review-sentence");
    const resultEl = testReviewPopupEl.querySelector(".test-review-voice-result");
    const listenBtn = testReviewPopupEl.querySelector(".test-review-listen");
    const speakCheckBtn = testReviewPopupEl.querySelector(".test-review-speak-check");

    sentenceEl.textContent = sentence.content;

    listenBtn.addEventListener("click", () => {
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(sentence.content);
            utterance.lang = "en-US";
            window.speechSynthesis.speak(utterance);
        }
    });

    speakCheckBtn.addEventListener("click", () => runVoiceCheck(sentence.content, resultEl, speakCheckBtn));

    testReviewPopupEl.querySelector(".test-review-close").addEventListener("click", closeTestReviewPopup);

    testReviewPopupEl.classList.add("is-open");
}

async function renderPendingReviews() {
    const container = document.getElementById("pendingReviews");
    if (!container) {
        return;
    }
    container.innerHTML = state.pendingSessions.length === 0
        ? "<p class='hint'>No pending review sessions.</p>"
        : state.pendingSessions.map((session) => html`
            <div class="card pending-review-item">
              <div class="pending-review-info">
                <div class="pending-review-title"><b>Session ${session.id}</b></div>
                <div class="pending-review-meta">
                  ${new Date(session.startAt).toLocaleString()} (${session.items.length} sentences)
                </div>
              </div>
              <div class="pending-review-actions">
                <button data-session-open="${session.id}" class="secondary">Open</button>
                <button data-session-complete="${session.id}">Mark reviewed</button>
              </div>
            </div>
          `).join("");

    container.querySelectorAll("[data-session-open]").forEach((button) => {
        button.addEventListener("click", async () => {
            const id = Number(button.getAttribute("data-session-open"));
            const session = state.pendingSessions.find((item) => item.id === id);
            if (!session) return;
            try {
                await api.openReviewSession(id);
            } catch (e) {
                notify(e.message);
                return;
            }
            state.view = "reviewSession";
            state.openSessionId = id;
            state.openSession = session;
            renderApp();
        });
    });
    container.querySelectorAll("[data-session-complete]").forEach((button) => {
        button.addEventListener("click", async () => {
            const id = Number(button.getAttribute("data-session-complete"));
            await api.completeReviewSession(id);
            await refreshAndRender();
        });
    });
}

function bindDashboardActions() {
    const createListBtn = document.getElementById("createListBtn");
    if (createListBtn) {
        createListBtn.addEventListener("click", async () => {
            const name = document.getElementById("newListName").value.trim();
            if (!name) return;
            await api.createList({ name });
            await refreshAndRender();
        });
    }

    document.querySelectorAll("[data-list-open]").forEach((button) => {
        button.addEventListener("click", async () => {
            state.openedListFromMindMap = false;
            state.restoreMindMapFullscreen = false;
            state.selectedListId = Number(button.getAttribute("data-list-open"));
            await refreshAndRender();
        });
    });
    document.querySelectorAll(".list-item-main").forEach((el) => {
        el.addEventListener("click", async () => {
            const li = el.closest(".list-item");
            const listId = li ? Number(li.getAttribute("data-list-id")) : null;
            if (listId == null) return;
            state.openedListFromMindMap = false;
            state.restoreMindMapFullscreen = false;
            state.selectedListId = listId;
            await refreshAndRender();
        });
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                el.click();
            }
        });
    });
    document.querySelectorAll("[data-list-rename]").forEach((button) => {
        button.addEventListener("click", () => {
            const listId = Number(button.getAttribute("data-list-rename"));
            const list = state.lists.find((l) => l.id === listId);
            showListActionPopup("rename", listId, list ? list.name : "");
        });
    });
    document.querySelectorAll("[data-list-delete]").forEach((button) => {
        button.addEventListener("click", () => {
            const listId = Number(button.getAttribute("data-list-delete"));
            const list = state.lists.find((l) => l.id === listId);
            showListActionPopup("delete", listId, list ? list.name : "");
        });
    });

    const addSentenceBtn = document.getElementById("addSentenceBtn");
    if (addSentenceBtn) {
        addSentenceBtn.addEventListener("click", async () => {
            const content = document.getElementById("newSentence").value.trim();
            if (!content) return;
            await api.addSentence(state.selectedListId, { content });
            await refreshAndRender();
        });
    }

    document.querySelectorAll("[data-sentence-speak]").forEach((button) => {
        button.addEventListener("click", () => sentenceSpeak(Number(button.getAttribute("data-sentence-speak"))));
    });

    document.querySelectorAll("[data-sentence-playphrase]").forEach((button) => {
        button.addEventListener("click", () => {
            const sentenceId = Number(button.getAttribute("data-sentence-playphrase"));
            const sentence = state.sentences.find((s) => s.id === sentenceId);
            openPlayphrasePopup(sentence ? sentence.content : "");
        });
    });

    document.querySelectorAll("[data-sentence-youglish]").forEach((button) => {
        button.addEventListener("click", () => {
            const sentenceId = Number(button.getAttribute("data-sentence-youglish"));
            const sentence = state.sentences.find((s) => s.id === sentenceId);
            openYouglish(sentence ? sentence.content : "");
        });
    });

    document.querySelectorAll("[data-sentence-grammar]").forEach((button) => {
        button.addEventListener("click", () => sentenceGrammar(Number(button.getAttribute("data-sentence-grammar"))));
    });

    document.querySelectorAll("[data-sentence-test-review]").forEach((button) => {
        button.addEventListener("click", () => openTestReviewPopup(Number(button.getAttribute("data-sentence-test-review"))));
    });

    document.querySelectorAll("[data-sentence-select]").forEach((el) => {
        el.addEventListener("click", () => {
            const id = Number(el.getAttribute("data-sentence-select"));
            state.selectedSentenceId = state.selectedSentenceId === id ? null : id;
            redrawMindMapCanvas();
            document.querySelectorAll(".sentence-item").forEach((li) => {
                li.classList.toggle("selected", Number(li.getAttribute("data-sentence-id")) === state.selectedSentenceId);
            });
        });
    });

    document.querySelectorAll("[data-sentence-edit]").forEach((button) => {
        button.addEventListener("click", () => sentenceEdit(Number(button.getAttribute("data-sentence-edit"))));
    });

    document.querySelectorAll("[data-sentence-delete]").forEach((button) => {
        button.addEventListener("click", () => sentenceDelete(Number(button.getAttribute("data-sentence-delete"))));
    });

    document.querySelectorAll("[data-sentence-move]").forEach((button) => {
        button.addEventListener("click", () => sentenceMove(Number(button.getAttribute("data-sentence-move"))));
    });

    document.querySelectorAll("[data-sentence-schedule]").forEach((button) => {
        button.addEventListener("click", () => sentenceSchedule(Number(button.getAttribute("data-sentence-schedule"))));
    });

    const saveSettingsBtn = document.getElementById("saveSettingsBtn");
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener("click", async () => {
            await api.updateSettings({
                timezone: document.getElementById("timezoneInput").value.trim() || "UTC",
                mergeWindowMinutes: Number(document.getElementById("mergeWindowInput").value),
                weeklyReviewDay: Number(document.getElementById("weeklyDayInput").value)
            });
            await refreshAndRender();
        });
    }

    const sentinel = document.getElementById("sentenceListSentinel");
    if (sentinel && typeof IntersectionObserver !== "undefined") {
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries[0]?.isIntersecting) return;
                loadMoreSentences();
            },
            { root: null, rootMargin: "200px", threshold: 0 }
        );
        observer.observe(sentinel);
    }

}

async function loadMoreSentences() {
    if (state.sentencesLoading || !state.sentencesHasMore || !state.selectedListId) return;
    state.savedListScrollY = window.scrollY;
    state.sentencesLoading = true;
    try {
        const data = await api.getSentencesPage(state.selectedListId, state.sentencesPage + 1, 20);
        const newItems = data.content || [];
        state.sentences = [...state.sentences, ...newItems];
        state.sentencesPage++;
        state.sentencesHasMore = data.hasMore === true;
        renderApp();
        setTimeout(() => {
            window.scrollTo(0, state.savedListScrollY);
            state.savedListScrollY = 0;
            state.sentencesLoading = false;
        }, 0);
    } catch (e) {
        state.sentencesLoading = false;
        notify(e.message || "Failed to load more.");
    }
}

async function refreshAndRender() {
    try {
        await loadAppData();
        renderApp();
    } catch (error) {
        notify(error.message);
    }
}

const MIND_MAP_CANVAS_WIDTH = 900;
const MIND_MAP_CANVAS_HEIGHT = 480;
const MIND_MAP_BASE_RADIUS = 32;
const MIND_MAP_RADIUS_PER_REVIEW = 5;
const MIND_MAP_MAX_RADIUS = 72;
const MIND_MAP_CLUSTER_DIST = 140;
const MIND_MAP_IN_LIST_RADIUS = 24;
const MIND_MAP_IN_LIST_STEP = 22;
const MIND_MAP_IN_LIST_ANGLE = 0.55;

function getCircleRadius(node) {
    const reviews = Number(node.reviews) || 0;
    const extra = Math.min(reviews * MIND_MAP_RADIUS_PER_REVIEW, MIND_MAP_MAX_RADIUS - MIND_MAP_BASE_RADIUS);
    return MIND_MAP_BASE_RADIUS + extra;
}

function getMindMapNodePositions(nodes, width, height) {
    const w = width || MIND_MAP_CANVAS_WIDTH;
    const h = height || MIND_MAP_CANVAS_HEIGHT;
    const viewScale = Math.min(w / MIND_MAP_CANVAS_WIDTH, h / MIND_MAP_CANVAS_HEIGHT, 1.2);
    const positions = state.mindMapPositions || {};
    const centerX = w / 2;
    const centerY = h / 2;

    const maxRadius = nodes.length === 0 ? MIND_MAP_BASE_RADIUS : Math.max(...nodes.map((n) => getCircleRadius(n)));
    const minDist = maxRadius * 2.4;

    const byList = new Map();
    const listOrder = [];
    for (const node of nodes) {
        const lid = node.listId;
        if (!byList.has(lid)) {
            byList.set(lid, []);
            listOrder.push(lid);
        }
        byList.get(lid).push(node);
    }

    const numLists = Math.max(1, listOrder.length);
    const listClusterRadii = listOrder.map((lid) => {
        const listNodes = byList.get(lid);
        const n = listNodes.length;
        const maxR = Math.max(...listNodes.map((n) => getCircleRadius(n)));
        const circumference = n * minDist;
        const r = Math.max(maxR * 2, circumference / (2 * Math.PI));
        return r;
    });
    const maxListR = Math.max(80, ...listClusterRadii);
    const clusterDist = Math.max(160 * viewScale, 2 * maxListR + maxRadius * 2);

    const result = nodes.map((node) => {
        const saved = positions[node.id];
        if (saved) return { node, x: saved.x, y: saved.y };

        const listId = node.listId;
        const listIdx = listOrder.indexOf(listId);
        if (listIdx === -1) {
            return { node, x: centerX, y: centerY };
        }

        const listNodes = byList.get(listId);
        const nodeIdxInList = listNodes.indexOf(node);
        if (nodeIdxInList === -1) {
            return { node, x: centerX, y: centerY };
        }

        const listAngle = (listIdx / numLists) * 2 * Math.PI - Math.PI / 2;
        const lcx = centerX + clusterDist * Math.cos(listAngle);
        const lcy = centerY + clusterDist * Math.sin(listAngle);

        const listR = listClusterRadii[listIdx];
        const nInList = listNodes.length;
        const angleStep = nInList <= 1 ? 0 : (2 * Math.PI) / nInList;
        const nodeAngle = listAngle + Math.PI / 2 + nodeIdxInList * angleStep;
        const x = lcx + listR * Math.cos(nodeAngle);
        const y = lcy + listR * Math.sin(nodeAngle);
        return { node, x, y };
    });

    const overlapIterations = 12;
    for (let iter = 0; iter < overlapIterations; iter++) {
        let moved = false;
        for (let i = 0; i < result.length; i++) {
            const ri = result[i];
            const radiusI = getCircleRadius(ri.node);
            for (let j = i + 1; j < result.length; j++) {
                const rj = result[j];
                const radiusJ = getCircleRadius(rj.node);
                const dx = rj.x - ri.x;
                const dy = rj.y - ri.y;
                const dist = Math.hypot(dx, dy);
                const need = radiusI + radiusJ + 4;
                if (dist < need && dist > 0.01) {
                    const push = (need - dist) / 2;
                    const nx = dx / dist;
                    const ny = dy / dist;
                    ri.x -= nx * push;
                    ri.y -= ny * push;
                    rj.x += nx * push;
                    rj.y += ny * push;
                    moved = true;
                }
            }
        }
        if (!moved) break;
    }

    return result;
}

function wrapLabelInCircle(ctx, label, maxWidth, maxLines = 4) {
    const words = (label || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const w of words) {
        const next = current ? current + " " + w : w;
        const m = ctx.measureText(next);
        if (m.width > maxWidth && current) {
            lines.push(current);
            current = w;
            if (lines.length >= maxLines) break;
        } else {
            current = next;
        }
    }
    if (current) lines.push(current);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        const showLast = lines[maxLines - 1];
        let t = showLast;
        while (t.length > 0 && ctx.measureText(t + "...").width > maxWidth) {
            t = t.slice(0, -1);
        }
        lines[maxLines - 1] = (t.length < showLast.length ? t + "..." : t);
    }
    return lines;
}

function redrawMindMapCanvas() {
    const canvas = document.getElementById("mindMap");
    const data = state.mindMapData;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = (data && data.nodes && Array.isArray(data.nodes)) ? data.nodes : [];
    if (nodes.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#586173";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Add sentences to your lists to see them here.", canvas.width / 2, canvas.height / 2);
        state.mindMapLastPositions = [];
        return;
    }

    // Use the canvas's displayed size so the buffer aspect ratio matches the CSS box (keeps circles round on mobile).
    const rect = canvas.getBoundingClientRect();
    const parent = canvas.parentElement;
    const fallbackW = parent ? Math.min(MIND_MAP_CANVAS_WIDTH, parent.clientWidth || MIND_MAP_CANVAS_WIDTH) : MIND_MAP_CANVAS_WIDTH;
    const fallbackH = parent ? (parent.clientHeight || MIND_MAP_CANVAS_HEIGHT) : MIND_MAP_CANVAS_HEIGHT;
    const cw = Math.max(200, rect.width > 0 ? Math.round(rect.width) : fallbackW);
    const ch = Math.max(200, rect.height > 0 ? Math.round(rect.height) : fallbackH);
    canvas.width = cw;
    canvas.height = ch;

    const scale = state.mindMapScale;
    const basePan = { x: cw / 2 * (1 - scale), y: ch / 2 * (1 - scale) };
    state.mindMapPan = {
        x: basePan.x + (state.mindMapUserPan?.x ?? 0),
        y: basePan.y + (state.mindMapUserPan?.y ?? 0)
    };

    const positions = getMindMapNodePositions(nodes, canvas.width, canvas.height);
    state.mindMapLastPositions = positions;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, state.mindMapPan.x, state.mindMapPan.y);

    const byListId = new Map();
    positions.forEach(({ node, x, y }) => {
        const listId = node.listId;
        if (!byListId.has(listId)) byListId.set(listId, []);
        byListId.get(listId).push({ node, x, y });
    });
    byListId.forEach((listNodes) => {
        listNodes.sort((a, b) => (a.node.index ?? 0) - (b.node.index ?? 0));
        ctx.strokeStyle = "rgba(31, 59, 102, 0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < listNodes.length - 1; k++) {
            const a = listNodes[k], b = listNodes[k + 1];
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
    });

    positions.forEach(({ node, x, y }) => {
        const radius = getCircleRadius(node);
        const isSelected = state.selectedSentenceId === node.id;
        const opacity = Number(node.opacity);
        const alpha = Number.isFinite(opacity) ? Math.max(0.2, Math.min(1, opacity)) : 0.8;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color || "hsl(200 80% 45%)";
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (isSelected) {
            ctx.strokeStyle = "rgb(125, 99, 255)";
            ctx.lineWidth = 4;
            ctx.stroke();
        }
        ctx.closePath();

        const maxTextWidth = 2 * radius * 0.88;
        const fontSize = Math.max(9, Math.min(14, radius / 2.2));
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = "#1d2433";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lines = wrapLabelInCircle(ctx, node.label, maxTextWidth);
        const lineHeight = fontSize * 1.15;
        const startY = y - (lines.length - 1) * lineHeight / 2;
        lines.forEach((line, i) => {
            ctx.fillText(line, x, startY + i * lineHeight);
        });
    });
}

function canvasCoords(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const bufX = (clientX - rect.left) * scaleX;
    const bufY = (clientY - rect.top) * scaleY;
    const scale = state.mindMapScale;
    const pan = state.mindMapPan;
    return {
        x: (bufX - pan.x) / scale,
        y: (bufY - pan.y) / scale
    };
}

function hitTestNode(mx, my) {
    const positions = state.mindMapLastPositions;
    if (!positions) return null;
    for (let i = positions.length - 1; i >= 0; i--) {
        const { node, x, y } = positions[i];
        const radius = getCircleRadius(node);
        const dx = mx - x, dy = my - y;
        if (dx * dx + dy * dy <= radius * radius) return node;
    }
    return null;
}

function closeMindMapFullscreen() {
    const overlay = document.getElementById("mindMapFullscreenOverlay");
    if (!overlay || !state.mindMapFullscreenParent) return;
    const wrap = overlay.querySelector(".mind-map-zoom-wrap");
    if (wrap) state.mindMapFullscreenParent.appendChild(wrap);
    overlay.remove();
    state.mindMapFullscreenParent = null;
    if (wrap) setTimeout(() => redrawMindMapCanvas(), 50);
}

function openMindMapFullscreen() {
    const wrap = document.querySelector(".mind-map-zoom-wrap");
    if (!wrap || state.mindMapFullscreenParent) return;
    const overlay = document.createElement("div");
    overlay.id = "mindMapFullscreenOverlay";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mind-map-fullscreen-close btn secondary";
    closeBtn.textContent = "Close full screen";
    closeBtn.addEventListener("click", closeMindMapFullscreen);
    overlay.appendChild(closeBtn);
    state.mindMapFullscreenParent = wrap.parentNode;
    overlay.appendChild(wrap);
    document.body.appendChild(overlay);
    setTimeout(() => redrawMindMapCanvas(), 50);
}

async function renderMindMap() {
    const canvas = document.getElementById("mindMap");
    if (!canvas) return;

    state.selectedSentenceId = null;
    let data;
    try {
        data = await api.getAllMindMap();
    } catch (_e) {
        data = { nodes: [] };
    }
    if (!data.nodes || data.nodes.length === 0) {
        try {
            const lists = await api.getLists();
            const allNodes = [];
            for (const list of lists) {
                const mapData = await api.getMindMap(list.id);
                if (mapData.nodes && mapData.nodes.length) {
                    mapData.nodes.forEach((n, idx) => {
                        allNodes.push({ ...n, listId: list.id, index: idx });
                    });
                }
            }
            data = { nodes: allNodes };
        } catch (_e2) {
            data = { nodes: [] };
        }
    }
    state.mindMapData = data;
    state.mindMapLastPositions = null;
    if (!state.mindMapPositions || Array.isArray(state.mindMapPositions)) {
        state.mindMapPositions = {};
    }

    redrawMindMapCanvas();

    function startDrag(node, clientX, clientY) {
        const { x, y } = canvasCoords(canvas, clientX, clientY);
        state.draggingNodeId = node.id;
        state.mindMapPositions[node.id] = { x, y };
        let didMove = false;

        const moveHandler = (e2) => {
            if (state.draggingNodeId !== node.id) return;
            didMove = true;
            const cx = e2.clientX != null ? e2.clientX : (e2.touches && e2.touches[0] ? e2.touches[0].clientX : 0);
            const cy = e2.clientY != null ? e2.clientY : (e2.touches && e2.touches[0] ? e2.touches[0].clientY : 0);
            const c = canvasCoords(canvas, cx, cy);
            state.mindMapPositions[node.id] = { x: c.x, y: c.y };
            redrawMindMapCanvas();
        };
        const upHandler = (e2) => {
            if ((e2.type === "touchend" || e2.type === "touchcancel") && didMove) state.mindMapJustDragged = true;
            if ((e2.type === "touchend" || e2.type === "touchcancel") && !didMove) {
                state.selectedListId = node.listId != null ? node.listId : state.selectedListId;
                state.selectedSentenceId = node.id;
                state.openedListFromMindMap = true;
                state.restoreMindMapFullscreen = !!state.mindMapFullscreenParent;
                closeMindMapFullscreen();
                refreshAndRender();
            }
            state.draggingNodeId = null;
            document.removeEventListener("mousemove", moveHandler);
            document.removeEventListener("mouseup", upHandler);
            document.removeEventListener("touchmove", touchMoveHandler, { passive: false });
            document.removeEventListener("touchend", touchEndHandler);
            document.removeEventListener("touchcancel", touchEndHandler);
        };
        const touchMoveHandler = (e2) => {
            e2.preventDefault();
            moveHandler(e2);
        };
        const touchEndHandler = (e2) => {
            upHandler(e2);
        };

        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
        document.addEventListener("touchmove", touchMoveHandler, { passive: false });
        document.addEventListener("touchend", touchEndHandler);
        document.addEventListener("touchcancel", touchEndHandler);
    }

    function startMapPan(clientX, clientY) {
        state.mindMapPanning = true;
        const startClientX = clientX;
        const startClientY = clientY;
        const startUserPan = { x: state.mindMapUserPan.x, y: state.mindMapUserPan.y };

        const moveHandler = (e2) => {
            const cx = e2.clientX != null ? e2.clientX : (e2.touches && e2.touches[0] ? e2.touches[0].clientX : startClientX);
            const cy = e2.clientY != null ? e2.clientY : (e2.touches && e2.touches[0] ? e2.touches[0].clientY : startClientY);
            state.mindMapUserPan = {
                x: startUserPan.x + (cx - startClientX),
                y: startUserPan.y + (cy - startClientY)
            };
            redrawMindMapCanvas();
        };
        const upHandler = () => {
            state.mindMapPanning = false;
            document.removeEventListener("mousemove", moveHandler);
            document.removeEventListener("mouseup", upHandler);
            document.removeEventListener("touchmove", touchMoveHandler, { passive: false });
            document.removeEventListener("touchend", touchEndHandler);
            document.removeEventListener("touchcancel", touchEndHandler);
            canvas.style.cursor = "grab";
        };
        const touchMoveHandler = (e2) => {
            e2.preventDefault();
            moveHandler(e2);
        };
        const touchEndHandler = upHandler;

        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
        document.addEventListener("touchmove", touchMoveHandler, { passive: false });
        document.addEventListener("touchend", touchEndHandler);
        document.addEventListener("touchcancel", touchEndHandler);
        canvas.style.cursor = "grabbing";
    }

    canvas.addEventListener("mousedown", (e) => {
        const { x, y } = canvasCoords(canvas, e.clientX, e.clientY);
        const node = hitTestNode(x, y);
        if (node) {
            startDrag(node, e.clientX, e.clientY);
        } else {
            startMapPan(e.clientX, e.clientY);
        }
    });

    canvas.addEventListener("touchstart", (e) => {
        if (!e.touches.length) return;
        e.preventDefault();
        const touch = e.touches[0];
        const { x, y } = canvasCoords(canvas, touch.clientX, touch.clientY);
        const node = hitTestNode(x, y);
        if (node) {
            startDrag(node, touch.clientX, touch.clientY);
        } else {
            startMapPan(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    canvas.addEventListener("click", (e) => {
        if (state.draggingNodeId != null) return;
        if (state.mindMapJustDragged) {
            state.mindMapJustDragged = false;
            return;
        }
        const { x, y } = canvasCoords(canvas, e.clientX, e.clientY);
        const node = hitTestNode(x, y);
        if (!node) return;
        state.selectedListId = node.listId != null ? node.listId : state.selectedListId;
        state.selectedSentenceId = node.id;
        state.openedListFromMindMap = true;
        state.restoreMindMapFullscreen = !!state.mindMapFullscreenParent;
        closeMindMapFullscreen();
        refreshAndRender();
    });

    canvas.style.cursor = "grab";

    canvas.addEventListener("mousemove", (e) => {
        if (state.draggingNodeId != null || state.mindMapPanning) return;
        const { x, y } = canvasCoords(canvas, e.clientX, e.clientY);
        const node = hitTestNode(x, y);
        canvas.style.cursor = node ? "pointer" : "grab";
    });

    function setZoom(newScale) {
        state.mindMapScale = Math.max(0.25, Math.min(4, newScale));
        const label = document.getElementById("mindMapZoomLabel");
        if (label) label.textContent = Math.round(state.mindMapScale * 100) + "%";
        redrawMindMapCanvas();
    }

    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.12 : 0.12;
        setZoom(state.mindMapScale + delta);
    }, { passive: false });

    const zoomInBtn = document.getElementById("mindMapZoomIn");
    const zoomOutBtn = document.getElementById("mindMapZoomOut");
    if (zoomInBtn) zoomInBtn.addEventListener("click", () => setZoom(state.mindMapScale + 0.25));
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => setZoom(state.mindMapScale - 0.25));

    const fullscreenBtn = document.getElementById("mindMapFullscreen");
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener("click", openMindMapFullscreen);
    }

    const label = document.getElementById("mindMapZoomLabel");
    if (label) label.textContent = Math.round(state.mindMapScale * 100) + "%";
}

bootstrap();
