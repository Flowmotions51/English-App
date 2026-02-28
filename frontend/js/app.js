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
    currentCubeFace: 0
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
    if (state.selectedListId === null && state.lists.length > 0) {
        state.selectedListId = state.lists[0].id;
    }
    state.pendingSessions = await api.getPendingReviews();
    state.settings = await api.getSettings();
    if (state.selectedListId) {
        state.sentences = await api.getSentences(state.selectedListId);
    } else {
        state.sentences = [];
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

function closeSentenceActionPopup() {
    if (sentenceActionPopupEl) {
        sentenceActionPopupEl.classList.remove("is-open");
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
      <section class="cube-app-wrap" id="cubeAppWrap">
        <div class="cube-app-inner" id="cubeAppInner" data-list-open="${state.selectedListId ? "1" : "0"}">
          <div class="cube-panel-main">
            <div class="cube-viewport" id="cubeViewport">
              <div class="cube-container" id="cubeContainer" style="transform: translateX(-${state.currentCubeFace * 25}%)">
                <div class="cube-face">
                  <div class="cube-face-inner card">
                    <h3>Sentence Lists</h3>
                    <div class="row">
                      <input id="newListName" placeholder="New list name" />
                      <button id="createListBtn">Create</button>
                    </div>
                    <ul class="lists-list">
                      ${state.lists.map((list) => html`
                        <li class="list-item" data-list-id="${list.id}">
                          <div class="list-item-main" role="button" tabindex="0" title="Open list">
                            <div><b>${escapeHtml(list.name)}</b></div>
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
                    <p class="hint">Tap a list to open it. Swipe left/right for other sections.</p>
                  </div>
                </div>
          <div class="cube-face">
            <div class="cube-face-inner card">
              <h3>Pending Reviews (${notificationsCount})</h3>
              <div id="pendingReviews"></div>
            </div>
          </div>
          <div class="cube-face">
            <div class="cube-face-inner card">
              <h3>Settings</h3>
              <div class="hint">Merge window defines how close due sentences are grouped in one session.</div>
              <div class="row">
                <input id="mergeWindowInput" type="number" min="10" value="${state.settings.mergeWindowMinutes}" />
                <select id="weeklyDayInput">
                  ${[1,2,3,4,5,6,7].map((d) => html`<option value="${d}" ${state.settings.weeklyReviewDay === d ? "selected" : ""}>Day ${d}</option>`).join("")}
                </select>
              </div>
              <input id="timezoneInput" value="${escapeHtml(state.settings.timezone)}" placeholder="Timezone, e.g. UTC or Europe/Berlin" />
              <button id="saveSettingsBtn">Save settings</button>
            </div>
          </div>
          <div class="cube-face">
            <div class="cube-face-inner card mind-map-section">
              <h3>Mind Map (all lists)</h3>
              <p class="hint">Circles from the same list are connected. Drag to move; swipe left/right to change section.</p>
              <canvas id="mindMap" width="900" height="480"></canvas>
            </div>
          </div>
        </div>
        <div class="cube-dots" aria-hidden="true">
          <button type="button" class="cube-dot ${state.currentCubeFace === 0 ? "active" : ""}" data-cube-face="0" title="Sentence Lists">1</button>
          <button type="button" class="cube-dot ${state.currentCubeFace === 1 ? "active" : ""}" data-cube-face="1" title="Pending Reviews">2</button>
          <button type="button" class="cube-dot ${state.currentCubeFace === 2 ? "active" : ""}" data-cube-face="2" title="Settings">3</button>
          <button type="button" class="cube-dot ${state.currentCubeFace === 3 ? "active" : ""}" data-cube-face="3" title="Mind Map">4</button>
        </div>
          </div>
          <div class="cube-panel-list-detail" id="cubePanelListDetail">
            <div class="cube-list-detail-inner card">
              <button type="button" id="showListsBtn" class="show-lists-btn secondary">← Lists</button>
              <button type="button" id="showListsBtnHeader" class="show-lists-btn show-lists-btn-header list-detail-back">← ${selectedList ? escapeHtml(selectedList.name) : "List"}</button>
              <p class="hint list-detail-swipe-hint">Swipe up to return to lists</p>
              <h2 class="dashboard-content-title">${selectedList ? escapeHtml(selectedList.name) : ""}</h2>
              ${selectedList ? html`
                <div class="row">
                  <input id="newSentence" placeholder="Add sentence to memorize" />
                  <button id="addSentenceBtn">Add sentence</button>
                </div>
                <div class="hint">New sentences are auto-scheduled by default pattern (1h, 3h, 6h, 1d, 2d, 1w).</div>
                <ul class="sentence-list">
                  ${state.sentences.map((sentence) => html`
                    <li class="sentence-item ${state.selectedSentenceId === sentence.id ? "selected" : ""}" data-sentence-id="${sentence.id}">
                      <div class="sentence-item-content" data-sentence-select="${sentence.id}">${renderSentenceWithWordLinks(sentence.content)}</div>
                      <div class="hint">${new Date(sentence.createdAt).toLocaleString()}</div>
                      <div class="row sentence-actions">
                        <button type="button" data-sentence-speak="${sentence.id}" class="btn-icon secondary" title="Listen">🔊</button>
                        <button type="button" data-sentence-test-review="${sentence.id}" class="btn-icon secondary" title="Test review">📋</button>
                        <button type="button" data-sentence-grammar="${sentence.id}" class="btn-icon secondary" title="Check grammar">✓</button>
                        <button type="button" data-sentence-edit="${sentence.id}" class="btn-icon secondary" title="Edit">✏️</button>
                        <button type="button" data-sentence-schedule="${sentence.id}" class="btn-icon secondary" title="Schedule">📅</button>
                        <button type="button" data-sentence-move="${sentence.id}" class="btn-icon secondary" title="Move">➡️</button>
                        <button type="button" data-sentence-delete="${sentence.id}" class="btn-icon danger" title="Delete">🗑️</button>
                      </div>
                    </li>
                  `).join("")}
                </ul>
              ` : "<p>Select a list from the cube to open it.</p>"}
            </div>
          </div>
        </div>
      </section>
    `;

    bindDashboardActions();
    bindCubeActions();
    bindListDetailPanel();
    renderPendingReviews();
    renderMindMap();
}

function goBackToList() {
    const inner = document.getElementById("cubeAppInner");
    if (!inner) return;
    inner.classList.remove("cube-app-inner--list-open");
    inner.addEventListener("transitionend", function onEnd() {
        inner.removeEventListener("transitionend", onEnd);
        state.selectedListId = null;
        renderApp();
    }, { once: true });
}

function bindListDetailPanel() {
    const inner = document.getElementById("cubeAppInner");
    const panelDetail = document.getElementById("cubePanelListDetail");
    if (!inner) return;

    if (state.selectedListId) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                inner.classList.add("cube-app-inner--list-open");
            });
        });
    }

    const showListsBtn = document.getElementById("showListsBtn");
    const showListsBtnHeader = document.querySelector(".list-detail-back");
    if (showListsBtn) showListsBtn.addEventListener("click", goBackToList);
    if (showListsBtnHeader) showListsBtnHeader.addEventListener("click", goBackToList);

    if (panelDetail) {
        let startY = 0;
        panelDetail.addEventListener("touchstart", (e) => {
            if (e.touches.length === 1) startY = e.touches[0].clientY;
        }, { passive: true });
        panelDetail.addEventListener("touchend", (e) => {
            if (e.changedTouches.length !== 1) return;
            const endY = e.changedTouches[0].clientY;
            if (startY - endY > 60) goBackToList();
        });
    }
}

function setCubeFace(index) {
    const i = Math.max(0, Math.min(3, index));
    if (state.currentCubeFace === i) return;
    state.currentCubeFace = i;
    const container = document.getElementById("cubeContainer");
    const dots = document.querySelectorAll(".cube-dot");
    if (container) container.style.transform = `translateX(-${i * 25}%)`;
    dots.forEach((dot, idx) => dot.classList.toggle("active", idx === i));
}

function bindCubeActions() {
    const viewport = document.getElementById("cubeViewport");
    const container = document.getElementById("cubeContainer");
    if (!viewport || !container) return;

    let startX = 0;
    let startY = 0;
    let isDragging = false;
    let isHorizontalSwipe = null;

    function onPointerStart(clientX, clientY) {
        startX = clientX;
        startY = clientY || 0;
        isDragging = true;
        isHorizontalSwipe = null;
        container.style.transition = "none";
    }
    function onPointerMove(clientX, clientY) {
        if (!isDragging) return;
        const deltaX = clientX - startX;
        const deltaY = (clientY ?? startY) - startY;
        if (isHorizontalSwipe === null) {
            isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY);
        }
        if (!isHorizontalSwipe) return;
        const viewportW = viewport.clientWidth || 1;
        const percentPerPx = (25 / viewportW);
        const basePercent = state.currentCubeFace * 25;
        const dragPercent = basePercent - (deltaX * percentPerPx);
        const clamped = Math.max(0, Math.min(75, dragPercent));
        container.style.transform = `translateX(-${clamped}%)`;
    }
    function onPointerEnd(clientX) {
        if (!isDragging) return;
        isDragging = false;
        container.style.transition = "";
        const delta = clientX - startX;
        const threshold = 50;
        if (isHorizontalSwipe && delta > threshold) setCubeFace(state.currentCubeFace - 1);
        else if (isHorizontalSwipe && delta < -threshold) setCubeFace(state.currentCubeFace + 1);
        else container.style.transform = `translateX(-${state.currentCubeFace * 25}%)`;
    }

    viewport.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return;
        onPointerStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    viewport.addEventListener("touchmove", (e) => {
        if (e.touches.length !== 1) return;
        if (isHorizontalSwipe === true && isDragging) e.preventDefault();
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    viewport.addEventListener("touchend", (e) => {
        if (e.changedTouches.length !== 1) return;
        onPointerEnd(e.changedTouches[0].clientX);
    });
    viewport.addEventListener("touchcancel", (e) => {
        if (e.changedTouches.length) onPointerEnd(e.changedTouches[0].clientX);
    });

    viewport.addEventListener("mousedown", (e) => {
        onPointerStart(e.clientX, e.clientY);
        const moveHandler = (e2) => onPointerMove(e2.clientX, e2.clientY);
        const upHandler = (e2) => {
            onPointerEnd(e2.clientX);
            document.removeEventListener("mousemove", moveHandler);
            document.removeEventListener("mouseup", upHandler);
        };
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
    });

    document.querySelectorAll(".cube-dot").forEach((btn) => {
        btn.addEventListener("click", () => {
            const face = parseInt(btn.getAttribute("data-cube-face"), 10);
            if (!Number.isNaN(face)) setCubeFace(face);
        });
    });
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
    // Strip punctuation (include curly/smart apostrophe \u2019 and quotes so "don't" matches "don't")
    return t.replace(/[\s.,?!;:'"\u2018\u2019\u201c\u201d\-—–()\[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
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
            <div class="card">
              <div><b>Session ${session.id}</b></div>
              <div class="hint">
                ${new Date(session.startAt).toLocaleString()} (${session.items.length} sentences)
              </div>
              <div class="row">
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
            state.selectedListId = Number(button.getAttribute("data-list-open"));
            await refreshAndRender();
        });
    });
    document.querySelectorAll(".list-item-main").forEach((el) => {
        el.addEventListener("click", async () => {
            const li = el.closest(".list-item");
            const listId = li ? Number(li.getAttribute("data-list-id")) : null;
            if (listId == null) return;
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
        button.addEventListener("click", async () => {
            const listId = Number(button.getAttribute("data-list-rename"));
            const name = window.prompt("New list name:");
            if (!name) return;
            await api.renameList(listId, { name });
            await refreshAndRender();
        });
    });
    document.querySelectorAll("[data-list-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
            const listId = Number(button.getAttribute("data-list-delete"));
            if (!window.confirm("Delete this list?")) return;
            await api.deleteList(listId);
            if (state.selectedListId === listId) {
                state.selectedListId = null;
            }
            await refreshAndRender();
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
    const scale = Math.min(w / MIND_MAP_CANVAS_WIDTH, h / MIND_MAP_CANVAS_HEIGHT, 1.2);
    const positions = state.mindMapPositions || {};
    const centerX = w / 2;
    const centerY = h / 2;
    const clusterDist = MIND_MAP_CLUSTER_DIST * scale;
    const inListR = MIND_MAP_IN_LIST_RADIUS * scale;
    const inListStep = MIND_MAP_IN_LIST_STEP * scale;

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

    return nodes.map((node) => {
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

        const nodeAngle = nodeIdxInList * MIND_MAP_IN_LIST_ANGLE;
        const nodeR = inListR + nodeIdxInList * inListStep;
        const x = lcx + nodeR * Math.cos(nodeAngle);
        const y = lcy + nodeR * Math.sin(nodeAngle);
        return { node, x, y };
    });
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

    const positions = getMindMapNodePositions(nodes, canvas.width, canvas.height);
    state.mindMapLastPositions = positions;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
            ctx.strokeStyle = "#1f3b66";
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
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
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
                state.selectedSentenceId = state.selectedSentenceId === node.id ? null : node.id;
                redrawMindMapCanvas();
                document.querySelectorAll(".sentence-item").forEach((li) => {
                    li.classList.toggle("selected", Number(li.getAttribute("data-sentence-id")) === state.selectedSentenceId);
                });
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

    canvas.addEventListener("mousedown", (e) => {
        const { x, y } = canvasCoords(canvas, e.clientX, e.clientY);
        const node = hitTestNode(x, y);
        if (!node) return;
        startDrag(node, e.clientX, e.clientY);
    });

    canvas.addEventListener("touchstart", (e) => {
        if (!e.touches.length) return;
        e.preventDefault();
        const touch = e.touches[0];
        const { x, y } = canvasCoords(canvas, touch.clientX, touch.clientY);
        const node = hitTestNode(x, y);
        if (!node) return;
        startDrag(node, touch.clientX, touch.clientY);
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
        state.selectedSentenceId = state.selectedSentenceId === node.id ? null : node.id;
        redrawMindMapCanvas();
        document.querySelectorAll(".sentence-item").forEach((li) => {
            li.classList.toggle("selected", Number(li.getAttribute("data-sentence-id")) === state.selectedSentenceId);
        });
    });

    canvas.style.cursor = "pointer";
}

bootstrap();
