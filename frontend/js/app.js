import { api } from "./api.js?v=2";
import { speak, preload as preloadTTS, getUseNaturalTts, setUseNaturalTts, getIsKokoroSupported } from "./tts.js";

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
    globalSearchQuery: "",
    globalSearchResults: [],
    globalSearchDebounce: null,
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
    restoreMindMapFullscreen: false,
    mindMapCenterListId: null,
    mindMapPanVelocity: { vx: 0, vy: 0 },
    mindMapPanBounds: null,
    mindMapInertialAnimating: false,
    mindMapLastPanTime: 0,
    mindMapLastDisplayPan: null,
    newListId: null,
    newSentenceId: null,
    morphClone: null,
    justOpenedListId: null,
    mindMapInertialRAF: null,
    mindMapSnapBackAnimating: false,
    mindMapSnapBackRAF: null,
    mindMapSnapBackData: null,
    mindMapPinching: false,
    mindMapPinchStartDistance: 0,
    mindMapPinchStartScale: 1,
    /** @type {{ [idx: number]: number }} stage 1=full, 2=verbs hidden, 3=all hidden */
    reviewSpeakCheckStage: {},
    testReviewStage: 1,
    /** 'forgot' | null when on auth screen */
    authView: null,
    authMessage: null
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

/** Shown at most once per page load when there are due, unread review sessions. */
let hasShownReviewNotificationThisLoad = false;

function isSessionDue(session) {
    const v = session?.isDueNow;
    return v === true || v === "true";
}

function isSessionUnread(session) {
    const v = session?.notificationRead;
    return v === false || v === "false" || v == null;
}

function getDueUnreadSessions() {
    return (state.pendingSessions || []).filter((s) => isSessionDue(s) && isSessionUnread(s));
}

function showReviewDueNotificationIfNeeded() {
    if (hasShownReviewNotificationThisLoad) return;
    const dueUnread = getDueUnreadSessions();
    if (dueUnread.length === 0) return;
    if (typeof Notification === "undefined") return;

    const show = () => {
        const count = dueUnread.length;
        const n = new Notification("Time for a review", {
            body: count === 1 ? "You have 1 pending review session." : `You have ${count} pending review sessions.`
        });
        n.onclick = () => {
            window.focus();
            n.close();
        };
        hasShownReviewNotificationThisLoad = true;
    };

    if (Notification.permission === "granted") {
        show();
        return;
    }
    if (Notification.permission === "default") {
        Notification.requestPermission().then((permission) => {
            if (permission === "granted") show();
        });
    }
}

/** Call from a user gesture (e.g. button click) to request notification permission and optionally show a notification if there are due reviews. */
function requestReviewNotificationPermission() {
    if (typeof Notification === "undefined") {
        notify("Browser notifications are not supported.");
        return;
    }
    if (Notification.permission === "granted") {
        const dueUnread = getDueUnreadSessions();
        if (dueUnread.length > 0) {
            const count = dueUnread.length;
            const n = new Notification("Time for a review", {
                body: count === 1 ? "You have 1 pending review session." : `You have ${count} pending review sessions.`
            });
            n.onclick = () => { window.focus(); n.close(); };
        } else {
            notify("Notifications are enabled. You’ll get a reminder when you have pending reviews.");
        }
        return;
    }
    if (Notification.permission === "denied") {
        notify("Review reminders are blocked. Allow notifications in your browser for this site to get reminders.");
        return;
    }
    Notification.requestPermission().then((permission) => {
        if (permission === "granted") {
            hasShownReviewNotificationThisLoad = true;
            const dueUnread = getDueUnreadSessions();
            if (dueUnread.length > 0) {
                const count = dueUnread.length;
                const n = new Notification("Time for a review", {
                    body: count === 1 ? "You have 1 pending review session." : `You have ${count} pending review sessions.`
                });
                n.onclick = () => { window.focus(); n.close(); };
            } else {
                notify("Review reminders enabled. You’ll get a notification when you have pending reviews.");
            }
        } else {
            notify("Permission denied. Enable notifications in browser settings to get review reminders.");
        }
    });
}

function renderSentenceWithWordLinks(content) {
    if (!content || typeof content !== "string") return escapeHtml(content);
    return content.replace(/\w+(?:'\w+)*/g, (match) => {
        const safe = escapeHtml(match);
        const key = escapeHtml(match.toLowerCase());
        return `<span class="dict-word" data-word="${key}" title="Click to look up">${safe}</span>`;
    });
}

const HIDDEN_PLACEHOLDER = "{{HIDDEN}}";

/** One blank per word for "all hidden" stage (returns text with placeholders). */
function getSentenceWithAllHidden(text) {
    if (!text || typeof text !== "string") return "";
    return text.replace(/\w+(?:'\w+)*/g, HIDDEN_PLACEHOLDER);
}

let nlpModule = null;
async function getNlp() {
    if (!nlpModule) nlpModule = await import("https://esm.sh/compromise@14");
    return nlpModule.default;
}

/** Returns sentence with verbs replaced by placeholder. Uses compromise for POS. */
async function getSentenceWithVerbsHidden(text) {
    if (!text || typeof text !== "string") return "";
    try {
        const nlp = await getNlp();
        const doc = nlp(text);
        const verbs = doc.verbs();
        if (verbs.length) verbs.replaceWith(HIDDEN_PLACEHOLDER);
        return doc.out("text") || text;
    } catch (_) {
        return text;
    }
}

const HIDDEN_WORD_HTML = '<span class="review-hidden-word"></span>';

/** Get display content for review sentence by stage (1=full, 2=verbs hidden, 3=all hidden). */
async function getReviewSentenceDisplay(content, stage) {
    if (stage === 1) return renderSentenceWithWordLinks(content);
    const placeholderRegex = /\{\{HIDDEN\}\}/g;
    if (stage === 2) {
        const masked = await getSentenceWithVerbsHidden(content);
        return escapeHtml(masked).replace(placeholderRegex, HIDDEN_WORD_HTML);
    }
    const masked = getSentenceWithAllHidden(content);
    return escapeHtml(masked).replace(placeholderRegex, HIDDEN_WORD_HTML);
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
        showReviewDueNotificationIfNeeded();
        // Preload natural TTS only if user has enabled it
        if (getUseNaturalTts()) setTimeout(() => preloadTTS(), 1500);
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

let ttsProgressBarEl = null;

function showTtsProgress() {
    if (!ttsProgressBarEl) {
        ttsProgressBarEl = document.createElement("div");
        ttsProgressBarEl.id = "ttsProgressBar";
        ttsProgressBarEl.className = "tts-progress-bar";
        ttsProgressBarEl.setAttribute("aria-live", "polite");
        ttsProgressBarEl.setAttribute("aria-label", "Preparing speech");
        ttsProgressBarEl.innerHTML = '<div class="tts-progress-bar-inner"></div>';
        document.body.appendChild(ttsProgressBarEl);
    }
    ttsProgressBarEl.classList.add("is-active");
}

function hideTtsProgress() {
    if (ttsProgressBarEl) ttsProgressBarEl.classList.remove("is-active");
}

/** Show TTS loading: in-item progress bar when natural voice + item el given, else global bar. */
function showTtsProgressOnItem(itemEl) {
    if (getUseNaturalTts() && itemEl) {
        itemEl.classList.remove("tts-done");
        itemEl.classList.add("tts-loading");
    } else if (getUseNaturalTts()) {
        showTtsProgress();
    }
}

/** Hide TTS loading: animate to full then clear; or hide global bar. */
function hideTtsProgressOnItem(itemEl) {
    if (getUseNaturalTts() && itemEl) {
        itemEl.classList.remove("tts-loading");
        itemEl.classList.add("tts-done");
        setTimeout(() => itemEl.classList.remove("tts-done"), 300);
    } else if (getUseNaturalTts()) {
        hideTtsProgress();
    }
}

async function sentenceSpeak(id) {
    const sentence = state.sentences.find((s) => s.id === id);
    if (!sentence || !sentence.content) return;
    const itemEl = document.querySelector(`.sentence-item[data-sentence-id="${id}"]`);
    showTtsProgressOnItem(itemEl);
    try {
        await speak(sentence.content);
    } finally {
        hideTtsProgressOnItem(itemEl);
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

async function sentenceVideo(id) {
    if (typeof api.getSentenceVideoLinks !== "function") {
        notify("Please refresh the page (or close and reopen the tab) to get the latest version.");
        return;
    }
    try {
        const links = await api.getSentenceVideoLinks(id);
        showSentenceActionPopup("video", id, links);
    } catch (e) {
        notify(e.message || "Failed to load video links.");
    }
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
    if (!listActionPopupEl) return;
    listActionPopupEl.classList.remove("is-open");
    setTimeout(() => listActionPopupEl.classList.remove("is-visible"), 320);
}

function showListActionPopup(action, listId, listName) {
    if (!listActionPopupEl) {
        listActionPopupEl = document.createElement("div");
        listActionPopupEl.className = "sentence-action-popup-backdrop list-action-popup-backdrop";
        listActionPopupEl.innerHTML = '<div class="sentence-action-popup list-action-popup"></div>';
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
            try {
                await api.deleteList(listId);
            } catch (e) {
                notify(e.message || "Failed to delete list.");
                return;
            }
            closeListActionPopup();
            const listCard = document.querySelector(`.list-item[data-list-id="${listId}"]`);
            if (listCard) {
                listCard.classList.add("is-completing");
                listCard.addEventListener("transitionend", function onEnd(e) {
                    if (e.target !== listCard || e.propertyName !== "max-height") return;
                    listCard.removeEventListener("transitionend", onEnd);
                    listCard.remove();
                    state.lists = state.lists.filter((l) => l.id !== listId);
                    if (state.selectedListId === listId) {
                        state.selectedListId = null;
                        renderApp();
                    }
                });
            } else {
                state.lists = state.lists.filter((l) => l.id !== listId);
                if (state.selectedListId === listId) state.selectedListId = null;
                await refreshAndRender();
            }
        });
    }

    listActionPopupEl.classList.add("is-visible");
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            listActionPopupEl.classList.add("is-open");
            if (action === "rename") {
                const input = popup.querySelector("#listRenameInput");
                if (input) {
                    input.focus();
                    input.select();
                }
            }
        });
    });
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
            try {
                await api.deleteSentence(sentenceId);
            } catch (e) {
                notify(e.message || "Failed to delete sentence.");
                return;
            }
            closeSentenceActionPopup();
            const sentenceCard = document.querySelector(`.sentence-item[data-sentence-id="${sentenceId}"]`);
            if (sentenceCard) {
                sentenceCard.classList.add("is-completing");
                sentenceCard.addEventListener("transitionend", function onEnd(e) {
                    if (e.target !== sentenceCard || e.propertyName !== "max-height") return;
                    sentenceCard.removeEventListener("transitionend", onEnd);
                    sentenceCard.remove();
                    state.sentences = state.sentences.filter((s) => s.id !== sentenceId);
                    redrawMindMapCanvas();
                });
            } else {
                await refreshAndRender();
            }
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
    } else if (action === "video") {
        const links = Array.isArray(data) ? data : [];
        popup.innerHTML = `
            <h4>🎬 Video links</h4>
            <p class="hint">Link videos (e.g. YouTube) with an optional time code to see this sentence in context.</p>
            <ul class="video-links-list" data-video-links-container>
                ${links.length === 0 ? "<li class=\"hint\">No links yet. Add one below.</li>" : links.map((link) => `
                <li class="video-link-item" data-link-id="${link.id}">
                    <a href="#" class="video-link-open" data-link-id="${link.id}" data-url="${escapeHtml(link.url)}" data-time="${link.timeCodeSeconds != null ? link.timeCodeSeconds : ""}">${escapeHtml(link.label || link.url)}${link.timeCodeSeconds != null ? ` (${formatTimeCode(link.timeCodeSeconds)})` : ""}</a>
                    <button type="button" class="btn-icon danger video-link-delete" data-link-id="${link.id}" title="Remove">🗑️</button>
                </li>
                `).join("")}
            </ul>
            <div class="video-link-add">
                <label>URL</label>
                <input type="url" id="videoLinkUrl" placeholder="https://youtube.com/watch?v=..." />
                <label>Time code (seconds, optional)</label>
                <input type="number" id="videoLinkTime" min="0" placeholder="e.g. 83" />
                <label>Label (optional)</label>
                <input type="text" id="videoLinkLabel" placeholder="e.g. Scene at 1:23" />
                <button type="button" class="popup-add-video-link">Add link</button>
            </div>
            <div class="popup-actions">
                <button type="button" class="secondary popup-cancel">Close</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);

        popup.querySelectorAll(".video-link-open").forEach((a) => {
            a.addEventListener("click", (e) => {
                e.preventDefault();
                const url = e.currentTarget.getAttribute("data-url");
                const time = e.currentTarget.getAttribute("data-time");
                openVideoUrlWithTime(url, time ? parseInt(time, 10) : null);
            });
        });
        popup.querySelectorAll(".video-link-delete").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const linkId = Number(btn.getAttribute("data-link-id"));
                try {
                    await api.deleteSentenceVideoLink(sentenceId, linkId);
                } catch (err) {
                    notify(err.message || "Failed to delete link.");
                    return;
                }
                const item = popup.querySelector(`.video-link-item[data-link-id="${linkId}"]`);
                if (item) item.remove();
                if (popup.querySelectorAll(".video-link-item").length === 0) {
                    const list = popup.querySelector(".video-links-list");
                    if (list) list.innerHTML = "<li class=\"hint\">No links yet. Add one below.</li>";
                }
            });
        });
        popup.querySelector(".popup-add-video-link").addEventListener("click", async () => {
            const urlInput = popup.querySelector("#videoLinkUrl");
            const timeInput = popup.querySelector("#videoLinkTime");
            const labelInput = popup.querySelector("#videoLinkLabel");
            const url = (urlInput && urlInput.value || "").trim();
            if (!url) {
                notify("Enter a video URL.");
                return;
            }
            const timeVal = timeInput && timeInput.value.trim();
            const timeCodeSeconds = timeVal ? parseInt(timeVal, 10) : null;
            const label = (labelInput && labelInput.value || "").trim() || null;
            try {
                const added = await api.addSentenceVideoLink(sentenceId, { url, timeCodeSeconds: timeCodeSeconds >= 0 ? timeCodeSeconds : null, label });
                const list = popup.querySelector(".video-links-list");
                if (list) {
                    const hint = list.querySelector(".hint");
                    if (hint) hint.remove();
                    const li = document.createElement("li");
                    li.className = "video-link-item";
                    li.setAttribute("data-link-id", added.id);
                    li.innerHTML = `<a href="#" class="video-link-open" data-link-id="${added.id}" data-url="${escapeHtml(added.url)}" data-time="${added.timeCodeSeconds != null ? added.timeCodeSeconds : ""}">${escapeHtml(added.label || added.url)}${added.timeCodeSeconds != null ? ` (${formatTimeCode(added.timeCodeSeconds)})` : ""}</a> <button type="button" class="btn-icon danger video-link-delete" data-link-id="${added.id}" title="Remove">🗑️</button>`;
                    li.querySelector(".video-link-open").addEventListener("click", (e) => {
                        e.preventDefault();
                        openVideoUrlWithTime(added.url, added.timeCodeSeconds);
                    });
                    li.querySelector(".video-link-delete").addEventListener("click", async () => {
                        try {
                            await api.deleteSentenceVideoLink(sentenceId, added.id);
                            li.remove();
                            if (list.querySelectorAll(".video-link-item").length === 0) {
                                list.innerHTML = "<li class=\"hint\">No links yet. Add one below.</li>";
                            }
                        } catch (err) {
                            notify(err.message || "Failed to delete link.");
                        }
                    });
                    list.appendChild(li);
                }
                urlInput.value = "";
                if (timeInput) timeInput.value = "";
                if (labelInput) labelInput.value = "";
            } catch (err) {
                notify(err.message || "Failed to add link.");
            }
        });
    }

    sentenceActionPopupEl.classList.add("is-open");
}

function formatTimeCode(seconds) {
    if (seconds == null || isNaN(seconds)) return "";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function openVideoUrlWithTime(url, timeCodeSeconds) {
    if (!url) return;
    let openUrl = url;
    const isYoutube = /youtube\.com|youtu\.be/i.test(url);
    if (isYoutube && timeCodeSeconds != null && timeCodeSeconds >= 0) {
        try {
            const u = new URL(url);
            u.searchParams.set("t", String(timeCodeSeconds));
            openUrl = u.toString();
        } catch (_) {
            openUrl = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + timeCodeSeconds;
        }
    }
    window.open(openUrl, "_blank", "noopener,noreferrer");
}

function isSentenceActionPopupOpen() {
    return sentenceActionPopupEl && sentenceActionPopupEl.classList.contains("is-open");
}

function getResetTokenFromHash() {
    const hash = window.location.hash || "";
    const m = hash.match(/#reset\?token=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

function clearResetHash() {
    if (window.location.hash.startsWith("#reset")) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
    }
}

function renderAuth() {
    const resetToken = getResetTokenFromHash();
    userBarEl.innerHTML = "";

    if (resetToken) {
        appEl.innerHTML = html`
            <section class="container card">
                <h2>Set new password</h2>
                <p class="hint">Enter your new password (min 8 characters).</p>
                ${state.authMessage ? html`<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : ""}
                <div class="row">
                    <input id="resetNewPassword" type="password" placeholder="New password (min 8 chars)" />
                    <input id="resetConfirmPassword" type="password" placeholder="Confirm password" />
                </div>
                <div class="row">
                    <button id="resetPasswordBtn">Reset password</button>
                </div>
            </section>
        `;
        document.getElementById("resetPasswordBtn").addEventListener("click", async () => {
            const newPassword = document.getElementById("resetNewPassword").value;
            const confirmPassword = document.getElementById("resetConfirmPassword").value;
            if (newPassword.length < 8) {
                state.authMessage = "Password must be at least 8 characters.";
                renderAuth();
                return;
            }
            if (newPassword !== confirmPassword) {
                state.authMessage = "Passwords do not match.";
                renderAuth();
                return;
            }
            try {
                await api.resetPassword({ token: resetToken, newPassword });
                state.authMessage = "Password reset. You can now log in.";
                state.authView = null;
                clearResetHash();
                renderAuth();
            } catch (e) {
                state.authMessage = e.message || "Reset failed. The link may have expired.";
                renderAuth();
            }
        });
        return;
    }

    if (state.authView === "forgot") {
        appEl.innerHTML = html`
            <section class="container card">
                <h2>Reset password</h2>
                <p class="hint">Enter your email and we’ll send you a link to reset your password.</p>
                ${state.authMessage ? html`<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : ""}
                <div class="row">
                    <input id="forgotEmail" type="email" placeholder="Email" />
                </div>
                <div class="row">
                    <button id="forgotSubmitBtn">Send reset link</button>
                    <button id="forgotBackBtn" class="secondary">Back to login</button>
                </div>
            </section>
        `;
        document.getElementById("forgotSubmitBtn").addEventListener("click", async () => {
            const email = document.getElementById("forgotEmail").value.trim();
            if (!email) {
                state.authMessage = "Please enter your email.";
                renderAuth();
                return;
            }
            try {
                await api.forgotPassword({ email });
                state.authMessage = "If an account exists with this email, you will receive reset instructions.";
                state.authView = null;
                renderAuth();
            } catch (e) {
                state.authMessage = e.message || "Request failed.";
                renderAuth();
            }
        });
        document.getElementById("forgotBackBtn").addEventListener("click", () => {
            state.authView = null;
            state.authMessage = null;
            renderAuth();
        });
        return;
    }

    state.authMessage = null;
    appEl.innerHTML = html`
        <section class="container card">
            <h2>Login / Register</h2>
            <p class="hint">Use your own credentials to create account and login.</p>
            ${state.authMessage ? html`<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : ""}
            <div class="row">
                <input id="authEmail" type="email" placeholder="Email" />
                <input id="authPassword" type="password" placeholder="Password (min 8 chars)" />
            </div>
            <div class="row">
                <button id="loginBtn">Login</button>
                <button id="registerBtn" class="secondary">Register</button>
            </div>
            <p class="auth-footer"><a href="#" id="forgotPasswordLink">Forgot password?</a></p>
        </section>
    `;

    document.getElementById("loginBtn").addEventListener("click", async () => {
        await authAction("login");
    });
    document.getElementById("registerBtn").addEventListener("click", async () => {
        await authAction("register");
    });
    document.getElementById("forgotPasswordLink").addEventListener("click", (e) => {
        e.preventDefault();
        state.authView = "forgot";
        state.authMessage = null;
        renderAuth();
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
    const notificationsCount = getDueUnreadSessions().length;

    appEl.innerHTML = html`
      <section class="dashboard container">
        ${!state.selectedListId ? html`
        <div class="dashboard-tabs" role="tablist">
          <button type="button" class="dashboard-tab ${state.currentSection === 0 ? "active" : ""}" data-section="0" role="tab">Lists</button>
          <button type="button" class="dashboard-tab ${state.currentSection === 1 ? "active" : ""}" data-section="1" role="tab">Reviews</button>
          <button type="button" class="dashboard-tab ${state.currentSection === 2 ? "active" : ""}" data-section="2" role="tab">Settings</button>
          <button type="button" class="dashboard-tab ${state.currentSection === 3 ? "active" : ""}" data-section="3" role="tab">Mind Map</button>
          <div class="mind-map-zoom-controls mind-map-tabs-controls" style="display: ${state.currentSection === 3 ? "flex" : "none"}">
            <button type="button" id="mindMapZoomOut" class="btn-icon secondary" title="Zoom out">−</button>
            <span class="mind-map-zoom-label" id="mindMapZoomLabel">100%</span>
            <button type="button" id="mindMapZoomIn" class="btn-icon secondary" title="Zoom in">+</button>
            <button type="button" id="mindMapFullscreen" class="btn-icon secondary" title="Full screen">⛶</button>
          </div>
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
                      <div class="hint sentence-item-meta">${new Date(sentence.createdAt).toLocaleString()}${(sentence.reviewCount != null && sentence.reviewCount > 0) ? ` · Reviewed ${sentence.reviewCount} time${sentence.reviewCount === 1 ? "" : "s"}` : ""}</div>
                      <div class="row sentence-actions">
                        <button type="button" data-sentence-speak="${sentence.id}" class="btn-icon secondary" title="Listen">🔊</button>
                        <button type="button" data-sentence-playphrase="${sentence.id}" class="btn-icon secondary" title="Play phrase (playphrase.me)">▶️</button>
                        <button type="button" data-sentence-youglish="${sentence.id}" class="btn-icon secondary" title="Pronounce (YouGlish)">🔤</button>
                        <button type="button" data-sentence-test-review="${sentence.id}" class="btn-icon secondary" title="Test review">📋</button>
                        <button type="button" data-sentence-grammar="${sentence.id}" class="btn-icon secondary" title="Check grammar">✓</button>
                        <button type="button" data-sentence-edit="${sentence.id}" class="btn-icon secondary" title="Edit">✏️</button>
                        <button type="button" data-sentence-video="${sentence.id}" class="btn-icon secondary" title="Video links">🎬</button>
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
              <div class="row global-search-row">
                <input id="globalSearchInput" type="search" class="input-soft" placeholder="Search sentences in all lists…" value="${escapeHtml(state.globalSearchQuery || "")}" autocomplete="off" />
              </div>
              ${(state.globalSearchResults && state.globalSearchResults.length > 0) ? html`
                <div class="global-search-results">
                  <div class="hint">${state.globalSearchResults.length} result${state.globalSearchResults.length === 1 ? "" : "s"}</div>
                  <ul class="global-search-result-list">
                    ${state.globalSearchResults.map((r) => html`
                      <li class="global-search-result-item" data-search-list-id="${r.listId}" data-search-sentence-id="${r.id}" role="button" tabindex="0">
                        <div class="global-search-result-content">${renderSentenceWithWordLinks(r.content)}</div>
                        <div class="hint">in ${escapeHtml(r.listName || "")}${(r.reviewCount != null && r.reviewCount > 0) ? ` · Reviewed ${r.reviewCount} time${r.reviewCount === 1 ? "" : "s"}` : ""}</div>
                      </li>
                    `).join("")}
                  </ul>
                </div>
              ` : ""}
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
              <h3 data-pending-reviews-heading>Pending Reviews (${notificationsCount})</h3>
              <div id="pendingReviews"></div>
            </div>
            <div class="dashboard-panel card settings-panel" data-section="2" style="display: ${state.currentSection === 2 ? "block" : "none"}">
              <h3>Settings</h3>
              <div class="hint">Merge window defines how close due sentences are grouped in one session.</div>
              <div class="row">
                <input id="mergeWindowInput" type="number" class="input-soft" min="10" value="${state.settings.mergeWindowMinutes}" />
                <select id="weeklyDayInput" class="input-soft">
                  ${[1,2,3,4,5,6,7].map((d) => html`<option value="${d}" ${state.settings.weeklyReviewDay === d ? "selected" : ""}>Day ${d}</option>`).join("")}
                </select>
              </div>
              <input id="timezoneInput" class="input-soft" value="${escapeHtml(state.settings.timezone)}" placeholder="Timezone, e.g. UTC or Europe/Berlin" />
              <div class="row" style="margin-top: 0.75rem;">
                <label class="checkbox-label">
                  <input type="checkbox" id="useNaturalTtsInput" ${getUseNaturalTts() ? "checked" : ""} />
                  Use natural voice — ${getIsKokoroSupported() ? "Kokoro (desktop)" : "Piper (iOS/Android)"}, slower first time
                </label>
              </div>
              <div class="row settings-button-row review-reminders-row">
                <button type="button" id="enableReviewRemindersBtn" class="secondary">Enable review reminders</button>
                <span class="hint" id="reviewRemindersHint" style="margin-left: 8px;"></span>
              </div>
              <div class="settings-button-row settings-actions">
                <button id="saveSettingsBtn">Save settings</button>
              </div>
            </div>
            <div class="dashboard-panel card mind-map-section" data-section="3" style="display: ${state.currentSection === 3 ? "flex" : "none"}">
              <h3>Mind Map (all lists)</h3>
              <div class="mind-map-zoom-wrap">
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

    if (state.selectedListId && state.justOpenedListId === state.selectedListId) {
        const listDetail = appEl.querySelector(".dashboard-list-detail");
        if (listDetail) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    listDetail.classList.add("list-detail-open");
                    state.justOpenedListId = null;
                });
            });
        } else {
            state.justOpenedListId = null;
        }
    } else if (state.selectedListId) {
        const listDetail = appEl.querySelector(".dashboard-list-detail");
        if (listDetail) listDetail.classList.add("list-detail-open");
    }

    if (state.newListId != null && !state.selectedListId && state.currentSection === 0) {
        const listEl = document.querySelector(`.list-item[data-list-id="${state.newListId}"]`);
        if (listEl) {
            listEl.classList.add("is-adding");
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    listEl.classList.remove("is-adding");
                    state.newListId = null;
                });
            });
        } else {
            state.newListId = null;
        }
    }
    if (state.morphClone && state.newSentenceId != null && state.selectedListId) {
        const sentenceEl = document.querySelector(`.sentence-item[data-sentence-id="${state.newSentenceId}"]`);
        if (sentenceEl) {
            sentenceEl.classList.add("sentence-item-morph-target");
            const itemRect = sentenceEl.getBoundingClientRect();
            const listEl = sentenceEl.closest(".sentence-list");
            if (listEl) {
                listEl.classList.add("sentence-list-morphing");
                const slideDistance = itemRect.height + 12;
                listEl.style.setProperty("--morph-item-height", `${slideDistance}px`);
            }
            const clone = state.morphClone;
            requestAnimationFrame(() => {
                if (listEl) listEl.style.setProperty("--morph-item-height", "0");
                clone.style.left = `${itemRect.left}px`;
                clone.style.top = `${itemRect.top}px`;
                clone.style.width = `${itemRect.width}px`;
                clone.style.height = `${itemRect.height}px`;
                clone.style.borderRadius = "8px";
                clone.style.boxShadow = "none";
            });
            const onMorphEnd = () => {
                clone.removeEventListener("transitionend", onMorphEnd);
                clone.remove();
                state.morphClone = null;
                if (listEl) {
                    listEl.classList.remove("sentence-list-morphing");
                    listEl.style.removeProperty("--morph-item-height");
                }
                sentenceEl.classList.add("is-adding");
                sentenceEl.classList.remove("sentence-item-morph-target");
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        sentenceEl.classList.remove("is-adding");
                        state.newSentenceId = null;
                    });
                });
            };
            clone.addEventListener("transitionend", onMorphEnd);
        } else {
            state.morphClone.remove();
            state.morphClone = null;
            state.newSentenceId = null;
        }
    } else if (state.newSentenceId != null && state.selectedListId) {
        const sentenceEl = document.querySelector(`.sentence-item[data-sentence-id="${state.newSentenceId}"]`);
        if (sentenceEl) {
            sentenceEl.classList.add("is-adding");
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    sentenceEl.classList.remove("is-adding");
                    state.newSentenceId = null;
                });
            });
        } else {
            state.newSentenceId = null;
        }
    }

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
                panel.style.display = s === section ? (s === 3 ? "flex" : "block") : "none";
            });
            const zoomControls = document.querySelector(".mind-map-tabs-controls");
            if (zoomControls) zoomControls.style.display = section === 3 ? "flex" : "none";
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
    state.reviewSpeakCheckStage = Object.fromEntries(session.items.map((_, i) => [i, 1]));
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
                  <button type="button" class="btn-icon secondary review-speak-check stage-1" data-review-speak-check-idx="${idx}" title="Speak and check (stage 1: full sentence)">🎤</button>
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
        const sessionPage = appEl.querySelector(".review-session-page");
        const completeBtn = document.getElementById("reviewSessionCompleteBtn");
        try {
            if (completeBtn) {
                completeBtn.disabled = true;
                completeBtn.textContent = "Marking…";
            }
            await api.completeReviewSession(session.id);
            if (sessionPage) {
                sessionPage.classList.add("review-session-completing");
                let navigated = false;
                const done = () => {
                    if (navigated) return;
                    navigated = true;
                    state.view = "dashboard";
                    state.openSessionId = null;
                    state.openSession = null;
                    state.selectedListId = null;
                    state.currentSection = 1;
                    refreshAndRender();
                };
                sessionPage.addEventListener("transitionend", (e) => {
                    if (e.target !== sessionPage || e.propertyName !== "opacity") return;
                    done();
                });
                setTimeout(done, 500);
            } else {
                state.view = "dashboard";
                state.openSessionId = null;
                state.openSession = null;
                state.selectedListId = null;
                state.currentSection = 1;
                await refreshAndRender();
            }
        } catch (error) {
            notify(error.message);
            if (completeBtn) {
                completeBtn.disabled = false;
                completeBtn.textContent = "Mark as reviewed";
            }
        }
    });

    document.querySelectorAll("[data-review-speak-idx]").forEach((button) => {
        button.addEventListener("click", async () => {
            const idx = parseInt(button.getAttribute("data-review-speak-idx"), 10);
            const item = session.items[idx];
            if (!item || !item.content) return;
            const itemEl = appEl.querySelector(`.review-sentence-item[data-review-idx="${idx}"]`);
            showTtsProgressOnItem(itemEl);
            try {
                await speak(item.content);
            } finally {
                hideTtsProgressOnItem(itemEl);
            }
        });
    });

    document.querySelectorAll("[data-review-speak-check-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-speak-check-idx"), 10);
            startReviewVoiceCheck(session, idx);
        });
    });

    const sessionPage = appEl.querySelector(".review-session-page");
    if (sessionPage) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => sessionPage.classList.add("review-session-open"));
        });
    }
}

const NUMBER_WORDS = {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
    ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
    seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50",
    sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100", thousand: "1000"
};
const TENS_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ONES_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function normalizeNumberWordsToDigits(text) {
    if (!text) return text;
    const words = text.split(/\s+/).filter(Boolean);
    const out = [];
    for (let i = 0; i < words.length; i++) {
        const w = words[i].toLowerCase();
        const next = words[i + 1]?.toLowerCase();
        const tensVal = TENS_WORDS.indexOf(w) >= 0 ? NUMBER_WORDS[w] : null;
        const nextOnes = next && ONES_WORDS.indexOf(next) >= 0 ? NUMBER_WORDS[next] : null;
        if (tensVal != null && nextOnes != null) {
            out.push(String(parseInt(tensVal, 10) + parseInt(nextOnes, 10)));
            i++;
            continue;
        }
        if (NUMBER_WORDS[w] !== undefined) {
            out.push(NUMBER_WORDS[w]);
        } else {
            out.push(words[i]);
        }
    }
    return out.join(" ");
}

function normalizeForComparison(text) {
    const t = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
    // Remove apostrophes first so "friend's" and "friends'" both become "friends", "don't" becomes "dont"
    const noApostrophe = t.replace(/['\u2018\u2019`]/g, "");
    // Then strip remaining punctuation and collapse spaces
    const cleaned = noApostrophe.replace(/[\s.,?!;:"\u201c\u201d\-—–()\[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
    // Convert number words to digits so "five" matches "5", "twelve" matches "12", "twenty one" matches "21"
    return normalizeNumberWordsToDigits(cleaned);
}

function runVoiceCheck(expectedContent, resultEl, buttonEl, onCheckEnd) {
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

    const stopRecognition = () => {
        try {
            recognition.stop();
        } catch (_) { /* already stopped */ }
    };

    const finish = (match) => {
        buttonEl.disabled = false;
        if (typeof onCheckEnd === "function") onCheckEnd(!!match);
    };

    recognition.onresult = (event) => {
        stopRecognition();
        const transcript = (event.results[0] && event.results[0][0]) ? event.results[0][0].transcript : "";
        const said = normalizeForComparison(transcript);
        const match = expected === said;

        resultEl.className = "review-voice-result " + (match ? "review-voice-match" : "review-voice-mismatch");
        if (match) {
            resultEl.innerHTML = "✓ Match! You said it correctly.";
        } else {
            resultEl.innerHTML = `✗ You said: <strong>${escapeHtml(transcript.trim() || "(no speech heard)")}</strong><br>Expected: ${escapeHtml(expectedContent)}`;
        }
        finish(match);
    };

    recognition.onerror = (event) => {
        stopRecognition();
        resultEl.className = "review-voice-result review-voice-mismatch";
        const msg = event.error === "no-speech" ? "No speech heard. Try again." : (event.error === "not-allowed" ? "Microphone access denied." : `Error: ${event.error}`);
        resultEl.textContent = msg;
        finish(false);
    };

    recognition.onend = () => {
        if (resultEl.classList.contains("review-voice-listening")) {
            resultEl.className = "review-voice-result review-voice-mismatch";
            resultEl.textContent = "Recognition ended. Click 🎤 to try again.";
            finish(false);
        }
    };

    try {
        recognition.start();
    } catch (e) {
        resultEl.className = "review-voice-result review-voice-mismatch";
        resultEl.textContent = "Could not start voice recognition: " + (e.message || "unknown error");
        finish(false);
    }
}

async function updateReviewItemStageDisplay(session, idx) {
    const stage = state.reviewSpeakCheckStage[idx] ?? 1;
    const item = session?.items?.[idx];
    if (!item?.content) return;
    const contentEl = document.querySelector(`.review-sentence-item[data-review-idx="${idx}"] .review-sentence-content`);
    const buttonEl = document.querySelector(`[data-review-speak-check-idx="${idx}"]`);
    if (!contentEl || !buttonEl) return;
    contentEl.innerHTML = await getReviewSentenceDisplay(item.content, stage);
    buttonEl.classList.remove("stage-1", "stage-2", "stage-3");
    buttonEl.classList.add("stage-" + stage);
    const titles = { 1: "Speak and check (stage 1: full sentence)", 2: "Speak and check (stage 2: verbs hidden)", 3: "Speak and check (stage 3: from memory)" };
    buttonEl.title = titles[stage] || "Speak and check";
}

function advanceReviewStage(session, idx) {
    const current = state.reviewSpeakCheckStage[idx] ?? 1;
    if (current === 3) {
        const li = document.querySelector(`.review-sentence-item[data-review-idx="${idx}"]`);
        if (li) li.classList.add("review-sentence-item-completed");
    }
    state.reviewSpeakCheckStage[idx] = current === 3 ? 1 : current + 1;
    updateReviewItemStageDisplay(session, idx);
}

/**
 * Appends a "Skip this stage" button to the result element when speech was not recognized.
 * @param {HTMLElement} resultEl - The voice result container
 * @param {() => void} onSkip - Called when user clicks skip; advances stage
 */
function showSkipStageButton(resultEl, onSkip) {
    if (!resultEl) return;
    const existing = resultEl.querySelector(".review-skip-stage");
    if (existing) return;
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "review-skip-stage";
    skipBtn.textContent = "Skip this stage";
    skipBtn.addEventListener("click", () => {
        skipBtn.remove();
        onSkip();
    });
    resultEl.appendChild(skipBtn);
}

function startReviewVoiceCheck(session, idx) {
    const item = session?.items?.[idx];
    if (!item || !item.content) return;
    const resultEl = document.querySelector(`.review-voice-result[data-review-voice-idx="${idx}"]`);
    const buttonEl = document.querySelector(`[data-review-speak-check-idx="${idx}"]`);
    const onCheckEnd = (match) => {
        if (match) {
            advanceReviewStage(session, idx);
        } else {
            showSkipStageButton(resultEl, () => advanceReviewStage(session, idx));
        }
    };
    runVoiceCheck(item.content, resultEl, buttonEl, onCheckEnd);
}

let testReviewPopupEl = null;

function closeTestReviewPopup() {
    if (testReviewPopupEl) testReviewPopupEl.classList.remove("is-open");
}

async function updateTestReviewStageDisplay(sentence) {
    const stage = state.testReviewStage;
    const sentenceEl = testReviewPopupEl?.querySelector(".test-review-sentence");
    const speakCheckBtn = testReviewPopupEl?.querySelector(".test-review-speak-check");
    if (!sentenceEl || !speakCheckBtn || !sentence?.content) return;
    sentenceEl.innerHTML = await getReviewSentenceDisplay(sentence.content, stage);
    speakCheckBtn.classList.remove("stage-1", "stage-2", "stage-3");
    speakCheckBtn.classList.add("stage-" + stage);
    const titles = { 1: "Speak and check (stage 1: full sentence)", 2: "Speak and check (stage 2: verbs hidden)", 3: "Speak and check (stage 3: from memory)" };
    speakCheckBtn.title = titles[stage] || "Speak and check";
}

function openTestReviewPopup(sentenceId) {
    const sentence = state.sentences.find((s) => s.id === sentenceId);
    if (!sentence || !sentence.content) return;

    state.testReviewStage = 1;

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
          <button type="button" class="btn-icon secondary test-review-speak-check stage-1" title="Speak and check (stage 1: full sentence)">🎤</button>
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

    sentenceEl.innerHTML = renderSentenceWithWordLinks(sentence.content);

    listenBtn.addEventListener("click", async () => {
        showTtsProgress();
        try {
            await speak(sentence.content);
        } finally {
            hideTtsProgress();
        }
    });

    const onCheckEnd = (match) => {
        if (match) {
            state.testReviewStage = state.testReviewStage === 3 ? 1 : state.testReviewStage + 1;
            updateTestReviewStageDisplay(sentence);
        } else {
            showSkipStageButton(resultEl, () => {
                state.testReviewStage = state.testReviewStage === 3 ? 1 : state.testReviewStage + 1;
                updateTestReviewStageDisplay(sentence);
            });
        }
    };
    speakCheckBtn.addEventListener("click", () => runVoiceCheck(sentence.content, resultEl, speakCheckBtn, onCheckEnd));

    testReviewPopupEl.querySelector(".test-review-close").addEventListener("click", closeTestReviewPopup);

    testReviewPopupEl.classList.add("is-open");
}

async function renderPendingReviews() {
    const container = document.getElementById("pendingReviews");
    if (!container) {
        return;
    }
    const dueUnread = getDueUnreadSessions();
    const showReminderHint = dueUnread.length > 0 && typeof Notification !== "undefined" && Notification.permission !== "granted";
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
          `).join("") + (showReminderHint ? "<p class='hint' style='margin-top: 10px;'><button type='button' id='pendingReviewsEnableRemindersBtn' class='secondary'>Enable review reminders</button> — get a browser notification when reviews are due.</p>" : "");

    const enableRemindersBtn = document.getElementById("pendingReviewsEnableRemindersBtn");
    if (enableRemindersBtn) {
        enableRemindersBtn.addEventListener("click", () => requestReviewNotificationPermission());
    }

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
        button.addEventListener("click", () => {
            const id = Number(button.getAttribute("data-session-complete"));
            showMarkReviewedConfirmPopup(id, async () => {
                const card = button.closest(".pending-review-item");
                try {
                    await api.completeReviewSession(id);
                } catch (e) {
                    notify(e.message || "Failed to mark as reviewed.");
                    return;
                }
                if (card) {
                    card.classList.add("is-completing");
                    card.addEventListener("transitionend", function onEnd(e) {
                        if (e.target !== card || e.propertyName !== "max-height") return;
                        card.removeEventListener("transitionend", onEnd);
                        card.remove();
                        state.pendingSessions = state.pendingSessions.filter((s) => s.id !== id);
                        const reviewsHeading = document.querySelector("[data-pending-reviews-heading]");
                        if (reviewsHeading) reviewsHeading.textContent = `Pending Reviews (${state.pendingSessions.length})`;
                    });
                } else {
                    await refreshAndRender();
                }
            });
        });
    });
}

let markReviewedConfirmEl = null;

function showMarkReviewedConfirmPopup(sessionId, onConfirm) {
    if (!markReviewedConfirmEl) {
        markReviewedConfirmEl = document.createElement("div");
        markReviewedConfirmEl.className = "sentence-action-popup-backdrop mark-reviewed-confirm-backdrop";
        markReviewedConfirmEl.innerHTML = `
          <div class="sentence-action-popup mark-reviewed-confirm-popup">
            <h4>Mark as reviewed</h4>
            <p class="mark-reviewed-confirm-message">Are you sure you want to mark it as reviewed?</p>
            <div class="popup-actions">
              <button type="button" class="secondary popup-cancel">Cancel</button>
              <button type="button" class="popup-confirm mark-reviewed-confirm-btn">Mark reviewed</button>
            </div>
          </div>
        `;
        markReviewedConfirmEl.addEventListener("click", (e) => {
            if (e.target === markReviewedConfirmEl) closeMarkReviewedConfirmPopup();
        });
        document.body.appendChild(markReviewedConfirmEl);
    }
    const popup = markReviewedConfirmEl.querySelector(".mark-reviewed-confirm-popup");
    const cancelBtn = popup.querySelector(".popup-cancel");
    const confirmBtn = popup.querySelector(".mark-reviewed-confirm-btn");
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    const newCancel = popup.querySelector(".popup-cancel");
    const newConfirm = popup.querySelector(".mark-reviewed-confirm-btn");
    newCancel.addEventListener("click", () => closeMarkReviewedConfirmPopup());
    newConfirm.addEventListener("click", () => {
        closeMarkReviewedConfirmPopup();
        onConfirm();
    });
    markReviewedConfirmEl.classList.add("is-visible");
    requestAnimationFrame(() => {
        requestAnimationFrame(() => markReviewedConfirmEl.classList.add("is-open"));
    });
}

function closeMarkReviewedConfirmPopup() {
    if (!markReviewedConfirmEl) return;
    markReviewedConfirmEl.classList.remove("is-open");
    setTimeout(() => markReviewedConfirmEl.classList.remove("is-visible"), 320);
}

function bindDashboardActions() {
    const createListBtn = document.getElementById("createListBtn");
    if (createListBtn) {
        createListBtn.addEventListener("click", async () => {
            const name = document.getElementById("newListName").value.trim();
            if (!name) return;
            const created = await api.createList({ name });
            state.newListId = created?.id ?? null;
            await refreshAndRender();
        });
    }

    document.querySelectorAll("[data-list-open]").forEach((button) => {
        button.addEventListener("click", async () => {
            state.openedListFromMindMap = false;
            state.restoreMindMapFullscreen = false;
            const listId = Number(button.getAttribute("data-list-open"));
            state.selectedListId = listId;
            state.justOpenedListId = listId;
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
            state.justOpenedListId = listId;
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

    const globalSearchInput = document.getElementById("globalSearchInput");
    if (globalSearchInput) {
        globalSearchInput.addEventListener("input", () => {
            state.globalSearchQuery = globalSearchInput.value.trim();
            if (state.globalSearchDebounce) clearTimeout(state.globalSearchDebounce);
            if (!state.globalSearchQuery) {
                state.globalSearchResults = [];
                renderApp();
                return;
            }
            state.globalSearchDebounce = setTimeout(async () => {
                state.globalSearchDebounce = null;
                try {
                    state.globalSearchResults = await api.searchSentences(state.globalSearchQuery);
                } catch {
                    state.globalSearchResults = [];
                }
                renderApp();
            }, 300);
        });
    }
    document.querySelectorAll(".global-search-result-item").forEach((el) => {
        el.addEventListener("click", async () => {
            const listId = Number(el.getAttribute("data-search-list-id"));
            const sentenceId = Number(el.getAttribute("data-search-sentence-id"));
            if (!listId || !sentenceId) return;
            state.openedListFromMindMap = false;
            state.selectedListId = listId;
            state.selectedSentenceId = sentenceId;
            state.globalSearchQuery = "";
            state.globalSearchResults = [];
            await refreshAndRender();
        });
        el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                el.click();
            }
        });
    });

    const addSentenceBtn = document.getElementById("addSentenceBtn");
    if (addSentenceBtn) {
        addSentenceBtn.addEventListener("click", async () => {
            const inputEl = document.getElementById("newSentence");
            const content = (inputEl && inputEl.value) ? inputEl.value.trim() : "";
            if (!content) return;
            const rect = inputEl.getBoundingClientRect();
            const clone = document.createElement("div");
            clone.className = "sentence-morph-clone";
            clone.textContent = content;
            clone.style.left = `${rect.left}px`;
            clone.style.top = `${rect.top}px`;
            clone.style.width = `${rect.width}px`;
            clone.style.height = `${rect.height}px`;
            document.body.appendChild(clone);
            state.morphClone = clone;
            if (inputEl) {
                inputEl.value = "";
                inputEl.style.visibility = "hidden";
            }
            try {
                const created = await api.addSentence(state.selectedListId, { content });
                state.newSentenceId = created?.id ?? null;
                await refreshAndRender();
            } catch (err) {
                clone.remove();
                state.morphClone = null;
                if (inputEl) inputEl.style.visibility = "";
                const msg = err.responseData && Array.isArray(err.responseData.existingIn) && err.responseData.existingIn.length
                    ? "This sentence already exists in: " + err.responseData.existingIn.join(", ")
                    : (err.message || "Failed to add sentence");
                notify(msg);
            }
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

    document.querySelectorAll("[data-sentence-video]").forEach((button) => {
        button.addEventListener("click", () => sentenceVideo(Number(button.getAttribute("data-sentence-video"))));
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
    const useNaturalTtsInput = document.getElementById("useNaturalTtsInput");
    if (useNaturalTtsInput) {
        useNaturalTtsInput.addEventListener("change", () => {
            setUseNaturalTts(useNaturalTtsInput.checked);
        });
    }

    const enableReviewRemindersBtn = document.getElementById("enableReviewRemindersBtn");
    if (enableReviewRemindersBtn) {
        enableReviewRemindersBtn.addEventListener("click", () => requestReviewNotificationPermission());
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
    const scrollToY = window.scrollY;
    state.sentencesLoading = true;
    try {
        const data = await api.getSentencesPage(state.selectedListId, state.sentencesPage + 1, 20);
        const newItems = data.content || [];
        state.sentences = [...state.sentences, ...newItems];
        state.sentencesPage++;
        state.sentencesHasMore = data.hasMore === true;
        renderApp();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                window.scrollTo(0, scrollToY);
                state.sentencesLoading = false;
            });
        });
    } catch (e) {
        state.sentencesLoading = false;
        notify(e.message || "Failed to load more.");
    }
}

async function refreshAndRender() {
    try {
        await loadAppData();
        renderApp();
        showReviewDueNotificationIfNeeded();
    } catch (error) {
        notify(error.message);
    }
}

const MIND_MAP_CANVAS_WIDTH = 900;
const MIND_MAP_CANVAS_HEIGHT = 480;
const MIND_MAP_PAN_MARGIN = 60;
const MIND_MAP_PAN_RUBBER_BAND = 0.35;
const MIND_MAP_PAN_RUBBER_MAX_OVERFLOW = 80;
const MIND_MAP_PAN_INERTIA_FRICTION = 0.92;
const MIND_MAP_PAN_INERTIA_MIN_VELOCITY = 0.15;
const MIND_MAP_PAN_SNAPBACK_DURATION_MS = 280;
const MIND_MAP_BORDER_PADDING = 28;
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
    const maxListR = Math.max(36, ...listClusterRadii);
    const clusterDist = Math.max(34 * viewScale, 2 * maxListR + maxRadius * 2);

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

    const positions = getMindMapNodePositions(nodes, canvas.width, canvas.height);
    state.mindMapLastPositions = positions;

    let rawPanX = basePan.x + (state.mindMapUserPan?.x ?? 0);
    let rawPanY = basePan.y + (state.mindMapUserPan?.y ?? 0);
    let contentBounds = null;
    if (positions.length > 0) {
        if (state.mindMapCenterListId != null) {
            const listPositions = positions.filter((p) => p.node.listId === state.mindMapCenterListId);
            if (listPositions.length > 0) {
                const cx = listPositions.reduce((s, p) => s + p.x, 0) / listPositions.length;
                const cy = listPositions.reduce((s, p) => s + p.y, 0) / listPositions.length;
                rawPanX = cw / 2 - scale * cx;
                rawPanY = ch / 2 - scale * cy;
                state.mindMapUserPan = { x: rawPanX - basePan.x, y: rawPanY - basePan.y };
            }
            state.mindMapCenterListId = null;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        positions.forEach(({ node, x, y }) => {
            const r = getCircleRadius(node);
            minX = Math.min(minX, x - r);
            minY = Math.min(minY, y - r);
            maxX = Math.max(maxX, x + r);
            maxY = Math.max(maxY, y + r);
        });
        const pad = MIND_MAP_BORDER_PADDING;
        contentBounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
        const b = contentBounds;
        let panMinX = cw - scale * b.maxX;
        let panMaxX = -scale * b.minX;
        let panMinY = ch - scale * b.maxY;
        let panMaxY = -scale * b.minY;
        if (panMinX > panMaxX) {
            panMinX = panMaxX = (panMinX + panMaxX) / 2;
        }
        if (panMinY > panMaxY) {
            panMinY = panMaxY = (panMinY + panMaxY) / 2;
        }
        state.mindMapPanBounds = { panMinX, panMaxX, panMinY, panMaxY, basePan };
        const rubber = MIND_MAP_PAN_RUBBER_BAND;
        const overflowMax = MIND_MAP_PAN_RUBBER_MAX_OVERFLOW;
        let displayPanX = rawPanX;
        let displayPanY = rawPanY;
        const allowOverflow = state.mindMapPanning || state.mindMapInertialAnimating || state.mindMapSnapBackAnimating;
        if (state.mindMapPanning) {
            const now = performance.now();
            if (state.mindMapLastPanTime > 0 && (now - state.mindMapLastPanTime) > 0) {
                const dt = (now - state.mindMapLastPanTime) / 1000;
                const last = state.mindMapLastDisplayPan;
                if (last) {
                    state.mindMapPanVelocity.vx = (rawPanX - last.x) / dt;
                    state.mindMapPanVelocity.vy = (rawPanY - last.y) / dt;
                }
            }
            state.mindMapLastDisplayPan = { x: rawPanX, y: rawPanY };
            state.mindMapLastPanTime = now;
        }
        if (allowOverflow) {
            if (state.mindMapSnapBackAnimating) {
                displayPanX = Math.max(panMinX - overflowMax, Math.min(panMaxX + overflowMax, rawPanX));
                displayPanY = Math.max(panMinY - overflowMax, Math.min(panMaxY + overflowMax, rawPanY));
            } else {
                displayPanX = rawPanX > panMaxX ? panMaxX + (rawPanX - panMaxX) * rubber : rawPanX < panMinX ? panMinX + (rawPanX - panMinX) * rubber : rawPanX;
                displayPanY = rawPanY > panMaxY ? panMaxY + (rawPanY - panMaxY) * rubber : rawPanY < panMinY ? panMinY + (rawPanY - panMinY) * rubber : rawPanY;
                displayPanX = Math.max(panMinX - overflowMax, Math.min(panMaxX + overflowMax, displayPanX));
                displayPanY = Math.max(panMinY - overflowMax, Math.min(panMaxY + overflowMax, displayPanY));
            }
        } else {
            displayPanX = Math.max(panMinX, Math.min(panMaxX, displayPanX));
            displayPanY = Math.max(panMinY, Math.min(panMaxY, displayPanY));
        }
        if (!state.mindMapInertialAnimating && !state.mindMapSnapBackAnimating) {
            state.mindMapUserPan = { x: displayPanX - basePan.x, y: displayPanY - basePan.y };
        }
        rawPanX = displayPanX;
        rawPanY = displayPanY;
    }
    state.mindMapPan = { x: rawPanX, y: rawPanY };

    if (nodes.length === 0) {
        state.mindMapLastPositions = [];
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, state.mindMapPan.x, state.mindMapPan.y);

    const pan = state.mindMapPan;
    const viewportBounds = {
        minX: -pan.x / scale,
        minY: -pan.y / scale,
        maxX: (cw - pan.x) / scale,
        maxY: (ch - pan.y) / scale
    };
    const { minX, minY, maxX, maxY } = viewportBounds;
    const w = maxX - minX;
    const h = maxY - minY;
    const cornerRadius = Math.min(12, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(minX + cornerRadius, minY);
    ctx.lineTo(maxX - cornerRadius, minY);
    ctx.arc(maxX - cornerRadius, minY + cornerRadius, cornerRadius, -Math.PI / 2, 0);
    ctx.lineTo(maxX, maxY - cornerRadius);
    ctx.arc(maxX - cornerRadius, maxY - cornerRadius, cornerRadius, 0, Math.PI / 2);
    ctx.lineTo(minX + cornerRadius, maxY);
    ctx.arc(minX + cornerRadius, maxY - cornerRadius, cornerRadius, Math.PI / 2, Math.PI);
    ctx.lineTo(minX, minY + cornerRadius);
    ctx.arc(minX + cornerRadius, minY + cornerRadius, cornerRadius, Math.PI, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(168, 150, 255, 0.08)";
    ctx.fill();
    ctx.strokeStyle = "rgba(168, 150, 255, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();

    if (nodes.length === 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#586173";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Add sentences to your lists to see them here.", canvas.width / 2, canvas.height / 2);
        return;
    }

    const byListId = new Map();
    positions.forEach(({ node, x, y }) => {
        const listId = node.listId;
        if (!byListId.has(listId)) byListId.set(listId, []);
        byListId.get(listId).push({ node, x, y });
    });
    byListId.forEach((listNodes) => {
        listNodes.sort((a, b) => (a.node.index ?? 0) - (b.node.index ?? 0));
        ctx.strokeStyle = "rgba(168, 150, 255, 0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < listNodes.length - 1; k++) {
            const a = listNodes[k], b = listNodes[k + 1];
            const ra = getCircleRadius(a.node);
            const rb = getCircleRadius(b.node);
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 1e-6) continue;
            const ux = dx / dist;
            const uy = dy / dist;
            ctx.moveTo(a.x + ra * ux, a.y + ra * uy);
            ctx.lineTo(b.x - rb * ux, b.y - rb * uy);
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
    const nodes = (data && data.nodes) ? data.nodes : [];
    const listIdsWithNodes = [...new Set(nodes.map((n) => n.listId).filter(Boolean))];
    state.mindMapCenterListId =
        (state.selectedListId && listIdsWithNodes.includes(state.selectedListId) ? state.selectedListId : null) ||
        (listIdsWithNodes.length > 0 ? listIdsWithNodes[0] : null);

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
                const listId = node.listId != null ? node.listId : state.selectedListId;
                state.selectedListId = listId;
                state.justOpenedListId = listId;
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

    function startSnapBackToBounds() {
        const bounds = state.mindMapPanBounds;
        if (!bounds) return;
        const { panMinX, panMaxX, panMinY, panMaxY, basePan } = bounds;
        const panX = basePan.x + state.mindMapUserPan.x;
        const panY = basePan.y + state.mindMapUserPan.y;
        const targetX = Math.max(panMinX, Math.min(panMaxX, panX));
        const targetY = Math.max(panMinY, Math.min(panMaxY, panY));
        if (Math.abs(panX - targetX) < 0.5 && Math.abs(panY - targetY) < 0.5) {
            state.mindMapUserPan = { x: targetX - basePan.x, y: targetY - basePan.y };
            redrawMindMapCanvas();
            return;
        }
        state.mindMapSnapBackAnimating = true;
        state.mindMapSnapBackData = {
            startX: panX, startY: panY,
            targetX, targetY,
            startTime: performance.now(),
            duration: MIND_MAP_PAN_SNAPBACK_DURATION_MS,
            basePan
        };
        state.mindMapSnapBackRAF = requestAnimationFrame(runSnapBack);
    }

    function runSnapBack() {
        const data = state.mindMapSnapBackData;
        if (!data) {
            state.mindMapSnapBackAnimating = false;
            state.mindMapSnapBackRAF = null;
            return;
        }
        const { startX, startY, targetX, targetY, startTime, duration, basePan } = data;
        const now = performance.now();
        let t = (now - startTime) / duration;
        if (t >= 1) {
            state.mindMapUserPan = { x: targetX - basePan.x, y: targetY - basePan.y };
            state.mindMapSnapBackAnimating = false;
            state.mindMapSnapBackData = null;
            state.mindMapSnapBackRAF = null;
            redrawMindMapCanvas();
            return;
        }
        const ease = 1 - (1 - t) * (1 - t);
        const panX = startX + (targetX - startX) * ease;
        const panY = startY + (targetY - startY) * ease;
        state.mindMapUserPan = { x: panX - basePan.x, y: panY - basePan.y };
        redrawMindMapCanvas();
        state.mindMapSnapBackRAF = requestAnimationFrame(runSnapBack);
    }

    function runInertialPan() {
        const bounds = state.mindMapPanBounds;
        if (!bounds) return;
        const { panMinX, panMaxX, panMinY, panMaxY, basePan } = bounds;
        let { vx, vy } = state.mindMapPanVelocity;
        let panX = basePan.x + state.mindMapUserPan.x;
        let panY = basePan.y + state.mindMapUserPan.y;
        const now = performance.now();
        const dt = Math.min((now - (state.mindMapLastPanTime || now)) / 1000, 0.05) || 0.016;
        state.mindMapLastPanTime = now;
        panX += vx * dt;
        panY += vy * dt;
        vx *= MIND_MAP_PAN_INERTIA_FRICTION;
        vy *= MIND_MAP_PAN_INERTIA_FRICTION;
        state.mindMapPanVelocity = { vx, vy };
        state.mindMapUserPan = { x: panX - basePan.x, y: panY - basePan.y };
        redrawMindMapCanvas();
        const stillMoving = Math.abs(vx) > MIND_MAP_PAN_INERTIA_MIN_VELOCITY || Math.abs(vy) > MIND_MAP_PAN_INERTIA_MIN_VELOCITY;
        if (stillMoving) {
            state.mindMapInertialRAF = requestAnimationFrame(runInertialPan);
        } else {
            state.mindMapInertialAnimating = false;
            state.mindMapPanVelocity = { vx: 0, vy: 0 };
            state.mindMapLastPanTime = 0;
            state.mindMapInertialRAF = null;
            startSnapBackToBounds();
        }
    }

    function startMapPan(clientX, clientY) {
        if (state.mindMapInertialRAF != null) {
            cancelAnimationFrame(state.mindMapInertialRAF);
            state.mindMapInertialRAF = null;
            state.mindMapInertialAnimating = false;
        }
        if (state.mindMapSnapBackRAF != null) {
            cancelAnimationFrame(state.mindMapSnapBackRAF);
            state.mindMapSnapBackRAF = null;
            state.mindMapSnapBackAnimating = false;
            state.mindMapSnapBackData = null;
        }
        state.mindMapPanning = true;
        state.mindMapLastPanTime = 0;
        const startClientX = clientX;
        const startClientY = clientY;
        const startUserPan = { x: state.mindMapUserPan.x, y: state.mindMapUserPan.y };

        const moveHandler = (e2) => {
            if (e2.touches && e2.touches.length >= 2) return;
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
            const v = state.mindMapPanVelocity;
            const hasVelocity = Math.abs(v.vx) > MIND_MAP_PAN_INERTIA_MIN_VELOCITY || Math.abs(v.vy) > MIND_MAP_PAN_INERTIA_MIN_VELOCITY;
            if (hasVelocity && state.mindMapPanBounds) {
                state.mindMapInertialAnimating = true;
                state.mindMapLastPanTime = performance.now();
                state.mindMapInertialRAF = requestAnimationFrame(runInertialPan);
            } else {
                state.mindMapLastPanTime = 0;
                state.mindMapPanVelocity = { vx: 0, vy: 0 };
                startSnapBackToBounds();
            }
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
        if (e.touches.length === 2) {
            e.preventDefault();
            state.mindMapPinching = true;
            state.mindMapPinchStartDistance = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
            state.mindMapPinchStartScale = state.mindMapScale;
            return;
        }
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

    canvas.addEventListener("touchmove", (e) => {
        if (e.touches.length !== 2) return;
        if (!state.mindMapPinching) {
            state.mindMapPinching = true;
            state.mindMapPinchStartDistance = Math.hypot(
                e.touches[1].clientX - e.touches[0].clientX,
                e.touches[1].clientY - e.touches[0].clientY
            );
            state.mindMapPinchStartScale = state.mindMapScale;
        }
        e.preventDefault();
        const dist = Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY
        );
        if (state.mindMapPinchStartDistance > 1) {
            const scale = state.mindMapPinchStartScale * (dist / state.mindMapPinchStartDistance);
            setZoom(scale);
        }
    }, { passive: false, capture: true });

    canvas.addEventListener("touchend", (e) => {
        if (e.touches.length < 2) {
            state.mindMapPinching = false;
        }
    }, { passive: true });

    canvas.addEventListener("touchcancel", (e) => {
        if (e.touches.length < 2) {
            state.mindMapPinching = false;
        }
    }, { passive: true });

    canvas.addEventListener("click", (e) => {
        if (state.draggingNodeId != null) return;
        if (state.mindMapJustDragged) {
            state.mindMapJustDragged = false;
            return;
        }
        const { x, y } = canvasCoords(canvas, e.clientX, e.clientY);
        const node = hitTestNode(x, y);
        if (!node) return;
        const listId = node.listId != null ? node.listId : state.selectedListId;
        state.selectedListId = listId;
        state.justOpenedListId = listId;
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
