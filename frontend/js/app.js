import { api } from "./api.js?v=2";
import { speak, preload as preloadTTS, getUseNaturalTts, setUseNaturalTts, setTtsLanguage, getNaturalTtsHint, applyDefaultNaturalTtsForLanguage } from "./tts.js";
import { getSpeechLocale, normalizeAppLanguage, getLanguageConfig, languagePickerHtml, bindLanguagePicker, getLanguagePickerValue } from "./language.js";

/** Mind map UI disabled until feature is ready. */
const MIND_MAP_ENABLED = false;

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
    minimizedSessionId: null,
    minimizedSession: null,
    restoringMinimizedSession: false,
    selectedSentenceId: null,
    mindMapData: null,
    mindMapPositions: {},
    mindMapLastPositions: null,
    draggingNodeId: null,
    mindMapJustDragged: false,
    currentSection: 0,
    listSearchQuery: "",
    listsFilterQuery: "",
    globalSearchQuery: "",
    globalSearchResults: [],
    globalSearchDebounce: null,
    globalSearchLoading: false,
    globalSearchRequestId: 0,
    statsOverview: null,
    statsLoading: false,
    statsError: null,
    excludedSentences: null,
    excludedLoading: false,
    excludedError: null,
    sentenceStatsLoadingId: null,
    voiceAttemptCountBySentenceId: {},
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
    openMeaningGroupId: null,
    meaningGroupMeta: null,
    meaningGroupSentences: [],
    openMeaningGroupFromSentenceId: null,
    justOpenedMeaningGroup: null,
    groupSearchQuery: "",
    newGroupLinkedSentenceId: null,
    mindMapInertialRAF: null,
    mindMapSnapBackAnimating: false,
    mindMapSnapBackRAF: null,
    mindMapSnapBackData: null,
    mindMapPinching: false,
    mindMapPinchStartDistance: 0,
    mindMapPinchStartScale: 1,
    /** @type {{ [idx: number]: number }} stage 1=full, 2=verbs hidden, 3=all hidden */
    reviewSpeakCheckStage: {},
    /** @type {{ [idx: number]: number }} current sentence/clause part inside a review item */
    reviewSpeakCheckPart: {},
    /** @type {{ [idx: number]: boolean }} */
    reviewCompletedItems: {},
    /** @type {{ [sessionId: string]: { stages: { [idx: number]: number }, parts: { [idx: number]: number }, completed: { [idx: number]: boolean } } }} */
    reviewSessionProgressById: {},
    testReviewStage: 1,
    testReviewPart: 0,
    /** 'forgot' | 'signup-language' | 'signup-credentials' | null when on auth screen */
    authView: null,
    authMessage: null,
    /** Language chosen during sign-up before account creation. */
    authSignupLanguage: null
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

function getAppLanguage() {
    return normalizeAppLanguage(state.user?.language || state.settings?.language || "en");
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

function isWeeklyCatchUpSession(session) {
    return session?.kind === "WEEKLY_CATCH_UP";
}

function isInitialReviewSession(session) {
    return session?.kind === "INITIAL";
}

function reviewSessionTitle(session) {
    if (isInitialReviewSession(session)) return "Initial review";
    if (isWeeklyCatchUpSession(session)) return "Weekly catch-up review";
    return "Review session";
}

function reviewSessionDescription(session) {
    if (isInitialReviewSession(session)) return "New sentences that have not been reviewed yet.";
    if (isWeeklyCatchUpSession(session)) return "Weekly catch-up reminder session.";
    return "Scheduled review session.";
}

function reviewSessionOpenLabel(session) {
    if (isInitialReviewSession(session)) return "Open initial";
    if (isWeeklyCatchUpSession(session)) return "Open catch-up";
    return "Open";
}

function getWeeklyCatchUpPendingSession() {
    return (state.pendingSessions || []).find((session) => isWeeklyCatchUpSession(session)) || null;
}

function createReviewSessionProgress(session) {
    const itemCount = session?.items?.length ?? 0;
    const stages = {};
    for (let idx = 0; idx < itemCount; idx++) {
        stages[idx] = 1;
    }
    return { stages, parts: {}, completed: {} };
}

function normalizeReviewSessionProgress(progress, itemCount) {
    if (!progress || itemCount < 0) return;
    if (!progress.parts) progress.parts = {};
    for (let idx = 0; idx < itemCount; idx++) {
        if (progress.stages[idx] == null) progress.stages[idx] = 1;
        if (progress.parts[idx] == null) progress.parts[idx] = 0;
    }
    Object.keys(progress.stages).forEach((key) => {
        const idx = Number(key);
        if (Number.isNaN(idx) || idx >= itemCount) delete progress.stages[key];
    });
    Object.keys(progress.parts).forEach((key) => {
        const idx = Number(key);
        if (Number.isNaN(idx) || idx >= itemCount) delete progress.parts[key];
    });
    Object.keys(progress.completed).forEach((key) => {
        const idx = Number(key);
        if (Number.isNaN(idx) || idx >= itemCount) delete progress.completed[key];
    });
}

function getOrCreateReviewSessionProgress(session) {
    if (!session?.id) return createReviewSessionProgress(session);
    const key = String(session.id);
    let progress = state.reviewSessionProgressById[key];
    if (!progress) {
        progress = createReviewSessionProgress(session);
        state.reviewSessionProgressById[key] = progress;
    }
    normalizeReviewSessionProgress(progress, session?.items?.length ?? 0);
    return progress;
}

function loadReviewSessionProgress(session) {
    const progress = getOrCreateReviewSessionProgress(session);
    state.reviewSpeakCheckStage = progress.stages;
    state.reviewSpeakCheckPart = progress.parts;
    state.reviewCompletedItems = progress.completed;
}

function clearReviewSessionProgress(sessionId) {
    if (sessionId == null) return;
    delete state.reviewSessionProgressById[String(sessionId)];
}

function rehydrateReviewSessionProgressUi(session) {
    const count = session?.items?.length ?? 0;
    for (let idx = 0; idx < count; idx++) {
        const li = document.querySelector(`.review-sentence-item[data-review-idx="${idx}"]`);
        if (li) li.classList.toggle("review-sentence-item-completed", !!state.reviewCompletedItems[idx]);
        updateReviewItemStageDisplay(session, idx);
    }
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

// Plain alphanumeric on purpose: compromise's serializer treats braces as
// bracket punctuation and reshuffles them relative to neighboring sentence
// punctuation (e.g. "{{HIDDEN}}?" -> "{{HIDDEN?}}", sometimes losing a
// brace entirely), which left the literal placeholder text on screen
// whenever a hidden verb sat next to punctuation like . ? ; : ,
const HIDDEN_PLACEHOLDER = "ZZZHIDDENZZZ";

/** One blank per word for "all hidden" stage (returns text with placeholders). */
function getSentenceWithAllHidden(text) {
    if (!text || typeof text !== "string") return "";
    return text.replace(/\w+(?:(?:'|-)\w+)*/g, HIDDEN_PLACEHOLDER);
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
const HIDDEN_MARKER_REGEX = new RegExp(HIDDEN_PLACEHOLDER, "g");

function renderHiddenReviewText(masked) {
    return escapeHtml(masked).replace(HIDDEN_MARKER_REGEX, HIDDEN_WORD_HTML);
}

/** Get display content for review sentence by stage (1=full, 2=verbs hidden, 3=all hidden). */
async function getReviewSentenceDisplay(content, stage) {
    if (stage === 1) return renderSentenceWithWordLinks(content);
    if (stage === 2) {
        const masked = await getSentenceWithVerbsHidden(content);
        return renderHiddenReviewText(masked);
    }
    const masked = getSentenceWithAllHidden(content);
    return renderHiddenReviewText(masked);
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

function buildListsListItemsHtml() {
    const q = (state.listsFilterQuery || "").trim().toLowerCase();
    const filtered = q ? state.lists.filter((l) => (l.name || "").toLowerCase().includes(q)) : state.lists;
    if (filtered.length === 0) {
        return q
            ? `<li class="lists-empty hint" aria-live="polite">No lists match “${escapeHtml(state.listsFilterQuery.trim())}”</li>`
            : "";
    }
    return filtered.map((list) => html`
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
    `).join("");
}

function bindListItemActions() {
    document.querySelectorAll("[data-list-open]").forEach((button) => {
        button.addEventListener("click", async () => {
            state.openedListFromMindMap = false;
            state.restoreMindMapFullscreen = false;
            const listId = Number(button.getAttribute("data-list-open"));
            state.selectedListId = listId;
            state.justOpenedListId = listId;
            await refreshAndRender({ includePendingReviews: false });
            scrollWindowToTop();
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
            await refreshAndRender({ includePendingReviews: false });
            scrollWindowToTop();
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
}

const GLOBAL_SEARCH_DEBOUNCE_MS = 200;

function buildGlobalSearchResultsHtml() {
    const q = (state.globalSearchQuery || "").trim();
    if (!q) return "";
    if (state.globalSearchLoading) {
        return `<div class="hint global-search-status" aria-live="polite">Searching…</div>`;
    }
    const results = state.globalSearchResults || [];
    if (!results.length) {
        return `<div class="hint global-search-status" aria-live="polite">No results</div>`;
    }
    return html`
      <div class="hint">${results.length} result${results.length === 1 ? "" : "s"}</div>
      <ul class="global-search-result-list">
        ${results.map((r) => html`
          <li class="global-search-result-item" data-search-list-id="${r.listId}" data-search-sentence-id="${r.id}" role="button" tabindex="0">
            <div class="global-search-result-content">${renderSentenceWithWordLinks(r.content)}</div>
            <div class="hint">in ${escapeHtml(r.listName || "")}${(r.reviewCount != null && r.reviewCount > 0) ? ` · Reviewed ${r.reviewCount} time${r.reviewCount === 1 ? "" : "s"}` : ""}</div>
          </li>
        `).join("")}
      </ul>
    `;
}

function syncGlobalSearchResultsDom() {
    const container = document.getElementById("globalSearchResults");
    if (!container) return;
    const q = (state.globalSearchQuery || "").trim();
    const show = q.length > 0;
    container.hidden = !show;
    container.setAttribute("aria-busy", state.globalSearchLoading ? "true" : "false");
    container.innerHTML = show ? buildGlobalSearchResultsHtml() : "";
}

function handleGlobalSearchInput(inputEl) {
    state.globalSearchQuery = inputEl.value;
    const q = state.globalSearchQuery.trim();
    if (state.globalSearchDebounce) clearTimeout(state.globalSearchDebounce);
    if (!q) {
        state.globalSearchResults = [];
        state.globalSearchLoading = false;
        state.globalSearchRequestId += 1;
        syncGlobalSearchResultsDom();
        return;
    }
    state.globalSearchLoading = true;
    syncGlobalSearchResultsDom();
    state.globalSearchDebounce = setTimeout(async () => {
        state.globalSearchDebounce = null;
        const requestId = ++state.globalSearchRequestId;
        const queryAtFetch = q;
        try {
            const results = await api.searchSentences(queryAtFetch);
            if (requestId !== state.globalSearchRequestId) return;
            if ((state.globalSearchQuery || "").trim() !== queryAtFetch) return;
            state.globalSearchResults = results;
        } catch {
            if (requestId !== state.globalSearchRequestId) return;
            state.globalSearchResults = [];
        } finally {
            if (requestId === state.globalSearchRequestId) {
                state.globalSearchLoading = false;
                syncGlobalSearchResultsDom();
            }
        }
    }, GLOBAL_SEARCH_DEBOUNCE_MS);
}

async function openGlobalSearchResult(listId, sentenceId) {
    if (!listId || !sentenceId) return;
    state.openedListFromMindMap = false;
    state.selectedListId = listId;
    state.selectedSentenceId = sentenceId;
    state.globalSearchQuery = "";
    state.globalSearchResults = [];
    state.globalSearchLoading = false;
    state.globalSearchRequestId += 1;
    if (state.globalSearchDebounce) {
        clearTimeout(state.globalSearchDebounce);
        state.globalSearchDebounce = null;
    }
    await refreshAndRender();
    await scrollToSentence(sentenceId);
}

async function bootstrap() {
    appEl.addEventListener("input", (e) => {
        if (e.target.id !== "globalSearchInput") return;
        handleGlobalSearchInput(e.target);
    });
    appEl.addEventListener("click", (e) => {
        const item = e.target.closest(".global-search-result-item");
        if (!item) return;
        const listId = Number(item.getAttribute("data-search-list-id"));
        const sentenceId = Number(item.getAttribute("data-search-sentence-id"));
        openGlobalSearchResult(listId, sentenceId);
    });
    appEl.addEventListener("keydown", (e) => {
        const item = e.target.closest(".global-search-result-item");
        if (!item || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        const listId = Number(item.getAttribute("data-search-list-id"));
        const sentenceId = Number(item.getAttribute("data-search-sentence-id"));
        openGlobalSearchResult(listId, sentenceId);
    });

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
        setTtsLanguage(getAppLanguage());
        applyDefaultNaturalTtsForLanguage(getAppLanguage());
        await loadAppData({ refreshReviewSessions: true });
        renderApp();
        showReviewDueNotificationIfNeeded();
        // Preload natural TTS only if user has enabled it
        if (getUseNaturalTts()) setTimeout(() => preloadTTS(getAppLanguage()), 1500);
    } catch (_error) {
        renderAuth();
    }
}

async function loadMeaningGroupData(groupId) {
    const [meta, sentences] = await Promise.all([
        api.getMeaningGroup(groupId),
        api.getMeaningGroupSentences(groupId)
    ]);
    state.meaningGroupMeta = meta;
    state.meaningGroupSentences = sentences || [];
}

function getListNameById(listId) {
    const list = state.lists.find((l) => l.id === listId);
    return list ? list.name : "";
}

function getSentenceListTitle(sentence) {
    if (!sentence) return "";
    return sentence.listName || getListNameById(sentence.listId) || "";
}

function findSentenceById(id) {
    const fromList = state.sentences.find((s) => s.id === id);
    if (fromList) return fromList;
    const fromGroup = (state.meaningGroupSentences || []).find((s) => s.id === id);
    if (fromGroup) return fromGroup;
    return (state.excludedSentences || []).find((s) => s.id === id) || null;
}

function scrollWindowToTop() {
    const detail = document.querySelector(".dashboard-group-detail, .dashboard-list-detail");
    if (detail) detail.scrollIntoView({ block: "start", inline: "nearest" });

    const root = document.scrollingElement || document.documentElement;
    const applyTopScroll = () => {
        window.scrollTo(0, 0);
        if (root) root.scrollTop = 0;
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    };

    applyTopScroll();
    requestAnimationFrame(() => requestAnimationFrame(applyTopScroll));
    setTimeout(applyTopScroll, 0);
    setTimeout(applyTopScroll, 60);
}

async function openMeaningGroupForSentence(sentenceId) {
    let sentence = findSentenceById(sentenceId);
    if (!sentence) return;

    try {
        let groupId = sentence.meaningGroupId;
        if (!groupId) {
            const group = await api.createMeaningGroup({ label: null, notes: null });
            const updated = await api.assignSentenceToMeaningGroup(sentenceId, { groupId: group.id });
            groupId = group.id;
            const idx = state.sentences.findIndex((s) => s.id === sentenceId);
            if (idx >= 0) state.sentences[idx] = updated;
            sentence = updated;
        }

        const openGroupView = async () => {
            state.openMeaningGroupId = groupId;
            state.openMeaningGroupFromSentenceId = sentenceId;
            state.justOpenedMeaningGroup = groupId;
            state.groupSearchQuery = "";
            await loadMeaningGroupData(groupId);
            renderApp();
            scrollWindowToTop();
        };

        if (state.openMeaningGroupId === groupId) {
            state.openMeaningGroupFromSentenceId = sentenceId;
            await loadMeaningGroupData(groupId);
            renderApp();
            return;
        }

        if (state.openMeaningGroupId && state.openMeaningGroupId !== groupId) {
            animateCloseGroupDetailThen(openGroupView);
            return;
        }

        if (state.selectedListId && !state.openMeaningGroupId) {
            animateCloseListDetailThen(openGroupView);
            return;
        }

        await openGroupView();
    } catch (err) {
        notify(err.message || "Failed to open meaning group.");
    }
}

function navigateBackFromGroup() {
    state.openMeaningGroupId = null;
    state.meaningGroupMeta = null;
    state.meaningGroupSentences = [];
    state.openMeaningGroupFromSentenceId = null;
    state.justOpenedMeaningGroup = null;
    state.groupSearchQuery = "";
}

async function navigateBackFromGroupAndRefresh() {
    const listId = state.selectedListId;
    navigateBackFromGroup();
    state.justOpenedListId = listId;
    await loadAppData({ includePendingReviews: false });
    renderApp();
}

function updateSentenceInState(updated) {
    if (!updated?.id) return;
    const listIdx = state.sentences.findIndex((s) => s.id === updated.id);
    if (listIdx >= 0) state.sentences[listIdx] = updated;
    const groupIdx = (state.meaningGroupSentences || []).findIndex((s) => s.id === updated.id);
    if (groupIdx >= 0) state.meaningGroupSentences[groupIdx] = updated;
}

function animateSentenceItemRemoval(sentenceId, { removalClass = "is-completing", onRemoved } = {}) {
    const card = document.querySelector(`.sentence-item[data-sentence-id="${sentenceId}"]`);
    if (!card) {
        onRemoved?.();
        return;
    }
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        if (card.isConnected) card.remove();
        onRemoved?.();
    };
    card.classList.add(removalClass);
    const onEnd = (e) => {
        if (e.target !== card || e.propertyName !== "max-height") return;
        card.removeEventListener("transitionend", onEnd);
        finish();
    };
    card.addEventListener("transitionend", onEnd);
    setTimeout(finish, 450);
}

function clearSentenceMeaningGroupInState(sentenceId) {
    const patch = (s) => ({
        ...s,
        meaningGroupId: null,
        meaningGroupLabel: null,
        variantCount: 0
    });
    const listIdx = state.sentences.findIndex((s) => s.id === sentenceId);
    if (listIdx >= 0) state.sentences[listIdx] = patch(state.sentences[listIdx]);
    const groupIdx = (state.meaningGroupSentences || []).findIndex((s) => s.id === sentenceId);
    if (groupIdx >= 0) state.meaningGroupSentences[groupIdx] = patch(state.meaningGroupSentences[groupIdx]);
}

async function linkSentenceToOpenGroup(sentenceId) {
    if (!state.openMeaningGroupId || !sentenceId) return;
    const alreadyLinked = (state.meaningGroupSentences || []).some((s) => s.id === sentenceId);
    if (alreadyLinked) return;

    try {
        const updated = await api.assignSentenceToMeaningGroup(sentenceId, { groupId: state.openMeaningGroupId });
        updateSentenceInState(updated);
        await loadMeaningGroupData(state.openMeaningGroupId);
        if (state.selectedListId) {
            const data = await api.getSentencesPage(state.selectedListId, 0, 20);
            state.sentences = data.content || [];
        }
        state.newGroupLinkedSentenceId = sentenceId;
        renderApp();
    } catch (err) {
        notify(err.message || "Failed to link sentence to group.");
    }
}

async function unlinkSentenceFromGroup(sentenceId) {
    if (!sentenceId) return;

    try {
        const updated = await api.unassignSentenceFromMeaningGroup(sentenceId);
        updateSentenceInState(updated);
        clearSentenceMeaningGroupInState(sentenceId);

        const finishUnlink = async () => {
            if (state.openMeaningGroupId) {
                await loadMeaningGroupData(state.openMeaningGroupId);
            }
            state.meaningGroupSentences = (state.meaningGroupSentences || []).filter((s) => s.id !== sentenceId);
            if (state.openMeaningGroupFromSentenceId === sentenceId) {
                state.openMeaningGroupFromSentenceId = null;
            }
            if (state.selectedListId) {
                const data = await api.getSentencesPage(state.selectedListId, 0, 20);
                state.sentences = data.content || [];
            }
            if ((state.meaningGroupSentences || []).length === 0 && state.openMeaningGroupId) {
                navigateBackFromGroup();
            }
            renderApp();
        };

        const inGroupView = !!state.openMeaningGroupId;
        const card = document.querySelector(`.sentence-item[data-sentence-id="${sentenceId}"]`);

        if (inGroupView && card) {
            animateSentenceItemRemoval(sentenceId, {
                removalClass: "is-group-removing",
                onRemoved: () => { finishUnlink(); }
            });
        } else {
            await finishUnlink();
        }
    } catch (err) {
        notify(err.message || "Failed to unlink sentence from group.");
    }
}

function getMeaningGroupTintClass(groupId) {
    if (groupId == null || groupId === "") return "";
    const idx = Math.abs(Number(groupId)) % 6;
    return `meaning-group-tint-${idx}`;
}

function renderSentenceActionsHtml(sentence, options = {}) {
    const { inGroupView = false } = options;
    const variantHint = (sentence.variantCount != null && sentence.variantCount > 1)
        ? ` (${sentence.variantCount} variants)`
        : "";
    const showUnlink = inGroupView || !!sentence.meaningGroupId;
    return html`
      <div class="sentence-actions-main">
        <button type="button" data-sentence-speak="${sentence.id}" class="btn-icon secondary" title="Listen">🔊</button>
        <button type="button" data-sentence-playphrase="${sentence.id}" class="btn-icon secondary" title="Play phrase (playphrase.me)">▶️</button>
        <button type="button" data-sentence-youglish="${sentence.id}" class="btn-icon secondary" title="Pronounce (YouGlish)">🔤</button>
        <button type="button" data-sentence-test-review="${sentence.id}" class="btn-icon secondary" title="Test review">📋</button>
        <button type="button" data-sentence-naturalness="${sentence.id}" class="btn-icon secondary" title="AI naturalness check">✨</button>
        <button type="button" data-sentence-stats="${sentence.id}" class="btn-icon secondary" title="Stats">📈</button>
        <button type="button" data-sentence-group="${sentence.id}" class="btn-icon secondary" title="Open same meaning group${variantHint}">🔗</button>
        <button type="button" data-sentence-edit="${sentence.id}" class="btn-icon secondary" title="Edit">✏️</button>
        <button type="button" data-sentence-video="${sentence.id}" class="btn-icon secondary" title="Video links">🎬</button>
        <button type="button" data-sentence-schedule="${sentence.id}" class="btn-icon secondary" title="Schedule">📅</button>
        <button type="button" data-sentence-toggle-excluded="${sentence.id}" class="btn-icon secondary" title="${sentence.excludedFromSchedule ? "Include in schedule" : "Exclude from schedule (memorized)"}">${sentence.excludedFromSchedule ? "✅" : "🚫"}</button>
        <button type="button" data-sentence-move="${sentence.id}" class="btn-icon secondary" title="Move">➡️</button>
        <button type="button" data-sentence-delete="${sentence.id}" class="btn-icon danger" title="Delete">🗑️</button>
      </div>
      ${showUnlink ? html`
        <button type="button" data-sentence-unlink="${sentence.id}" class="btn-icon secondary sentence-unlink-btn" title="Unlink from group">🔓</button>
      ` : ""}
    `;
}

function renderSentenceItemHtml(sentence, options = {}) {
    const { highlighted = false, showListName = false, inGroupView = false } = options;
    const listMeta = showListName
        ? ` · in ${escapeHtml(getListNameById(sentence.listId))}`
        : "";
    const reviewMeta = (sentence.reviewCount != null && sentence.reviewCount > 0)
        ? ` · Reviewed ${sentence.reviewCount} time${sentence.reviewCount === 1 ? "" : "s"}`
        : "";
    const groupTintClass = getMeaningGroupTintClass(sentence.meaningGroupId);
    const excludedBadge = sentence.excludedFromSchedule
        ? html`<span class="excluded-from-schedule-badge" title="Excluded from schedule">🚫 Excluded</span>`
        : "";
    return html`
      <li class="sentence-item ${highlighted ? "selected" : ""} ${groupTintClass} ${sentence.excludedFromSchedule ? "is-excluded-from-schedule" : ""}" data-sentence-id="${sentence.id}">
        <div class="sentence-item-content" data-sentence-select="${sentence.id}">${renderSentenceWithWordLinks(sentence.content)}${excludedBadge}</div>
        <div class="hint sentence-item-meta">${new Date(sentence.createdAt).toLocaleString()}${listMeta}${reviewMeta}</div>
        <div class="row sentence-actions">
          ${renderSentenceActionsHtml(sentence, { inGroupView })}
        </div>
      </li>
    `;
}

function buildMeaningGroupDetailHtml() {
    const meta = state.meaningGroupMeta || {};
    const title = (meta.label && String(meta.label).trim())
        ? escapeHtml(meta.label)
        : "Same meaning group";
    const q = (state.groupSearchQuery || "").trim().toLowerCase();
    const sentences = (state.meaningGroupSentences || []).filter((s) => {
        if (!q) return true;
        return (s.content || "").toLowerCase().includes(q);
    });
    const variantCount = Number(meta.sentenceCount) || (state.meaningGroupSentences || []).length;
    const groupMemberIds = new Set((state.meaningGroupSentences || []).map((s) => s.id));
    const linkableSentences = (state.sentences || []).filter((s) => !groupMemberIds.has(s.id));

    return html`
      <div class="dashboard-group-detail card">
        <button type="button" id="showListFromGroupBtn" class="show-lists-btn secondary">← List</button>
        <h2 class="dashboard-content-title">${title}</h2>
        <div class="row list-search-row">
          <input id="groupSearchInput" type="search" class="input-soft" placeholder="Search in group…" value="${escapeHtml(state.groupSearchQuery || "")}" autocomplete="off" />
        </div>
        <div class="row group-link-row">
          <select id="groupLinkSentenceSelect" class="input-soft" ${linkableSentences.length === 0 ? "disabled" : ""}>
            <option value="">Link sentence from this list…</option>
            ${linkableSentences.map((s) => html`
              <option value="${s.id}">${escapeHtml((s.content || "").slice(0, 80))}${(s.content || "").length > 80 ? "…" : ""}</option>
            `).join("")}
          </select>
          <button type="button" id="groupLinkSentenceBtn" ${linkableSentences.length === 0 ? "disabled" : ""}>Link</button>
        </div>
        <div class="hint">${variantCount} expression${variantCount === 1 ? "" : "s"} with the same meaning.</div>
        <ul class="sentence-list ${getMeaningGroupTintClass(state.openMeaningGroupId)} meaning-group-sentence-list">
          ${sentences.map((sentence) => renderSentenceItemHtml(sentence, {
              highlighted: sentence.id === state.openMeaningGroupFromSentenceId,
              showListName: true,
              inGroupView: true
          })).join("")}
        </ul>
        ${sentences.length === 0 ? html`<div class="hint">No matching expressions.</div>` : ""}
      </div>
    `;
}

async function loadAppData(options = {}) {
    const { refreshReviewSessions = false } = options;
    state.excludedSentences = null;
    state.lists = await api.getLists();
    if (refreshReviewSessions) {
        await api.refreshReviewSessions();
    }
    const { includePendingReviews = true } = options;
    if (includePendingReviews) {
        state.pendingSessions = await api.getPendingReviews();
    }
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
    if (state.openMeaningGroupId) {
        await loadMeaningGroupData(state.openMeaningGroupId);
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
    const sentence = findSentenceById(id);
    if (!sentence || !sentence.content) return;
    const itemEl = document.querySelector(`.sentence-item[data-sentence-id="${id}"]`);
    showTtsProgressOnItem(itemEl);
    try {
        await speak(sentence.content, getAppLanguage());
    } finally {
        hideTtsProgressOnItem(itemEl);
    }
}

async function sentenceEdit(id) {
    const sentence = findSentenceById(id);
    if (!sentence) return;
    showSentenceActionPopup("edit", id, sentence);
}

async function sentenceDelete(id) {
    showSentenceActionPopup("delete", id);
}

async function sentenceMove(id) {
    showSentenceActionPopup("move", id);
}

function sentenceUnlink(id) {
    showSentenceActionPopup("unlink", id);
}

async function sentenceSchedule(id) {
    const schedule = await api.getSchedule(id);
    showSentenceActionPopup("schedule", id, schedule);
}

async function sentenceToggleExcluded(id) {
    const sentence = findSentenceById(id);
    if (!sentence) return;
    try {
        const updated = sentence.excludedFromSchedule
            ? await api.includeSentenceInSchedule(id)
            : await api.excludeSentenceFromSchedule(id);
        sentence.excludedFromSchedule = updated.excludedFromSchedule;
    } catch (e) {
        notify(e.message || "Failed to update schedule exclusion.");
        return;
    }
    state.excludedSentences = null;
    await refreshAndRender();
    if (!state.selectedListId && state.currentSection === 5) {
        await ensureExcludedSentencesLoaded(true);
    }
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
        const result = await api.checkGrammar(sentence.content, getAppLanguage());
        showGrammarResultPopup(!!result.correct, result.feedback || "");
    } catch (e) {
        showGrammarResultPopup(false, e.message || "Grammar check failed.");
    }
}

let naturalnessPopupEl = null;

function closeNaturalnessPopup() {
    if (naturalnessPopupEl) naturalnessPopupEl.classList.remove("is-open");
}

function showNaturalnessCheckPopup(feedback, loading = false, cached = false) {
    if (!naturalnessPopupEl) {
        naturalnessPopupEl = document.createElement("div");
        naturalnessPopupEl.className = "sentence-action-popup-backdrop naturalness-popup-backdrop";
        naturalnessPopupEl.innerHTML = `
          <div class="sentence-action-popup naturalness-result-popup">
            <h4 class="naturalness-result-title"></h4>
            <div class="naturalness-result-feedback"></div>
            <div class="popup-actions">
              <button type="button" class="popup-close-naturalness secondary">Close</button>
            </div>
          </div>
        `;
        const popup = naturalnessPopupEl.querySelector(".naturalness-result-popup");
        popup.style.left = "50%";
        popup.style.top = "50%";
        popup.style.transform = "translate(-50%, -50%)";
        naturalnessPopupEl.addEventListener("click", (e) => { if (e.target === naturalnessPopupEl) closeNaturalnessPopup(); });
        naturalnessPopupEl.querySelector(".popup-close-naturalness").addEventListener("click", closeNaturalnessPopup);
        document.body.appendChild(naturalnessPopupEl);
    }
    const titleEl = naturalnessPopupEl.querySelector(".naturalness-result-title");
    const feedbackEl = naturalnessPopupEl.querySelector(".naturalness-result-feedback");
    const actionsEl = naturalnessPopupEl.querySelector(".popup-actions");
    if (loading) {
        titleEl.textContent = "Checking naturalness…";
        feedbackEl.textContent = "";
        feedbackEl.style.display = "none";
        actionsEl.style.display = "none";
    } else {
        titleEl.textContent = cached ? "AI naturalness check (cached)" : "AI naturalness check";
        feedbackEl.textContent = feedback || "";
        feedbackEl.style.display = feedback ? "block" : "none";
        actionsEl.style.display = "flex";
    }
    naturalnessPopupEl.classList.add("is-open");
}

async function checkNaturalnessForText(text, listTitle = "") {
    const sentence = (text || "").trim();
    if (!sentence) {
        notify("No sentence text to check.");
        return;
    }
    showNaturalnessCheckPopup("", true);
    try {
        const result = await api.checkNaturalness(sentence, getAppLanguage(), listTitle);
        showNaturalnessCheckPopup(result.feedback || "No feedback returned.", false, !!result.cached);
    } catch (e) {
        showNaturalnessCheckPopup(e.message || "AI naturalness check failed.");
    }
}

async function sentenceNaturalness(id) {
    const sentence = findSentenceById(id);
    await checkNaturalnessForText(sentence ? sentence.content : "", getSentenceListTitle(sentence));
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

function parseIsoDateParts(isoDate) {
    if (isoDate && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        const [year, month, day] = isoDate.split("-").map(Number);
        return { day, month, year };
    }
    const now = new Date();
    return { day: now.getDate(), month: now.getMonth() + 1, year: now.getFullYear() };
}

function formatIsoDateParts(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return `${year}-${pad(month)}-${pad(day)}`;
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
    var sentence = findSentenceById(sentenceId);
    if (!sentence) {
        sentence = data
    }
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
    } else if (action === "unlink") {
        const preview = sentence?.content
            ? escapeHtml(sentence.content.length > 120 ? `${sentence.content.slice(0, 120)}…` : sentence.content)
            : "this sentence";
        popup.innerHTML = `
            <h4>🔓 Unlink from group?</h4>
            <p class="hint">Remove “${preview}” from this meaning group. The sentence will stay in its list.</p>
            <div class="popup-actions">
                <button type="button" class="secondary popup-cancel">Cancel</button>
                <button type="button" class="danger popup-confirm">Unlink</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);
        popup.querySelector(".popup-confirm").addEventListener("click", async () => {
            closeSentenceActionPopup();
            await unlinkSentenceFromGroup(sentenceId);
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
                const targetListId = Number(btn.getAttribute("data-list-id"));
                try {
                    await api.moveSentence(sentenceId, { targetListId });
                } catch (e) {
                    notify(e.message || "Failed to move sentence.");
                    return;
                }
                closeSentenceActionPopup();
                const sourceList = state.lists.find((l) => l.id === state.selectedListId);
                const targetList = state.lists.find((l) => l.id === targetListId);
                if (sourceList) {
                    sourceList.sentenceCount = Math.max(0, (Number(sourceList.sentenceCount) || 0) - 1);
                }
                if (targetList) {
                    targetList.sentenceCount = (Number(targetList.sentenceCount) || 0) + 1;
                }
                const sentenceCard = document.querySelector(`.sentence-item[data-sentence-id="${sentenceId}"]`);
                if (sentenceCard) {
                    state.sentences = state.sentences.filter((s) => s.id !== sentenceId);
                    if (state.selectedSentenceId === sentenceId) state.selectedSentenceId = null;
                    sentenceCard.classList.add("is-completing");
                    sentenceCard.addEventListener("transitionend", function onEnd(e) {
                        if (e.target !== sentenceCard || e.propertyName !== "max-height") return;
                        sentenceCard.removeEventListener("transitionend", onEnd);
                        sentenceCard.remove();
                        redrawMindMapCanvas();
                    });
                } else {
                    await refreshAndRender();
                }
            });
        });
    } else if (action === "schedule") {
        const s = data || {};
        const intervalDays = (s.intervalMinutes || [1440, 2880, 10080, 40320])
            .map((minutes) => Math.max(1, Math.round(minutes / 1440)))
            .join(", ");
        const excluded = !!s.excludedFromSchedule;
        const hasEndDate = !!s.endDate;
        const endDateParts = parseIsoDateParts(s.endDate);
        popup.innerHTML = `
            <h4>📅 Schedule</h4>
            <button type="button" id="sentencePopupToggleExcluded" class="secondary schedule-exclude-toggle">${excluded ? "✅ Include in schedule" : "🚫 Exclude from schedule (memorized)"}</button>
            ${excluded ? `<p class="hint">This sentence is currently excluded — it will not come up for review.</p>` : ""}
            <label>Intervals (days, comma-separated)</label>
            <input type="text" id="sentencePopupIntervals" value="${escapeHtml(intervalDays)}" placeholder="1, 2, 7, 28" />
            <label><input type="checkbox" id="sentencePopupOpenEnded" ${s.openEnded ? "checked" : ""} /> Open-ended weekly after final step</label>
            <label><input type="checkbox" id="sentencePopupNoEndDate" ${hasEndDate ? "" : "checked"} /> No end date</label>
            <div class="schedule-end-date-spinners" id="sentencePopupEndDateSpinners" style="${hasEndDate ? "" : "display:none;"}">
                <input type="number" class="input-soft" id="sentencePopupEndDay" min="1" max="31" value="${endDateParts.day}" title="Day" />
                <input type="number" class="input-soft" id="sentencePopupEndMonth" min="1" max="12" value="${endDateParts.month}" title="Month" />
                <input type="number" class="input-soft" id="sentencePopupEndYear" min="1970" max="2100" value="${endDateParts.year}" title="Year" />
            </div>
            <div class="popup-actions">
                <button type="button" class="secondary popup-cancel">Cancel</button>
                <button type="button" class="popup-save">Save</button>
            </div>
        `;
        popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);
        popup.querySelector("#sentencePopupToggleExcluded").addEventListener("click", async () => {
            const sentence = findSentenceById(sentenceId);
            try {
                const updated = excluded
                    ? await api.includeSentenceInSchedule(sentenceId)
                    : await api.excludeSentenceFromSchedule(sentenceId);
                if (sentence) sentence.excludedFromSchedule = updated.excludedFromSchedule;
            } catch (e) {
                notify(e.message || "Failed to update schedule exclusion.");
                return;
            }
            state.excludedSentences = null;
            await refreshAndRender();
            if (!state.selectedListId && state.currentSection === 5) {
                await ensureExcludedSentencesLoaded(true);
            }
            const refreshedSchedule = await api.getSchedule(sentenceId);
            showSentenceActionPopup("schedule", sentenceId, refreshedSchedule);
        });
        const noEndDateCheckbox = popup.querySelector("#sentencePopupNoEndDate");
        const endDateSpinners = popup.querySelector("#sentencePopupEndDateSpinners");
        noEndDateCheckbox.addEventListener("change", () => {
            endDateSpinners.style.display = noEndDateCheckbox.checked ? "none" : "";
        });
        popup.querySelector(".popup-save").addEventListener("click", async () => {
            const intervalsInput = popup.querySelector("#sentencePopupIntervals").value.trim();
            const openEnded = popup.querySelector("#sentencePopupOpenEnded").checked;
            const noEndDate = popup.querySelector("#sentencePopupNoEndDate").checked;
            let endDate = null;
            if (!noEndDate) {
                const day = Number(popup.querySelector("#sentencePopupEndDay").value);
                const month = Number(popup.querySelector("#sentencePopupEndMonth").value);
                const year = Number(popup.querySelector("#sentencePopupEndYear").value);
                endDate = formatIsoDateParts(year, month, day);
                if (!endDate) {
                    notify("Please enter a valid end date.");
                    return;
                }
            }
            await api.updateSchedule(sentenceId, {
                intervalMinutes: intervalsInput.split(",").map((v) => Number(v.trim())).filter(Boolean).map((days) => days * 1440),
                openEnded,
                endDate
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
    removeScrollJumpControls();
    const resetToken = getResetTokenFromHash();
    userBarEl.innerHTML = "";

    if (resetToken) {
        appEl.innerHTML = html`
            <section class="container card auth-card">
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
            <section class="container card auth-card">
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

    if (state.authView === "signup-language") {
        appEl.innerHTML = html`
            <section class="container card auth-card">
                <h2>Sign up</h2>
                <p class="hint">Choose the language for this account. You can change it later in Settings.</p>
                ${state.authMessage ? html`<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : ""}
                <div class="row auth-language-row">
                    <span class="hint auth-language-label">Learning language</span>
                    <div id="signupLanguagePicker" class="language-picker" role="listbox" aria-label="Learning language">
                        ${languagePickerHtml(state.authSignupLanguage || "en", escapeHtml)}
                    </div>
                </div>
                <div class="row">
                    <button id="signupLanguageContinueBtn">Continue</button>
                    <button id="signupLanguageBackBtn" class="secondary">Back to log in</button>
                </div>
            </section>
        `;
        document.getElementById("signupLanguageContinueBtn").addEventListener("click", () => {
            const picker = document.getElementById("signupLanguagePicker");
            state.authSignupLanguage = getLanguagePickerValue(picker);
            state.authMessage = null;
            state.authView = "signup-credentials";
            renderAuth();
        });
        bindLanguagePicker(document.getElementById("signupLanguagePicker"));
        document.getElementById("signupLanguageBackBtn").addEventListener("click", () => {
            state.authSignupLanguage = null;
            state.authMessage = null;
            state.authView = null;
            renderAuth();
        });
        return;
    }

    if (state.authView === "signup-credentials") {
        const languageLabel = getLanguageConfig(state.authSignupLanguage || "en").label;
        appEl.innerHTML = html`
            <section class="container card auth-card">
                <h2>Sign up</h2>
                <p class="hint">Create your account for ${escapeHtml(languageLabel)}.</p>
                ${state.authMessage ? html`<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : ""}
                <div class="row">
                    <input id="signupEmail" type="email" placeholder="Email" />
                    <input id="signupPassword" type="password" placeholder="Password (min 8 chars)" />
                </div>
                <div class="row">
                    <button id="signupCreateBtn">Create account</button>
                    <button id="signupCredentialsBackBtn" class="secondary">Back</button>
                </div>
            </section>
        `;
        document.getElementById("signupCreateBtn").addEventListener("click", () => completeSignup());
        document.getElementById("signupCredentialsBackBtn").addEventListener("click", () => {
            state.authMessage = null;
            state.authView = "signup-language";
            renderAuth();
        });
        return;
    }

    appEl.innerHTML = html`
        <section class="container card auth-card">
            <h2>Log in</h2>
            <p class="hint">Sign in to your account.</p>
            ${state.authMessage ? html`<p class="auth-message">${escapeHtml(state.authMessage)}</p>` : ""}
            <div class="row">
                <input id="authEmail" type="email" placeholder="Email" />
                <input id="authPassword" type="password" placeholder="Password" />
            </div>
            <div class="row">
                <button id="loginBtn">Log in</button>
                <button id="signupBtn" class="secondary">Sign up</button>
            </div>
            <p class="auth-footer"><a href="#" id="forgotPasswordLink">Forgot password?</a></p>
        </section>
    `;

    document.getElementById("loginBtn").addEventListener("click", async () => {
        await authLogin();
    });
    document.getElementById("signupBtn").addEventListener("click", () => {
        state.authSignupLanguage = null;
        state.authMessage = null;
        state.authView = "signup-language";
        renderAuth();
    });
    document.getElementById("forgotPasswordLink").addEventListener("click", (e) => {
        e.preventDefault();
        state.authView = "forgot";
        state.authMessage = null;
        renderAuth();
    });
}

async function authLogin() {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const loginBtn = document.getElementById("loginBtn");
    const signupBtn = document.getElementById("signupBtn");
    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = "Logging in…";
    }
    if (signupBtn) signupBtn.disabled = true;
    try {
        state.user = await api.login({ email, password });
        setTtsLanguage(getAppLanguage());
        applyDefaultNaturalTtsForLanguage(getAppLanguage());
        await loadAppData({ refreshReviewSessions: true });
        renderApp();
        if (getUseNaturalTts()) setTimeout(() => preloadTTS(getAppLanguage()), 1500);
    } catch (error) {
        notify(error.message);
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.textContent = "Log in";
        }
        if (signupBtn) signupBtn.disabled = false;
    }
}

async function completeSignup() {
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const language = normalizeAppLanguage(state.authSignupLanguage || "en");

    if (!email) {
        state.authMessage = "Please enter your email.";
        renderAuth();
        return;
    }
    if (password.length < 8) {
        state.authMessage = "Password must be at least 8 characters.";
        renderAuth();
        return;
    }

    try {
        await api.register({ email, password, language });
        state.user = await api.login({ email, password });
        state.authSignupLanguage = null;
        state.authView = null;
        state.authMessage = null;
        setTtsLanguage(getAppLanguage());
        if (language === "sr") {
            setUseNaturalTts(true);
        } else {
            applyDefaultNaturalTtsForLanguage(language);
        }
        await loadAppData({ refreshReviewSessions: true });
        renderApp();
        if (getUseNaturalTts()) setTimeout(() => preloadTTS(getAppLanguage()), 1500);
    } catch (error) {
        state.authMessage = error.message || "Sign up failed.";
        renderAuth();
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

function shouldShowScrollJumpControls() {
    if (state.view === "reviewSession" && state.openSession) return true;
    if (state.view !== "dashboard") return false;
    if (state.selectedListId) return true;
    return state.currentSection === 0 || state.currentSection === 1;
}

let scrollJumpOnScroll = null;
let scrollJumpOnResize = null;

function removeScrollJumpControls() {
    unbindScrollJumpScrollSync();
    document.getElementById("scrollJumpControls")?.remove();
}

function updateScrollJumpPosition() {
    const wrap = document.getElementById("scrollJumpControls");
    if (!wrap) return;

    const root = document.scrollingElement || document.documentElement;
    const scrollTop = root.scrollTop;
    const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
    const threshold = 40;
    const atTop = scrollTop <= threshold;
    const atBottom = maxScroll > threshold && scrollTop >= maxScroll - threshold;

    wrap.classList.toggle("is-at-page-top", atTop);
    wrap.classList.toggle("is-at-page-bottom", atBottom);

    if (atBottom && !atTop) {
        const bottomInset = parseFloat(getComputedStyle(wrap).bottom) || 16;
        const topInset = bottomInset;
        const travel = -(window.innerHeight - wrap.offsetHeight - topInset - bottomInset);
        wrap.style.setProperty("--scroll-jump-y", `${travel}px`);
    } else {
        wrap.style.setProperty("--scroll-jump-y", "0px");
    }
}

function bindScrollJumpScrollSync() {
    unbindScrollJumpScrollSync();
    if (!document.getElementById("scrollJumpControls")) return;

    scrollJumpOnScroll = updateScrollJumpPosition;
    scrollJumpOnResize = updateScrollJumpPosition;
    window.addEventListener("scroll", scrollJumpOnScroll, { passive: true });
    window.addEventListener("resize", scrollJumpOnResize, { passive: true });
    updateScrollJumpPosition();
}

function unbindScrollJumpScrollSync() {
    if (scrollJumpOnScroll) {
        window.removeEventListener("scroll", scrollJumpOnScroll);
        scrollJumpOnScroll = null;
    }
    if (scrollJumpOnResize) {
        window.removeEventListener("resize", scrollJumpOnResize);
        scrollJumpOnResize = null;
    }
}

function mountScrollJumpControls() {
    removeScrollJumpControls();
    if (!shouldShowScrollJumpControls()) return;

    const wrap = document.createElement("div");
    wrap.id = "scrollJumpControls";
    wrap.className = "scroll-jump-controls";
    wrap.setAttribute("aria-label", "Scroll shortcuts");

    const topBtn = document.createElement("button");
    topBtn.type = "button";
    topBtn.className = "btn-icon secondary scroll-jump-top";
    topBtn.title = "Scroll to top";
    topBtn.setAttribute("aria-label", "Scroll to top");
    topBtn.textContent = "↑";

    const bottomBtn = document.createElement("button");
    bottomBtn.type = "button";
    bottomBtn.className = "btn-icon secondary scroll-jump-bottom";
    bottomBtn.title = "Scroll to bottom";
    bottomBtn.setAttribute("aria-label", "Scroll to bottom");
    bottomBtn.textContent = "↓";

    topBtn.addEventListener("click", () => scrollJumpTo("top"));
    bottomBtn.addEventListener("click", () => scrollJumpTo("bottom"));

    wrap.append(topBtn, bottomBtn);
    document.body.appendChild(wrap);
    bindScrollJumpScrollSync();
}

function updateScrollJumpControlsVisibility() {
    if (shouldShowScrollJumpControls()) {
        if (!document.getElementById("scrollJumpControls")) {
            mountScrollJumpControls();
        } else {
            bindScrollJumpScrollSync();
        }
    } else {
        removeScrollJumpControls();
    }
}

function scrollJumpTo(edge) {
    const root = document.scrollingElement || document.documentElement;
    const top = edge === "top" ? 0 : Math.max(0, root.scrollHeight - window.innerHeight);
    window.scrollTo({ top, behavior: "smooth" });
}

function formatStatsNumber(value) {
    return Number(value || 0).toLocaleString();
}

function formatStatsPercent(value) {
    return `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}%`;
}

function formatStatsTry(value) {
    const n = Number(value || 0);
    return n > 0 ? n.toFixed(1).replace(/\.0$/, "") : "—";
}

function formatStatsDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function buildStatsMetricCards(metrics) {
    return html`
      <div class="stats-metric-grid">
        ${metrics.map((metric) => html`
          <div class="stats-metric">
            <div class="stats-metric-value">${escapeHtml(String(metric.value))}</div>
            <div class="stats-metric-label">${escapeHtml(metric.label)}</div>
          </div>
        `).join("")}
      </div>
    `;
}

function buildStatsTimelineChart(points, title = "Review activity") {
    const data = Array.isArray(points) ? points : [];
    if (!data.length) return `<div class="hint">No chart data yet.</div>`;

    const width = 760;
    const height = 280;
    const left = 58;
    const right = 22;
    const top = 24;
    const bottom = 52;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const maxReviewed = Math.max(1, ...data.map((p) => Number(p.reviewed) || 0));
    const step = chartWidth / data.length;
    const barWidth = Math.max(4, Math.min(16, step * 0.62));
    const todayLabelIndexes = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);

    const bars = data.map((p, i) => {
        const reviewed = Number(p.reviewed) || 0;
        const barHeight = Math.round((reviewed / maxReviewed) * chartHeight);
        const x = left + i * step + (step - barWidth) / 2;
        const y = top + chartHeight - barHeight;
        const fill = reviewed > 0 ? "rgb(125, 99, 255)" : "rgb(220, 212, 255)";
        const label = `${p.date}: ${reviewed} sentence${reviewed === 1 ? "" : "s"}`;
        return `<rect x="${x.toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="3" fill="${fill}"><title>${escapeHtml(label)}</title></rect>`;
    }).join("");

    const labels = data.map((p, i) => {
        if (!todayLabelIndexes.has(i)) return "";
        const x = left + i * step + step / 2;
        const label = String(p.date || "").slice(5);
        return `<text x="${x.toFixed(1)}" y="${height - 18}" text-anchor="middle" class="stats-chart-label">${escapeHtml(label)}</text>`;
    }).join("");

    const yMid = Math.ceil(maxReviewed / 2);
    return html`
      <svg class="stats-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#fff"></rect>
        <text x="${left}" y="18" class="stats-chart-title">${escapeHtml(title)}</text>
        <line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartHeight}" class="stats-chart-axis"></line>
        <line x1="${left}" y1="${top + chartHeight}" x2="${left + chartWidth}" y2="${top + chartHeight}" class="stats-chart-axis"></line>
        <line x1="${left}" y1="${top + chartHeight / 2}" x2="${left + chartWidth}" y2="${top + chartHeight / 2}" class="stats-chart-grid"></line>
        <text x="16" y="${top + chartHeight / 2}" class="stats-chart-label">${yMid}</text>
        <text x="16" y="${top + chartHeight + 4}" class="stats-chart-label">0</text>
        <text x="14" y="${top + 8}" class="stats-chart-label">${maxReviewed}</text>
        <text x="18" y="${top + chartHeight / 2}" transform="rotate(-90 18 ${top + chartHeight / 2})" text-anchor="middle" class="stats-chart-label">sentences</text>
        <text x="${left + chartWidth / 2}" y="${height - 2}" text-anchor="middle" class="stats-chart-label">time</text>
        ${bars}
        ${labels}
      </svg>
    `;
}

function buildAttemptDistributionChart(points, title = "Successful pronunciation by try") {
    const data = (Array.isArray(points) ? points : []).filter((p) => Number(p.count) > 0);
    if (!data.length) return `<div class="hint">No successful pronunciation attempts yet.</div>`;

    const width = 520;
    const height = 220;
    const left = 52;
    const right = 18;
    const top = 24;
    const bottom = 42;
    const chartWidth = width - left - right;
    const chartHeight = height - top - bottom;
    const maxCount = Math.max(1, ...data.map((p) => Number(p.count) || 0));
    const step = chartWidth / data.length;
    const barWidth = Math.max(18, Math.min(44, step * 0.58));

    const bars = data.map((p, i) => {
        const count = Number(p.count) || 0;
        const attemptNumber = Number(p.attemptNumber) || i + 1;
        const barHeight = Math.round((count / maxCount) * chartHeight);
        const x = left + i * step + (step - barWidth) / 2;
        const y = top + chartHeight - barHeight;
        const fill = attemptNumber === 1 ? "rgb(86, 214, 122)" : (attemptNumber === 2 ? "rgb(254, 178, 178)" : "rgb(234, 88, 12)");
        return html`
          <rect x="${x.toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${barHeight}" rx="5" fill="${fill}">
            <title>Try ${attemptNumber}: ${count}</title>
          </rect>
          <text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 18}" text-anchor="middle" class="stats-chart-label">Try ${attemptNumber}</text>
        `;
    }).join("");

    return html`
      <svg class="stats-chart stats-chart-compact" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}">
        <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#fff"></rect>
        <text x="${left}" y="18" class="stats-chart-title">${escapeHtml(title)}</text>
        <line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartHeight}" class="stats-chart-axis"></line>
        <line x1="${left}" y1="${top + chartHeight}" x2="${left + chartWidth}" y2="${top + chartHeight}" class="stats-chart-axis"></line>
        <text x="14" y="${top + 8}" class="stats-chart-label">${maxCount}</text>
        <text x="16" y="${top + chartHeight + 4}" class="stats-chart-label">0</text>
        ${bars}
      </svg>
    `;
}

function renderStatsPanelHtml() {
    if (state.statsError) {
        return html`
          <h3>Stats</h3>
          <p class="hint">${escapeHtml(state.statsError)}</p>
          <button type="button" id="retryStatsBtn" class="secondary">Retry</button>
        `;
    }
    if (!state.statsOverview) {
        return html`
          <h3>Stats</h3>
          <p class="hint">Loading stats…</p>
        `;
    }

    const summary = state.statsOverview.summary || {};
    return html`
      <h3>Stats</h3>
      ${buildStatsMetricCards([
        { label: "Reviewed today", value: formatStatsNumber(summary.reviewedToday) },
        { label: "This week", value: formatStatsNumber(summary.reviewedThisWeek) },
        { label: "This month", value: formatStatsNumber(summary.reviewedThisMonth) },
        { label: "Longest streak", value: `${formatStatsNumber(summary.longestStreakDays)}d` },
        { label: "Success rate", value: formatStatsPercent(summary.successRate) },
        { label: "Avg. correct try", value: formatStatsTry(summary.averageSuccessfulTry) }
      ])}
      <div class="stats-chart-panel">
        ${buildStatsTimelineChart(state.statsOverview.timeline, "Sentences reviewed over time")}
      </div>
      <div class="stats-chart-panel">
        ${buildAttemptDistributionChart(state.statsOverview.attemptDistribution)}
      </div>
    `;
}

async function ensureStatsOverviewLoaded(force = false) {
    if (state.statsLoading) return;
    if (!force && state.statsOverview) return;
    state.statsLoading = true;
    state.statsError = null;
    try {
        state.statsOverview = await api.getStatsOverview();
    } catch (err) {
        state.statsError = err.message || "Failed to load stats.";
    } finally {
        state.statsLoading = false;
        if (state.view === "dashboard" && !state.selectedListId && state.currentSection === 4) {
            renderApp();
        }
    }
}

function renderExcludedPanelHtml() {
    if (state.excludedError) {
        return html`
          <h3>🚫 Excluded from schedule</h3>
          <p class="hint">${escapeHtml(state.excludedError)}</p>
          <button type="button" id="retryExcludedBtn" class="secondary">Retry</button>
        `;
    }
    if (!state.excludedSentences) {
        return html`
          <h3>🚫 Excluded from schedule</h3>
          <p class="hint">Loading…</p>
        `;
    }
    if (state.excludedSentences.length === 0) {
        return html`
          <h3>🚫 Excluded from schedule</h3>
          <p class="hint">No excluded sentences. Sentences you mark as memorized (excluded from schedule) will show up here so you can bring them back later.</p>
        `;
    }
    return html`
      <h3>🚫 Excluded from schedule</h3>
      <p class="hint">Sentences you've marked as memorized. Review them here and include any you still want to practice.</p>
      <ul class="sentence-list">
        ${state.excludedSentences.map((sentence) => renderSentenceItemHtml(sentence, { showListName: true })).join("")}
      </ul>
    `;
}

async function ensureExcludedSentencesLoaded(force = false) {
    if (state.excludedLoading) return;
    if (!force && state.excludedSentences) return;
    state.excludedLoading = true;
    state.excludedError = null;
    try {
        state.excludedSentences = await api.getExcludedSentences();
    } catch (err) {
        state.excludedError = err.message || "Failed to load excluded sentences.";
    } finally {
        state.excludedLoading = false;
        if (state.view === "dashboard" && !state.selectedListId && state.currentSection === 5) {
            renderApp();
        }
    }
}

function getNextVoiceAttemptNumber(sentenceId) {
    if (!sentenceId) return 1;
    const key = String(sentenceId);
    const next = (Number(state.voiceAttemptCountBySentenceId[key]) || 0) + 1;
    state.voiceAttemptCountBySentenceId[key] = next;
    return next;
}

function resetVoiceAttemptNumber(sentenceId) {
    if (!sentenceId) return;
    delete state.voiceAttemptCountBySentenceId[String(sentenceId)];
}

function recordVoiceCheckStats(stats, match) {
    if (!stats || !stats.sentenceId) return;
    api.recordPronunciationAttempt({
        sentenceId: stats.sentenceId,
        reviewSessionId: stats.reviewSessionId || null,
        successful: !!match,
        attemptNumber: stats.attemptNumber || 1,
        stage: stats.stage || null,
        partIndex: stats.partIndex ?? null,
        partCount: stats.partCount ?? null,
        source: stats.source || "REVIEW"
    }).then(() => {
        state.statsOverview = null;
    }).catch(() => {
        // Stats are useful, but failed logging should not interrupt review flow.
    });
}

let sentenceStatsPopupEl = null;

function ensureSentenceStatsPopup() {
    if (sentenceStatsPopupEl) return sentenceStatsPopupEl;
    sentenceStatsPopupEl = document.createElement("div");
    sentenceStatsPopupEl.className = "sentence-action-popup-backdrop sentence-stats-popup-backdrop";
    sentenceStatsPopupEl.innerHTML = '<div class="sentence-action-popup sentence-stats-popup"></div>';
    sentenceStatsPopupEl.addEventListener("click", (e) => {
        if (e.target === sentenceStatsPopupEl) closeSentenceStatsPopup();
    });
    document.body.appendChild(sentenceStatsPopupEl);
    return sentenceStatsPopupEl;
}

function closeSentenceStatsPopup() {
    if (sentenceStatsPopupEl) sentenceStatsPopupEl.classList.remove("is-open");
}

function renderSentenceStatsPopupContent(stats) {
    const sentence = stats?.sentence || {};
    const summary = stats?.summary || {};
    return html`
      <h4>Sentence stats</h4>
      <p class="sentence-stats-content">${renderSentenceWithWordLinks(sentence.content || "")}</p>
      <div class="hint">in ${escapeHtml(sentence.listName || "")}</div>
      ${buildStatsMetricCards([
        { label: "Total reviews", value: formatStatsNumber(summary.reviewCount) },
        { label: "Last 30 days", value: formatStatsNumber(summary.reviewsLast30Days) },
        { label: "Last reviewed", value: formatStatsDate(summary.lastReviewedAt) },
        { label: "Success rate", value: formatStatsPercent(summary.successRate) },
        { label: "Successful tries", value: `${formatStatsNumber(summary.successfulAttempts)} / ${formatStatsNumber(summary.attemptsTotal)}` },
        { label: "Avg. correct try", value: formatStatsTry(summary.averageSuccessfulTry) }
      ])}
      <div class="stats-chart-panel">
        ${buildStatsTimelineChart(stats.timeline, "Sentence reviews over time")}
      </div>
      <div class="stats-chart-panel">
        ${buildAttemptDistributionChart(stats.attemptDistribution, "Sentence pronunciation by try")}
      </div>
      <div class="popup-actions">
        <button type="button" class="secondary sentence-stats-close">Close</button>
      </div>
    `;
}

async function openSentenceStatsPopup(sentenceId) {
    if (!sentenceId) return;
    const wrap = ensureSentenceStatsPopup();
    const popup = wrap.querySelector(".sentence-stats-popup");
    popup.innerHTML = `
      <h4>Sentence stats</h4>
      <p class="hint">Loading stats…</p>
      <div class="popup-actions">
        <button type="button" class="secondary sentence-stats-close">Close</button>
      </div>
    `;
    popup.querySelector(".sentence-stats-close").addEventListener("click", closeSentenceStatsPopup);
    wrap.classList.add("is-open");
    state.sentenceStatsLoadingId = sentenceId;
    try {
        const stats = await api.getSentenceStats(sentenceId);
        if (state.sentenceStatsLoadingId !== sentenceId) return;
        popup.innerHTML = renderSentenceStatsPopupContent(stats);
        popup.querySelector(".sentence-stats-close").addEventListener("click", closeSentenceStatsPopup);
    } catch (err) {
        if (state.sentenceStatsLoadingId !== sentenceId) return;
        popup.innerHTML = `
          <h4>Sentence stats</h4>
          <p class="hint">${escapeHtml(err.message || "Failed to load sentence stats.")}</p>
          <div class="popup-actions">
            <button type="button" class="secondary sentence-stats-close">Close</button>
          </div>
        `;
        popup.querySelector(".sentence-stats-close").addEventListener("click", closeSentenceStatsPopup);
    }
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
        <div class="dashboard-tabs">
          <div class="dashboard-tabs-inner" role="tablist">
            <button type="button" class="dashboard-tab ${state.currentSection === 0 ? "active" : ""}" data-section="0" role="tab">Lists</button>
            <button type="button" class="dashboard-tab ${state.currentSection === 1 ? "active" : ""}" data-section="1" role="tab">Reviews</button>
            <button type="button" class="dashboard-tab ${state.currentSection === 2 ? "active" : ""}" data-section="2" role="tab">Settings</button>
            <button type="button" class="dashboard-tab ${state.currentSection === 3 ? "active" : ""}" data-section="3" role="tab">Mind Map</button>
            <button type="button" class="dashboard-tab ${state.currentSection === 4 ? "active" : ""}" data-section="4" role="tab">Stats</button>
            <button type="button" class="dashboard-tab ${state.currentSection === 5 ? "active" : ""}" data-section="5" role="tab">Excluded</button>
          </div>
        </div>
        ` : ""}
        <div class="dashboard-content">
          ${state.selectedListId && state.openMeaningGroupId ? buildMeaningGroupDetailHtml() : ""}
          ${state.selectedListId && !state.openMeaningGroupId ? html`
            <div class="dashboard-list-detail card">
              <button type="button" id="showListsBtn" class="show-lists-btn secondary">← Lists</button>
              <h2 class="dashboard-content-title">${selectedList ? escapeHtml(selectedList.name) : ""}</h2>
              ${selectedList ? html`
                <div class="row add-sentence-row">
                  <input id="newSentence" class="add-sentence-input input-soft" placeholder="Add sentence to memorize" />
                  <button id="addSentenceBtn" class="add-sentence-btn">Add sentence</button>
                </div>
                <div class="row list-search-row">
                  <input id="listSearchInput" type="search" class="input-soft" placeholder="Search in list…" value="${escapeHtml(state.listSearchQuery || "")}" autocomplete="off" />
                </div>
                <div class="hint">New sentences are auto-scheduled by default pattern (1d, 2d, 1w, 4w).</div>
                <ul class="sentence-list">
                  ${(() => {
                    const q = (state.listSearchQuery || "").trim().toLowerCase();
                    const filtered = q ? state.sentences.filter((s) => (s.content || "").toLowerCase().includes(q)) : state.sentences;
                    return filtered.map((sentence) => renderSentenceItemHtml(sentence, {
                        highlighted: state.selectedSentenceId === sentence.id
                    })).join("");
                  })()}
                </ul>
                <div id="sentenceListSentinel" class="sentence-list-sentinel" aria-hidden="true"></div>
              ` : ""}
            </div>
          ` : ""}
          ${!state.selectedListId ? html`
            <div class="dashboard-panel card" data-section="0" style="display: ${state.currentSection === 0 ? "block" : "none"}">
              <h3>Sentence Lists</h3>
              <div class="row global-search-row">
                <input id="globalSearchInput" type="search" class="input-soft" placeholder="Search sentences in all lists…" value="${escapeHtml(state.globalSearchQuery || "")}" autocomplete="off" />
              </div>
              <div id="globalSearchResults" class="global-search-results" hidden></div>
              <div class="row">
                <input id="newListName" class="input-soft" placeholder="New list name" />
                <button id="createListBtn">Create</button>
              </div>
              <div class="row list-search-row">
                <input id="listsFilterInput" type="search" class="input-soft" placeholder="Search lists by name…" value="${escapeHtml(state.listsFilterQuery || "")}" autocomplete="off" />
              </div>
              <ul class="lists-list">${buildListsListItemsHtml()}</ul>
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
              <div class="hint" style="margin-top: 0.75rem;">Automatically exclude a sentence from the schedule once it's been reviewed this many times (0 disables auto-exclude).</div>
              <div class="row">
                <input id="autoExcludeAfterReviewsInput" type="number" class="input-soft" min="0" max="1000" value="${state.settings.autoExcludeAfterReviews != null ? state.settings.autoExcludeAfterReviews : 10}" />
              </div>
              <div class="row auth-language-row" style="margin-top: 0.75rem;">
                <span class="hint auth-language-label">Learning language</span>
                <div id="languageInputPicker" class="language-picker" role="listbox" aria-label="Learning language">
                  ${languagePickerHtml(state.settings.language || getAppLanguage(), escapeHtml)}
                </div>
              </div>
              <div class="row" style="margin-top: 0.75rem;">
                <label class="checkbox-label">
                  <input type="checkbox" id="useNaturalTtsInput" ${getUseNaturalTts() ? "checked" : ""} />
                  Use natural voice — ${getNaturalTtsHint(getAppLanguage())}, slower first time
                </label>
              </div>
              <div class="row settings-button-row review-reminders-row">
                <button type="button" id="enableReviewRemindersBtn" class="secondary">Enable review reminders</button>
                <span class="hint" id="reviewRemindersHint"></span>
              </div>
              <div class="settings-button-row settings-actions">
                <button id="saveSettingsBtn">Save settings</button>
              </div>
            </div>
            <div class="dashboard-panel card dashboard-coming-soon-panel" data-section="3" style="display: ${state.currentSection === 3 ? "block" : "none"}">
              <h3>Mind Map</h3>
              <p class="dashboard-coming-soon">Coming soon</p>
            </div>
            <div class="dashboard-panel card stats-panel" data-section="4" style="display: ${state.currentSection === 4 ? "block" : "none"}">
              ${renderStatsPanelHtml()}
            </div>
            <div class="dashboard-panel card excluded-panel" data-section="5" style="display: ${state.currentSection === 5 ? "block" : "none"}">
              ${renderExcludedPanelHtml()}
            </div>
          ` : ""}
        </div>
      </section>
    `;

    bindDashboardActions();
    syncGlobalSearchResultsDom();
    bindDashboardTabs();
    renderPendingReviews();
    bindLanguagePicker(document.getElementById("languageInputPicker"));
    if (MIND_MAP_ENABLED) renderMindMap();
    if (!state.selectedListId && state.currentSection === 4) ensureStatsOverviewLoaded();
    if (!state.selectedListId && state.currentSection === 5) ensureExcludedSentencesLoaded();

    if (state.selectedListId && state.justOpenedListId === state.selectedListId && !state.openMeaningGroupId) {
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
    } else if (state.selectedListId && !state.openMeaningGroupId) {
        const listDetail = appEl.querySelector(".dashboard-list-detail");
        if (listDetail) listDetail.classList.add("list-detail-open");
    }

    if (state.openMeaningGroupId && state.justOpenedMeaningGroup === state.openMeaningGroupId) {
        const groupDetail = appEl.querySelector(".dashboard-group-detail");
        if (groupDetail) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    groupDetail.classList.add("list-detail-open");
                    state.justOpenedMeaningGroup = null;
                });
            });
        } else {
            state.justOpenedMeaningGroup = null;
        }
    } else if (state.openMeaningGroupId) {
        const groupDetail = appEl.querySelector(".dashboard-group-detail");
        if (groupDetail) groupDetail.classList.add("list-detail-open");
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

    if (state.newGroupLinkedSentenceId != null) {
        const linkedEl = document.querySelector(`.sentence-item[data-sentence-id="${state.newGroupLinkedSentenceId}"]`);
        if (linkedEl) {
            linkedEl.classList.add("is-group-adding");
            linkedEl.addEventListener("animationend", function onBlinkEnd() {
                linkedEl.removeEventListener("animationend", onBlinkEnd);
                linkedEl.classList.remove("is-group-adding");
                state.newGroupLinkedSentenceId = null;
            });
        } else {
            state.newGroupLinkedSentenceId = null;
        }
    }

    if (state.savedListScrollY) {
        setTimeout(() => {
            window.scrollTo(0, state.savedListScrollY);
            state.savedListScrollY = 0;
        }, 0);
    }

    mountScrollJumpControls();
    mountFloatingSessionSquares();
}

function navigateBackToLists() {
    state.selectedListId = null;
    navigateBackFromGroup();
    state.listSearchQuery = "";
    state.openedListFromMindMap = false;
    state.restoreMindMapFullscreen = false;
    state.currentSection = 0;
    renderApp();
}

function animateCloseDetailPanelThen(panelSelector, backButtonId, callback) {
    const panel = document.querySelector(panelSelector);
    if (!panel || !panel.classList.contains("list-detail-open")) {
        callback();
        return;
    }

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        callback();
    };

    const backBtn = backButtonId ? document.getElementById(backButtonId) : null;
    if (backBtn) backBtn.disabled = true;

    panel.classList.add("list-detail-closing");
    panel.classList.remove("list-detail-open");

    const onEnd = (e) => {
        if (e.target !== panel) return;
        if (e.propertyName !== "opacity" && e.propertyName !== "transform") return;
        panel.removeEventListener("transitionend", onEnd);
        finish();
    };
    panel.addEventListener("transitionend", onEnd);
    setTimeout(finish, 450);
}

function animateCloseListDetailThen(callback) {
    animateCloseDetailPanelThen(".dashboard-list-detail", "showListsBtn", callback);
}

function animateCloseGroupDetailThen(callback) {
    animateCloseDetailPanelThen(".dashboard-group-detail", "showListFromGroupBtn", callback);
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
            if (section === 3 && MIND_MAP_ENABLED) {
                renderMindMap();
            }
            if (section === 4) {
                ensureStatsOverviewLoaded();
            }
            if (section === 5) {
                ensureExcludedSentencesLoaded();
            }
            updateScrollJumpControlsVisibility();
        });
    });

    const showListsBtn = document.getElementById("showListsBtn");
    if (showListsBtn) {
        showListsBtn.addEventListener("click", () => {
            animateCloseListDetailThen(navigateBackToLists);
        });
    }

    const showListFromGroupBtn = document.getElementById("showListFromGroupBtn");
    if (showListFromGroupBtn) {
        showListFromGroupBtn.addEventListener("click", () => {
            animateCloseGroupDetailThen(() => {
                navigateBackFromGroupAndRefresh();
            });
        });
    }

    const groupSearchInput = document.getElementById("groupSearchInput");
    if (groupSearchInput) {
        groupSearchInput.addEventListener("input", () => {
            state.groupSearchQuery = groupSearchInput.value;
            const q = state.groupSearchQuery.trim().toLowerCase();
            if (!q) {
                renderApp();
                return;
            }
            document.querySelectorAll(".dashboard-group-detail .sentence-list .sentence-item").forEach((li) => {
                const contentEl = li.querySelector(".sentence-item-content");
                const text = (contentEl ? contentEl.textContent : "").toLowerCase();
                li.style.display = text.includes(q) ? "" : "none";
            });
        });
    }

    const groupLinkSentenceBtn = document.getElementById("groupLinkSentenceBtn");
    if (groupLinkSentenceBtn) {
        groupLinkSentenceBtn.addEventListener("click", () => {
            const select = document.getElementById("groupLinkSentenceSelect");
            const sentenceId = select ? Number(select.value) : NaN;
            if (!sentenceId) return;
            linkSentenceToOpenGroup(sentenceId);
        });
    }

    const listsFilterInput = document.getElementById("listsFilterInput");
    if (listsFilterInput) {
        listsFilterInput.addEventListener("input", () => {
            state.listsFilterQuery = listsFilterInput.value;
            const listEl = document.querySelector(".dashboard-panel[data-section=\"0\"] .lists-list");
            if (!listEl) return;
            // Rebuild only the list contents from state so both narrowing and
            // broadening the query work, while the search input keeps focus.
            listEl.innerHTML = buildListsListItemsHtml();
            bindListItemActions();
        });
    }

    const listSearchInput = document.getElementById("listSearchInput");
    if (listSearchInput) {
        listSearchInput.addEventListener("input", () => {
            state.listSearchQuery = listSearchInput.value;
            const q = state.listSearchQuery.trim().toLowerCase();
                if (!q) {
                    renderApp(); // rebuild full list from state.sentences
                    return;
                }
            document.querySelectorAll(".dashboard-list-detail .sentence-list .sentence-item").forEach((li) => {
                const contentEl = li.querySelector(".sentence-item-content");
                const text = (contentEl ? contentEl.textContent : "").toLowerCase();
                li.style.display = text.includes(q) ? "" : "none";
            });
        });
    }
}

function renderReviewSentenceItemHtml(item, idx, groupId) {
    const tintClass = groupId ? getMeaningGroupTintClass(groupId) : "";
    const listTitle = getSentenceListTitle(item);
    return html`
      <li class="review-sentence-item ${tintClass}" data-review-idx="${idx}">
        <div class="review-sentence-main">
          <div class="review-sentence-copy">
            <div class="review-sentence-content">${renderSentenceWithWordLinks(item.content)}</div>
          </div>
          <div class="review-sentence-buttons">
            <button type="button" class="btn-icon secondary review-speak" data-review-speak-idx="${idx}" title="Listen">🔊</button>
            <button type="button" class="btn-icon secondary review-naturalness" data-review-naturalness-idx="${idx}" title="AI naturalness check">✨</button>
            <button type="button" class="btn-icon secondary review-speak-check stage-1" data-review-speak-check-idx="${idx}" title="Speak and check (stage 1: full sentence)">🎤</button>
            <button type="button" class="btn-icon secondary review-more-toggle" data-review-more-idx="${idx}" aria-expanded="false" aria-controls="review-extra-actions-${idx}" aria-label="Show more actions" title="Show more actions">›</button>
            <div class="review-extra-actions" id="review-extra-actions-${idx}" aria-hidden="true">
              ${listTitle ? html`
                <span class="review-context-control">
                  <button type="button" class="btn-icon secondary review-context-action" data-review-context-idx="${idx}" aria-expanded="false" aria-controls="review-context-popover-${idx}" aria-label="Look up the context" title="Look up the context" tabindex="-1">🔎</button>
                  <span class="review-context-popover" id="review-context-popover-${idx}" role="status" aria-hidden="true"></span>
                </span>
              ` : ""}
              <button type="button" class="btn-icon secondary review-edit" data-review-edit-idx="${idx}" title="Edit" tabindex="-1">✏</button>
              <button type="button" class="btn-icon secondary review-playphrase" data-review-playphrase-idx="${idx}" title="Play phrase (playphrase.me)" tabindex="-1">▶️</button>
              <button type="button" class="btn-icon secondary review-youglish" data-review-youglish-idx="${idx}" title="Pronounce (YouGlish)" tabindex="-1">🔤</button>
            </div>
          </div>
        </div>
        <div class="review-voice-result" data-review-voice-idx="${idx}" aria-live="polite"></div>
      </li>
    `;
}

function setReviewContextPopoverOpen(button, open, listTitle = "") {
    const control = button?.closest(".review-context-control");
    const popoverId = button?.getAttribute("aria-controls");
    const popover = popoverId ? document.getElementById(popoverId) : null;
    if (!button || !control || !popover) return;

    if (open && listTitle) {
        popover.textContent = `in ${listTitle}`;
    }
    control.classList.toggle("is-context-open", open);
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.title = open ? "Hide context" : "Look up the context";
    popover.setAttribute("aria-hidden", open ? "false" : "true");
}

function closeReviewContextPopovers(scope = document) {
    scope.querySelectorAll(".review-context-control.is-context-open .review-context-action").forEach((button) => {
        setReviewContextPopoverOpen(button, false);
    });
}

function setReviewExtraActionsOpen(toggleButton, open) {
    const controlsId = toggleButton?.getAttribute("aria-controls");
    const actionsEl = controlsId ? document.getElementById(controlsId) : null;
    if (!toggleButton || !actionsEl) return;

    if (!open) closeReviewContextPopovers(actionsEl);
    toggleButton.setAttribute("aria-expanded", open ? "true" : "false");
    toggleButton.classList.toggle("is-open", open);
    const label = open ? "Hide more actions" : "Show more actions";
    toggleButton.title = label;
    toggleButton.setAttribute("aria-label", label);
    actionsEl.classList.toggle("is-open", open);
    actionsEl.setAttribute("aria-hidden", open ? "false" : "true");
    actionsEl.querySelectorAll("button").forEach((button) => {
        button.tabIndex = open ? 0 : -1;
    });
}

function buildReviewSessionItemsHtml(items) {
    const parts = [];
    let idx = 0;
    while (idx < items.length) {
        const item = items[idx];
        const groupId = item.meaningGroupId;
        if (!groupId) {
            parts.push(renderReviewSentenceItemHtml(item, idx));
            idx += 1;
            continue;
        }
        const groupRun = [];
        let scan = idx;
        while (scan < items.length && items[scan].meaningGroupId === groupId) {
            groupRun.push({ item: items[scan], index: scan });
            scan += 1;
        }
        if (groupRun.length < 2) {
            parts.push(renderReviewSentenceItemHtml(groupRun[0].item, groupRun[0].index));
        } else {
            const groupLabel = (groupRun[0].item.meaningGroupLabel && String(groupRun[0].item.meaningGroupLabel).trim())
                ? escapeHtml(groupRun[0].item.meaningGroupLabel)
                : "Same meaning";
            const tintClass = getMeaningGroupTintClass(groupId);
            parts.push(html`
              <li class="review-meaning-group ${tintClass}">
                <div class="hint review-meaning-group-label">${groupLabel}</div>
                <ol class="review-meaning-group-list">
                  ${groupRun.map(({ item: runItem, index: runIdx }) => renderReviewSentenceItemHtml(runItem, runIdx, groupId)).join("")}
                </ol>
              </li>
            `);
        }
        idx = scan;
    }
    return parts.join("");
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
    removeFloatingSessionSquares();
    const isWeeklyCatchUp = isWeeklyCatchUpSession(session);
    const title = reviewSessionTitle(session);
    const description = reviewSessionDescription(session);
    loadReviewSessionProgress(session);
    appEl.innerHTML = html`
      <section class="container card review-session-page">
        <h2>${escapeHtml(title)}</h2>
        <p class="hint">
          Due: ${new Date(session.startAt).toLocaleString()} — ${session.items.length} sentence(s) to review.
          ${description ? ` ${escapeHtml(description)}` : ""}
        </p>
        <ol class="review-sentences-list">
          ${buildReviewSessionItemsHtml(session.items)}
        </ol>
        <div class="row review-session-actions">
          ${isWeeklyCatchUp ? "" : html`<button id="reviewSessionBackBtn" class="secondary">Back to dashboard</button>`}
          <button id="reviewSessionMinimizeBtn" class="secondary">Minimize</button>
          <button id="reviewSessionCompleteBtn">Mark as reviewed</button>
        </div>
      </section>
    `;

    const backBtn = document.getElementById("reviewSessionBackBtn");
    if (backBtn) {
        backBtn.addEventListener("click", () => {
            showBackToDashboardConfirmPopup(0, async () => {
                clearReviewSessionProgress(session.id);
                state.view = "dashboard";
                state.openSessionId = null;
                state.openSession = null;
                renderApp();
            });
        });
    }

    document.getElementById("reviewSessionMinimizeBtn").addEventListener("click", () => {
        minimizeReviewSession();
    });

    const completeBtn = document.getElementById("reviewSessionCompleteBtn");
    if (completeBtn) {
        completeBtn.addEventListener("click", () => {
            const incompleteCount = getIncompleteReviewItemCount(session);
            if (incompleteCount > 0) {
                const completedCount = session.items.length - incompleteCount;
                showIncompleteReviewWarningPopup(incompleteCount, () => completeOpenReviewSession(), completedCount);
                return;
            }
            completeOpenReviewSession();
        });
    }

    document.querySelectorAll("[data-review-speak-idx]").forEach((button) => {
        button.addEventListener("click", async () => {
            const idx = parseInt(button.getAttribute("data-review-speak-idx"), 10);
            const item = session.items[idx];
            if (!item || !item.content) return;
            const itemEl = appEl.querySelector(`.review-sentence-item[data-review-idx="${idx}"]`);
            showTtsProgressOnItem(itemEl);
            try {
                await speak(item.content, getAppLanguage());
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

    document.querySelectorAll("[data-review-context-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-context-idx"), 10);
            const item = session.items[idx];
            const listTitle = getSentenceListTitle(item);
            if (!listTitle) return;
            const isOpen = button.getAttribute("aria-expanded") === "true";
            closeReviewContextPopovers();
            setReviewContextPopoverOpen(button, !isOpen, listTitle);
        });
    });

    document.querySelectorAll("[data-review-more-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const isOpen = button.getAttribute("aria-expanded") === "true";
            setReviewExtraActionsOpen(button, !isOpen);
        });
    });

    document.querySelectorAll("[data-review-playphrase-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-playphrase-idx"), 10);
            const item = session.items[idx];
            openPlayphrasePopup(item ? item.content : "");
        });
    });

    document.querySelectorAll("[data-review-youglish-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-youglish-idx"), 10);
            const item = session.items[idx];
            openYouglish(item ? item.content : "");
        });
    });

    document.querySelectorAll("[data-review-naturalness-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-naturalness-idx"), 10);
            const item = session.items[idx];
            checkNaturalnessForText(item ? item.content : "", getSentenceListTitle(item));
        });
    });

    document.querySelectorAll("[data-review-edit-idx]").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = parseInt(button.getAttribute("data-review-edit-idx"), 10);
            const sentenceId = session.items[idx].sentenceId
            const sentence = session.items[idx].content;
            if (!sentence) return;
            if (!sentenceId) return;
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
            popup.innerHTML = `
                <h4>✏️ Edit sentence</h4>
                <textarea id="sentencePopupEditInput" rows="3">${escapeHtml(sentence)}</textarea>
                <div class="popup-actions">
                    <button type="button" class="secondary popup-cancel">Cancel</button>
                    <button type="button" class="popup-save">Save</button>
                </div>
            `;
            popup.querySelector(".popup-cancel").addEventListener("click", closeSentenceActionPopup);
            popup.querySelector(".popup-save").addEventListener("click", async () => {
                const content = popup.querySelector("#sentencePopupEditInput").value.trim();
                if (!content) return;
                try {
                    await api.editSentence(sentenceId, { content });
                } catch (e) {
                    notify(e.message || "Failed to save sentence.");
                    return;
                }
                closeSentenceActionPopup();
                session.items[idx].content = content;
                state.reviewSpeakCheckPart[idx] = 0;
                const row = appEl.querySelector(`.review-sentence-item[data-review-idx="${idx}"]`);
                const voiceEl = row?.querySelector(`.review-voice-result[data-review-voice-idx="${idx}"]`);
                if (voiceEl) {
                    voiceEl.className = "review-voice-result";
                    voiceEl.innerHTML = "";
                }
                await updateReviewItemStageDisplay(session, idx);
            });
            sentenceActionPopupEl.classList.add("is-open");
        });
    });

    rehydrateReviewSessionProgressUi(session);

    const sessionPage = appEl.querySelector(".review-session-page");
    if (sessionPage) {
        if (state.restoringMinimizedSession) {
            state.restoringMinimizedSession = false;
            sessionPage.classList.add("review-session-open");
            sessionPage.style.transition = "none";
            sessionPage.style.transform = "none";
            const rect = sessionPage.getBoundingClientRect();
            const fromTransform = computeMinimizeTransform(rect);
            sessionPage.style.transformOrigin = "top left";
            sessionPage.style.transform = fromTransform;
            sessionPage.style.opacity = "0";
            requestAnimationFrame(() => {
                sessionPage.style.transition = "";
                requestAnimationFrame(() => {
                    sessionPage.style.transform = "";
                    sessionPage.style.opacity = "";
                    const onRestored = (e) => {
                        if (e.target !== sessionPage || e.propertyName !== "transform") return;
                        sessionPage.removeEventListener("transitionend", onRestored);
                        sessionPage.style.transformOrigin = "";
                    };
                    sessionPage.addEventListener("transitionend", onRestored);
                });
            });
        } else {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => sessionPage.classList.add("review-session-open"));
            });
        }
    }

    mountScrollJumpControls();
}

const FLOATING_SESSION_SQUARE = { size: 64, rightMargin: 96, bottomMargin: 16, gap: 8 };

function getFloatingSquareRight(slotIndex) {
    const { rightMargin, size, gap } = FLOATING_SESSION_SQUARE;
    return rightMargin + slotIndex * (size + gap);
}

function computeFloatingSquareTargetRect(slotIndex) {
    const { size, bottomMargin } = FLOATING_SESSION_SQUARE;
    const right = getFloatingSquareRight(slotIndex);
    const left = window.innerWidth - right - size;
    const top = window.innerHeight - bottomMargin - size;
    return { left, top, size };
}

function computeMinimizeTransform(rect, slotIndex = 0) {
    const target = computeFloatingSquareTargetRect(slotIndex);
    const scale = target.size / rect.width;
    const tx = target.left - rect.left;
    const ty = target.top - rect.top;
    return `translate(${tx}px, ${ty}px) scale(${scale})`;
}

function minimizeReviewSession() {
    const session = state.openSession;
    if (!session) return;
    const weeklyCatchUp = isWeeklyCatchUpSession(session);
    if (!weeklyCatchUp) {
        state.minimizedSessionId = session.id;
        state.minimizedSession = session;
    }
    const sessionPage = appEl.querySelector(".review-session-page");
    if (!sessionPage) {
        state.view = "dashboard";
        renderApp();
        return;
    }
    sessionPage.style.transform = "none";
    const rect = sessionPage.getBoundingClientRect();
    const targetSlot = weeklyCatchUp && state.minimizedSession ? 1 : 0;
    const toTransform = computeMinimizeTransform(rect, targetSlot);
    sessionPage.style.transformOrigin = "top left";
    void sessionPage.offsetWidth;
    sessionPage.style.transform = toTransform;
    sessionPage.style.opacity = "0";
    const onMinimized = (e) => {
        if (e.target !== sessionPage || e.propertyName !== "transform") return;
        sessionPage.removeEventListener("transitionend", onMinimized);
        state.view = "dashboard";
        renderApp();
    };
    sessionPage.addEventListener("transitionend", onMinimized);
}

function restoreMinimizedSession() {
    if (state.minimizedSession && isWeeklyCatchUpSession(state.minimizedSession)) {
        state.minimizedSessionId = null;
        state.minimizedSession = null;
        return;
    }
    if (state.minimizedSessionId == null || !state.minimizedSession) return;
    const session = state.minimizedSession;
    removeFloatingSessionSquares();
    state.minimizedSessionId = null;
    state.minimizedSession = null;
    state.restoringMinimizedSession = true;
    state.view = "reviewSession";
    state.openSession = session;
    state.openSessionId = session.id;
    renderApp();
}

function removeFloatingSessionSquares() {
    const minimizedSquare = document.getElementById("minimizedSessionSquare");
    if (minimizedSquare) minimizedSquare.remove();
    const catchUpSquare = document.getElementById("weeklyCatchUpSessionSquare");
    if (catchUpSquare) catchUpSquare.remove();
}

function layoutFloatingSessionSquares() {
    let slot = 0;
    const minimizedSquare = document.getElementById("minimizedSessionSquare");
    if (minimizedSquare) {
        minimizedSquare.style.setProperty("--floating-square-right", `${getFloatingSquareRight(slot)}px`);
        slot += 1;
    }
    const catchUpSquare = document.getElementById("weeklyCatchUpSessionSquare");
    if (catchUpSquare) {
        catchUpSquare.style.setProperty("--floating-square-right", `${getFloatingSquareRight(slot)}px`);
    }
}

function mountMinimizedSessionSquare() {
    if (state.minimizedSession && isWeeklyCatchUpSession(state.minimizedSession)) {
        state.minimizedSessionId = null;
        state.minimizedSession = null;
    }
    if (state.minimizedSessionId == null || !state.minimizedSession) {
        const existing = document.getElementById("minimizedSessionSquare");
        if (existing) existing.remove();
        return;
    }
    let square = document.getElementById("minimizedSessionSquare");
    if (!square) {
        square = document.createElement("button");
        square.type = "button";
        square.id = "minimizedSessionSquare";
        square.className = "floating-session-square minimized-session-square is-appearing";
        square.title = "Restore minimized review session";
        square.setAttribute("aria-label", "Restore minimized review session");
        square.textContent = "⤢";
        square.addEventListener("click", () => restoreMinimizedSession());
        document.body.appendChild(square);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => square.classList.remove("is-appearing"));
        });
    }
}

async function openWeeklyCatchUpSession() {
    const session = getWeeklyCatchUpPendingSession();
    if (!session) return;
    await openPendingSession(session);
}

function mountWeeklyCatchUpSessionSquare() {
    const session = getWeeklyCatchUpPendingSession();
    if (!session) {
        const existing = document.getElementById("weeklyCatchUpSessionSquare");
        if (existing) existing.remove();
        return;
    }
    let square = document.getElementById("weeklyCatchUpSessionSquare");
    if (!square) {
        square = document.createElement("button");
        square.type = "button";
        square.id = "weeklyCatchUpSessionSquare";
        square.className = "floating-session-square weekly-catch-up-square is-appearing";
        square.title = "Open weekly catch-up review session";
        square.setAttribute("aria-label", "Open weekly catch-up review session");
        square.textContent = "⚠";
        square.addEventListener("click", () => {
            openWeeklyCatchUpSession();
        });
        document.body.appendChild(square);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => square.classList.remove("is-appearing"));
        });
    }
}

function mountFloatingSessionSquares() {
    mountMinimizedSessionSquare();
    mountWeeklyCatchUpSessionSquare();
    layoutFloatingSessionSquares();
}

const NUMBER_WORDS = {
    zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
    ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16",
    seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50",
    sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100", thousand: "1000"
};
const TENS_WORDS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ONES_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EN_HOMOPHONE_GROUPS = [
    ["shoe", "shoo"],
    ["their", "there", "theyre"],
    ["write", "right"],
    ["suite", "sweet"],
    ["wear", "where"],
    ["waist", "waste"],
    ["son", "sun"],
    ["peace", "piece"],
    ["to", "too", "two"],
    ["for", "four"],
    ["hear", "here"],
    ["one", "won"],
    ["no", "know"],
    ["sea", "see"],
    ["be", "bee"],
    ["break", "brake"],
    ["our", "hour"],
    ["tart", "taut", "taught"],
    ["bare", "bear"],
    ["site", "sight"],
    ["too","two"],
    ["iffy", "ithy"] // not a homophone; Web Speech API commonly mishears "iffy" as "ithy"
];
const EN_HOMOPHONE_INDEX = {};
EN_HOMOPHONE_GROUPS.forEach((group, idx) => {
    group.forEach((word) => {
        EN_HOMOPHONE_INDEX[word] = idx;
    });
});

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

function stripDiacritics(text) {
    return (text || "").normalize("NFD").replace(/\p{M}/gu, "");
}

function normalizeForComparison(text) {
    const t = (text || "").trim().toLowerCase().replace(/\s+/g, " ");
    // Remove apostrophes first so "friend's" and "friends'" both become "friends", "don't" becomes "dont"
    const noApostrophe = t.replace(/['\u2018\u2019`]/g, "");
    // Then strip remaining punctuation and collapse spaces
    const cleaned = noApostrophe.replace(/[\s.,?!;:"\u201c\u201d\-—–()\[\]{}]+/g, " ").replace(/\s+/g, " ").trim();
    const normalized = getAppLanguage() === "sr" ? stripDiacritics(cleaned) : cleaned;
    // Convert number words to digits so "five" matches "5", "twelve" matches "12", "twenty one" matches "21"
    return normalizeNumberWordsToDigits(normalized);
}

function splitComparableWords(text) {
    return (text || "").split(/\s+/).filter(Boolean);
}

function areHomophoneEquivalentWord(expectedWord, heardWord) {
    if (expectedWord === heardWord) return true;
    if (getAppLanguage() !== "en") return false;
    const expectedGroup = EN_HOMOPHONE_INDEX[expectedWord];
    if (expectedGroup == null) return false;
    return expectedGroup === EN_HOMOPHONE_INDEX[heardWord];
}

function areHomophoneEquivalentNormalized(expectedNormalized, heardNormalized) {
    const expectedWords = splitComparableWords(expectedNormalized);
    const heardWords = splitComparableWords(heardNormalized);
    if (!expectedWords.length || expectedWords.length !== heardWords.length) return false;
    for (let i = 0; i < expectedWords.length; i++) {
        if (!areHomophoneEquivalentWord(expectedWords[i], heardWords[i])) return false;
    }
    return true;
}

function isVoiceMatch(expectedNormalized, heardText) {
    const heardNormalized = normalizeForComparison(heardText);
    if (!expectedNormalized || !heardNormalized) return false;
    return heardNormalized === expectedNormalized ||
        areHomophoneEquivalentNormalized(expectedNormalized, heardNormalized);
}

function isSafariOrAppleWebKit() {
    if (typeof navigator === "undefined") return false;
    return (navigator.vendor && navigator.vendor.indexOf("Apple") > -1) ||
        (/Safari/i.test(navigator.userAgent) && !/Chrome|Chromium/i.test(navigator.userAgent));
}

/** Word count for timing heuristics (plain text sentence). */
function estimateVoiceCheckWordCount(sentenceContent) {
    return (sentenceContent || "").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Max time (ms) to keep listening so longer sentences can be spoken.
 * Based on assumed speaking rate + read/think buffer, clamped for UX.
 */
function estimateVoiceCheckListenBudgetMs(sentenceContent) {
    const words = estimateVoiceCheckWordCount(sentenceContent);
    const assumedWpm = 95;
    const safety = 1.45;
    const readBaseMs = 1800;
    const readPerWordMs = 120;
    const speakMs = (words / assumedWpm) * safety * 60 * 1000;
    const readMs = readBaseMs + Math.min(words * readPerWordMs, 4500);
    const total = Math.round(speakMs + readMs);
    return Math.min(35000, Math.max(5000, total));
}

/**
 * Safari/WebKit: longer prep countdown before prompting to speak (mic is already on).
 */
function estimateVoiceCheckPrepMs(sentenceContent) {
    const words = estimateVoiceCheckWordCount(sentenceContent);
    return Math.round(Math.min(10000, Math.max(2000, 1600 + words * 380)));
}

function getReviewVoiceCheckParts(content) {
    const text = String(content || "").trim();
    if (!text) return [];
    const parts = [];
    let start = 0;
    const boundaryRegex = /[;!?]+|\.(?=\s+|$)/g;
    let match;

    while ((match = boundaryRegex.exec(text)) !== null) {
        const end = match.index + match[0].length;
        const part = text.slice(start, end).trim();
        if (normalizeForComparison(part)) parts.push(part);
        start = end;
    }

    const tail = text.slice(start).trim();
    if (normalizeForComparison(tail)) parts.push(tail);
    return parts.length ? parts : [text];
}

function getReviewVoiceCheckPartIndex(parts, partIndex) {
    const count = parts?.length || 0;
    if (count <= 1) return 0;
    const n = Number(partIndex);
    if (!Number.isFinite(n)) return 0;
    return Math.min(count - 1, Math.max(0, Math.trunc(n)));
}

function getReviewVoiceCheckPartLabel(parts, partIndex) {
    return parts.length > 1 ? `Part ${partIndex + 1} of ${parts.length}` : "";
}

let reviewVoicePlaybackUrl = null;
let reviewVoicePlaybackRequestId = 0;

function clearReviewVoiceRecordingPlayback() {
    document.querySelectorAll(".review-voice-playback").forEach((el) => {
        const audio = el.querySelector("audio");
        if (audio) {
            audio.pause();
            audio.removeAttribute("src");
            try { audio.load(); } catch (_) { /* ignore */ }
        }
        el.remove();
    });
    if (reviewVoicePlaybackUrl) {
        URL.revokeObjectURL(reviewVoicePlaybackUrl);
        reviewVoicePlaybackUrl = null;
    }
}

function getPreferredReviewRecordingMimeType() {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
        return "";
    }
    return [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4"
    ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startReviewVoiceRecording() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return null;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        const mimeType = getPreferredReviewRecordingMimeType();
        const recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);
        let stopPromise = null;

        recorder.addEventListener("dataavailable", (event) => {
            if (event.data && event.data.size > 0) chunks.push(event.data);
        });
        recorder.start();

        return {
            stop() {
                if (stopPromise) return stopPromise;
                stopPromise = new Promise((resolve) => {
                    let done = false;
                    const finish = () => {
                        if (done) return;
                        done = true;
                        stream.getTracks().forEach((track) => track.stop());
                        if (!chunks.length) {
                            resolve(null);
                            return;
                        }
                        resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0].type || "audio/webm" }));
                    };
                    recorder.addEventListener("stop", finish, { once: true });
                    try {
                        if (recorder.state === "inactive") {
                            finish();
                        } else {
                            recorder.stop();
                        }
                    } catch (_) {
                        finish();
                    }
                });
                return stopPromise;
            }
        };
    } catch (_) {
        return null;
    }
}

function appendReviewVoiceRecordingPlayback(resultEl, recordingBlob) {
    if (!resultEl || !recordingBlob || recordingBlob.size <= 0) return;
    if (reviewVoicePlaybackUrl) URL.revokeObjectURL(reviewVoicePlaybackUrl);
    reviewVoicePlaybackUrl = URL.createObjectURL(recordingBlob);

    const playbackEl = document.createElement("div");
    playbackEl.className = "review-voice-playback";

    const listenBtn = document.createElement("button");
    listenBtn.type = "button";
    listenBtn.className = "secondary review-voice-playback-button";
    listenBtn.textContent = "Listen to your recording";

    const audioEl = document.createElement("audio");
    audioEl.src = reviewVoicePlaybackUrl;
    audioEl.preload = "metadata";

    listenBtn.addEventListener("click", async () => {
        audioEl.currentTime = 0;
        try {
            await audioEl.play();
        } catch (_) {
            // Some browsers block playback until another user gesture; the click above usually satisfies it.
        }
    });

    playbackEl.appendChild(listenBtn);
    playbackEl.appendChild(audioEl);
    resultEl.appendChild(playbackEl);
}

async function runVoiceCheck(expectedContent, resultEl, buttonEl, onCheckEnd, options = {}) {
    if (!expectedContent || !resultEl || !buttonEl) return;

    const playbackRequestId = ++reviewVoicePlaybackRequestId;
    clearReviewVoiceRecordingPlayback();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        notify("Voice recognition is not supported in this browser. Try Chrome or Edge.");
        return;
    }

    resultEl.className = "review-voice-result review-voice-listening";
    resultEl.style.display = "block";
    const isSafari = isSafariOrAppleWebKit();
    const prepMs = estimateVoiceCheckPrepMs(expectedContent);
    const listenBudgetMs = estimateVoiceCheckListenBudgetMs(expectedContent);
    const prepSeconds = Math.max(1, Math.ceil(prepMs / 1000));
    const partLabel = options.partLabel ? String(options.partLabel) : "";
    const targetName = partLabel ? "this part" : "the sentence";
    const baseListeningHint = isSafari
        ? `Preparing… Speak ${targetName} in ${prepSeconds}…`
        : `Listening… Speak ${targetName}.`;
    const initialListeningHint = partLabel ? `${partLabel}: ${baseListeningHint}` : baseListeningHint;
    resultEl.innerHTML = `<div class="review-voice-listening-row">
<span class="review-voice-status">Preparing microphone…</span>
<button type="button" class="secondary review-voice-done" title="Stop listening and check what was heard">Done speaking</button>
</div>`;
    const listeningStatusEl = resultEl.querySelector(".review-voice-status");
    const doneSpeakingBtn = resultEl.querySelector(".review-voice-done");
    doneSpeakingBtn.disabled = true;
    buttonEl.disabled = true;

    const expected = normalizeForComparison(expectedContent);
    const recognition = new SpeechRecognition();
    recognition.lang = getSpeechLocale(getAppLanguage());
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    let aggregatedFinalTranscript = "";
    /** Last final segment from the recognition session (for alternate transcripts when scoring). */
    let lastFinalSpeechResult = null;
    let sessionFinalized = false;
    let warmupTimeouts = [];
    let listenCapTimer = null;
    let voiceRecording = null;

    const setListeningHint = (text) => {
        if (listeningStatusEl) listeningStatusEl.textContent = text;
    };

    const clearVoiceCheckTimers = () => {
        warmupTimeouts.forEach((t) => clearTimeout(t));
        warmupTimeouts = [];
        if (listenCapTimer != null) {
            clearTimeout(listenCapTimer);
            listenCapTimer = null;
        }
    };

    const stopRecognition = () => {
        clearVoiceCheckTimers();
        try {
            if (isSafariOrAppleWebKit()) {
                try { recognition.start(); } catch (_) { /* ignore */ }
            }
            recognition.stop();
        } catch (_) { /* already stopped */ }
    };

    const finish = (match) => {
        buttonEl.disabled = false;
        recordVoiceCheckStats(options.stats, match);
        if (typeof onCheckEnd === "function") onCheckEnd(!!match);
    };

    const appendRecordingIfCurrent = async () => {
        const recording = voiceRecording;
        voiceRecording = null;
        if (!recording) return;
        const blob = await recording.stop();
        if (playbackRequestId === reviewVoicePlaybackRequestId) {
            appendReviewVoiceRecordingPlayback(resultEl, blob);
        }
    };

    const applyResultUi = async (match, transcript) => {
        resultEl.className = "review-voice-result " + (match ? "review-voice-match" : "review-voice-mismatch");
        const partHtml = partLabel ? `<div class="review-voice-part-label">${escapeHtml(partLabel)}</div>` : "";
        if (match) {
            resultEl.innerHTML = `${partHtml}✓ Match! You said it correctly.`;
        } else {
            resultEl.innerHTML = `${partHtml}✗ You said: <strong>${escapeHtml(transcript.trim() || "(no speech heard)")}</strong><br>Expected: ${escapeHtml(expectedContent)}`;
        }
        await appendRecordingIfCurrent();
        finish(match);
    };

    const finalizeListeningOutcome = async () => {
        if (sessionFinalized) return;
        if (!resultEl.classList.contains("review-voice-listening")) return;
        sessionFinalized = true;
        resultEl.classList.remove("review-voice-listening");
        stopRecognition();
        const { match, transcript } = tryMatchFromAggregatedAndLastFinal(lastFinalSpeechResult);
        await applyResultUi(match, transcript);
    };

    doneSpeakingBtn.addEventListener("click", () => finalizeListeningOutcome());

    const tryMatchFromAggregatedAndLastFinal = (lastFinal) => {
        if (isVoiceMatch(expected, aggregatedFinalTranscript)) {
            return { match: true, transcript: aggregatedFinalTranscript };
        }
        let transcript = "";
        let match = false;
        if (lastFinal) {
            for (let i = 0; i < lastFinal.length; i++) {
                const alt = lastFinal[i] && lastFinal[i].transcript;
                if (alt) {
                    if (i === 0) transcript = alt;
                    if (isVoiceMatch(expected, alt)) {
                        match = true;
                        if (!transcript) transcript = alt;
                        break;
                    }
                }
            }
            if (!match && transcript) {
                match = isVoiceMatch(expected, transcript);
            }
        }
        return { match, transcript: transcript || aggregatedFinalTranscript };
    };

    recognition.onresult = async (event) => {
        const results = event.results;
        for (let i = event.resultIndex; i < results.length; i++) {
            const r = results[i];
            if (r.isFinal) {
                const piece = r[0] && r[0].transcript;
                if (piece) aggregatedFinalTranscript += piece + " ";
            }
        }
        let lastFinal = null;
        for (let i = results.length - 1; i >= 0; i--) {
            if (results[i].isFinal) {
                lastFinal = results[i];
                break;
            }
        }
        if (!lastFinal) return;
        lastFinalSpeechResult = lastFinal;
        const { match, transcript } = tryMatchFromAggregatedAndLastFinal(lastFinal);
        if (!match) return;
        sessionFinalized = true;
        resultEl.classList.remove("review-voice-listening");
        stopRecognition();
        await applyResultUi(true, transcript);
    };

    recognition.onerror = async (event) => {
        sessionFinalized = true;
        stopRecognition();
        resultEl.className = "review-voice-result review-voice-mismatch";
        const msg = event.error === "no-speech" ? "No speech heard. Try again." : (event.error === "not-allowed" ? "Microphone access denied." : `Error: ${event.error}`);
        resultEl.textContent = msg;
        await appendRecordingIfCurrent();
        finish(false);
    };

    recognition.onend = async () => {
        if (resultEl.classList.contains("review-voice-listening")) {
            sessionFinalized = true;
            clearVoiceCheckTimers();
            resultEl.className = "review-voice-result review-voice-mismatch";
            resultEl.textContent = "Recognition ended. Click 🎤 to try again.";
            await appendRecordingIfCurrent();
            finish(false);
        }
    };

    try {
        const recording = await startReviewVoiceRecording();
        if (playbackRequestId !== reviewVoicePlaybackRequestId || sessionFinalized) {
            if (recording) await recording.stop();
            resultEl.className = "review-voice-result";
            resultEl.innerHTML = "";
            buttonEl.disabled = false;
            return;
        }
        voiceRecording = recording;
        setListeningHint(initialListeningHint);
        recognition.start();
        doneSpeakingBtn.disabled = false;
        const capDelayMs = (isSafari ? prepMs : 0) + listenBudgetMs;
        listenCapTimer = setTimeout(() => {
            listenCapTimer = null;
            finalizeListeningOutcome();
        }, capDelayMs);

        if (isSafari) {
            const t1 = Math.round(prepMs / 3);
            const t2 = Math.round((2 * prepMs) / 3);
            warmupTimeouts.push(setTimeout(() => {
                if (resultEl.classList.contains("review-voice-listening")) setListeningHint("Preparing… almost…");
            }, t1));
            warmupTimeouts.push(setTimeout(() => {
                if (resultEl.classList.contains("review-voice-listening")) setListeningHint("Preparing… get ready…");
            }, t2));
            warmupTimeouts.push(setTimeout(() => {
                if (resultEl.classList.contains("review-voice-listening")) setListeningHint("Now speak the sentence.");
            }, prepMs));
        }
    } catch (e) {
        sessionFinalized = true;
        clearVoiceCheckTimers();
        resultEl.className = "review-voice-result review-voice-mismatch";
        resultEl.textContent = "Could not start voice recognition: " + (e.message || "unknown error");
        await appendRecordingIfCurrent();
        finish(false);
    }
}

function getIncompleteReviewItemCount(session) {
    const count = session?.items?.length ?? 0;
    let incomplete = 0;
    for (let idx = 0; idx < count; idx++) {
        if (!state.reviewCompletedItems[idx]) incomplete++;
    }
    return incomplete;
}

async function completeOpenReviewSession() {
    const session = state.openSession;
    if (!session) return;
    const completedSentenceIds = session.items
        .filter((_, idx) => !!state.reviewCompletedItems[idx])
        .map((item) => item.sentenceId);
    if (completedSentenceIds.length === 0) {
        notify("No sentences were marked reviewed — nothing was submitted.");
        return;
    }
    const remainingCount = session.items.length - completedSentenceIds.length;
    const sessionPage = appEl.querySelector(".review-session-page");
    const completeBtn = document.getElementById("reviewSessionCompleteBtn");
    try {
        if (completeBtn) {
            completeBtn.disabled = true;
            completeBtn.textContent = "Marking…";
        }
        await api.completeReviewSession(session.id, completedSentenceIds);
        state.statsOverview = null;
        if (remainingCount > 0) {
            notify(remainingCount === 1
                ? `Saved ${completedSentenceIds.length} reviewed. 1 sentence will come up in a future session.`
                : `Saved ${completedSentenceIds.length} reviewed. ${remainingCount} sentences will come up in a future session.`);
        }
        if (sessionPage) {
            sessionPage.classList.add("review-session-completing");
            let navigated = false;
            const done = () => {
                if (navigated) return;
                navigated = true;
                if (state.minimizedSessionId === session.id) {
                    state.minimizedSessionId = null;
                    state.minimizedSession = null;
                }
                clearReviewSessionProgress(session.id);
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
            if (state.minimizedSessionId === session.id) {
                state.minimizedSessionId = null;
                state.minimizedSession = null;
            }
            clearReviewSessionProgress(session.id);
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
    updateReviewSpeakCheckButtonTitle(session, idx, buttonEl);
}

function updateReviewSpeakCheckButtonTitle(session, idx, buttonEl = null) {
    const stage = state.reviewSpeakCheckStage[idx] ?? 1;
    const item = session?.items?.[idx];
    const targetButton = buttonEl || document.querySelector(`[data-review-speak-check-idx="${idx}"]`);
    if (!targetButton || !item?.content) return;
    const titles = { 1: "Speak and check (stage 1: full sentence)", 2: "Speak and check (stage 2: verbs hidden)", 3: "Speak and check (stage 3: from memory)" };
    const parts = getReviewVoiceCheckParts(item.content);
    const partIndex = getReviewVoiceCheckPartIndex(parts, state.reviewSpeakCheckPart[idx]);
    const partText = getReviewVoiceCheckPartLabel(parts, partIndex);
    targetButton.title = partText
        ? `${titles[stage] || "Speak and check"} - ${partText.toLowerCase()}`
        : (titles[stage] || "Speak and check");
}

function advanceReviewStage(session, idx) {
    const current = state.reviewSpeakCheckStage[idx] ?? 1;
    if (current === 3) {
        state.reviewCompletedItems[idx] = true;
        const li = document.querySelector(`.review-sentence-item[data-review-idx="${idx}"]`);
        if (li) li.classList.add("review-sentence-item-completed");
    }
    state.reviewSpeakCheckPart[idx] = 0;
    state.reviewSpeakCheckStage[idx] = current === 3 ? 1 : current + 1;
    updateReviewItemStageDisplay(session, idx);
}

function appendReviewVoiceNextPartHint(resultEl, text) {
    if (!resultEl || !text) return;
    const hint = document.createElement("div");
    hint.className = "review-voice-next-part";
    hint.textContent = text;
    resultEl.appendChild(hint);
}

function completeReviewVoiceCheckPart(session, idx, parts, partIndex, resultEl) {
    if (parts.length > 1 && partIndex < parts.length - 1) {
        state.reviewSpeakCheckPart[idx] = partIndex + 1;
        updateReviewSpeakCheckButtonTitle(session, idx);
        appendReviewVoiceNextPartHint(resultEl, `Click the microphone for part ${partIndex + 2} of ${parts.length}.`);
        return;
    }
    state.reviewSpeakCheckPart[idx] = 0;
    advanceReviewStage(session, idx);
}

/**
 * Appends a skip button to the result element when speech was not recognized.
 * @param {HTMLElement} resultEl - The voice result container
 * @param {() => void} onSkip - Called when user clicks skip
 */
function showSkipStageButton(resultEl, onSkip, label = "Skip this stage") {
    if (!resultEl) return;
    const existing = resultEl.querySelector(".review-skip-stage");
    if (existing) return;
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "review-skip-stage";
    skipBtn.textContent = label;
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
    const sentenceId = item.sentenceId;
    const parts = getReviewVoiceCheckParts(item.content);
    const partIndex = getReviewVoiceCheckPartIndex(parts, state.reviewSpeakCheckPart[idx]);
    const expectedPart = parts[partIndex] || item.content;
    const partLabel = getReviewVoiceCheckPartLabel(parts, partIndex);
    const stage = state.reviewSpeakCheckStage[idx] ?? 1;
    const attemptNumber = getNextVoiceAttemptNumber(sentenceId);
    const onCheckEnd = (match) => {
        if (match) {
            resetVoiceAttemptNumber(sentenceId);
            completeReviewVoiceCheckPart(session, idx, parts, partIndex, resultEl);
        } else {
            const skipLabel = parts.length > 1 ? "Skip this part" : "Skip this stage";
            showSkipStageButton(resultEl, () => {
                resetVoiceAttemptNumber(sentenceId);
                completeReviewVoiceCheckPart(session, idx, parts, partIndex, resultEl);
            }, skipLabel);
        }
    };
    runVoiceCheck(expectedPart, resultEl, buttonEl, onCheckEnd, {
        partLabel,
        stats: {
            sentenceId,
            reviewSessionId: session?.id || null,
            attemptNumber,
            stage,
            partIndex,
            partCount: parts.length,
            source: "REVIEW"
        }
    });
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
    updateTestReviewSpeakCheckButtonTitle(sentence, speakCheckBtn);
}

function updateTestReviewSpeakCheckButtonTitle(sentence, speakCheckBtn = null) {
    const stage = state.testReviewStage;
    const targetButton = speakCheckBtn || testReviewPopupEl?.querySelector(".test-review-speak-check");
    if (!targetButton || !sentence?.content) return;
    const titles = { 1: "Speak and check (stage 1: full sentence)", 2: "Speak and check (stage 2: verbs hidden)", 3: "Speak and check (stage 3: from memory)" };
    const parts = getReviewVoiceCheckParts(sentence.content);
    const partIndex = getReviewVoiceCheckPartIndex(parts, state.testReviewPart);
    const partText = getReviewVoiceCheckPartLabel(parts, partIndex);
    targetButton.title = partText
        ? `${titles[stage] || "Speak and check"} - ${partText.toLowerCase()}`
        : (titles[stage] || "Speak and check");
}

function advanceTestReviewStage(sentence) {
    state.testReviewPart = 0;
    state.testReviewStage = state.testReviewStage === 3 ? 1 : state.testReviewStage + 1;
    updateTestReviewStageDisplay(sentence);
}

async function refreshPendingReviewsAfterInlineSentenceReview() {
    state.pendingSessions = await api.getPendingReviews();
    const reviewsHeading = document.querySelector("[data-pending-reviews-heading]");
    if (reviewsHeading) reviewsHeading.textContent = `Pending Reviews (${getDueUnreadSessions().length})`;
    if (document.getElementById("pendingReviews")) {
        await renderPendingReviews();
    }
    mountFloatingSessionSquares();
}

function appendTestReviewCompletionHint(resultEl, text) {
    if (!resultEl || !text) return;
    const existing = resultEl.querySelector(".test-review-completion-hint");
    if (existing) existing.remove();
    const hint = document.createElement("div");
    hint.className = "review-voice-next-part test-review-completion-hint";
    hint.textContent = text;
    resultEl.appendChild(hint);
}

async function recordCompletedListTestReview(sentence, resultEl) {
    if (!sentence?.id) return;
    try {
        const result = await api.completeSentenceReview(sentence.id);
        if (!result?.recorded) return;
        const reviewCount = Number(result.reviewCount);
        if (Number.isFinite(reviewCount)) {
            sentence.reviewCount = reviewCount;
            updateSentenceInState({ ...sentence, reviewCount });
        }
        state.statsOverview = null;
        await refreshPendingReviewsAfterInlineSentenceReview();
        appendTestReviewCompletionHint(resultEl, result.reason === "INITIAL"
            ? "Initial review counted."
            : "Due review counted.");
    } catch (err) {
        notify(err.message || "Could not record this review.");
        throw err;
    }
}

function completeTestReviewVoiceCheckPart(sentence, parts, partIndex, resultEl) {
    if (parts.length > 1 && partIndex < parts.length - 1) {
        state.testReviewPart = partIndex + 1;
        updateTestReviewSpeakCheckButtonTitle(sentence);
        appendReviewVoiceNextPartHint(resultEl, `Click the microphone for part ${partIndex + 2} of ${parts.length}.`);
        return false;
    }
    const completedStage = state.testReviewStage;
    advanceTestReviewStage(sentence);
    return completedStage === 3;
}

function openTestReviewPopup(sentenceId) {
    const sentence = findSentenceById(sentenceId);
    if (!sentence || !sentence.content) return;

    state.testReviewStage = 1;
    state.testReviewPart = 0;

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
    let reviewCompletionChecked = false;

    const maybeRecordCompletedReview = (completedFullReview) => {
        if (!completedFullReview || reviewCompletionChecked) return;
        reviewCompletionChecked = true;
        recordCompletedListTestReview(sentence, resultEl).catch(() => {
            reviewCompletionChecked = false;
        });
    };

    sentenceEl.innerHTML = renderSentenceWithWordLinks(sentence.content);
    updateTestReviewSpeakCheckButtonTitle(sentence, speakCheckBtn);

    listenBtn.addEventListener("click", async () => {
        showTtsProgress();
        try {
            await speak(sentence.content, getAppLanguage());
        } finally {
            hideTtsProgress();
        }
    });

    const onCheckEnd = (match, parts, partIndex) => {
        if (match) {
            const completedFullReview = completeTestReviewVoiceCheckPart(sentence, parts, partIndex, resultEl);
            maybeRecordCompletedReview(completedFullReview);
        } else {
            const skipLabel = parts.length > 1 ? "Skip this part" : "Skip this stage";
            showSkipStageButton(resultEl, () => {
                resetVoiceAttemptNumber(sentence.id);
                const completedFullReview = completeTestReviewVoiceCheckPart(sentence, parts, partIndex, resultEl);
                maybeRecordCompletedReview(completedFullReview);
            }, skipLabel);
        }
    };
    speakCheckBtn.addEventListener("click", () => {
        const parts = getReviewVoiceCheckParts(sentence.content);
        const partIndex = getReviewVoiceCheckPartIndex(parts, state.testReviewPart);
        const expectedPart = parts[partIndex] || sentence.content;
        const partLabel = getReviewVoiceCheckPartLabel(parts, partIndex);
        const attemptNumber = getNextVoiceAttemptNumber(sentence.id);
        runVoiceCheck(expectedPart, resultEl, speakCheckBtn, (match) => {
            if (match) resetVoiceAttemptNumber(sentence.id);
            onCheckEnd(match, parts, partIndex);
        }, {
            partLabel,
            stats: {
                sentenceId: sentence.id,
                reviewSessionId: null,
                attemptNumber,
                stage: state.testReviewStage,
                partIndex,
                partCount: parts.length,
                source: "TEST"
            }
        });
    });

    testReviewPopupEl.querySelector(".test-review-close").addEventListener("click", closeTestReviewPopup);

    testReviewPopupEl.classList.add("is-open");
}

function buildSessionPreviewHtml(items) {
    const sentences = (items || [])
        .map((it) => (it && it.content ? String(it.content).trim() : ""))
        .filter((s) => s);
    if (sentences.length === 0) {
        return "<div class='pending-review-preview-line hint'>(no sentences)</div>";
    }
    let lines;
    if (sentences.length <= 4) {
        lines = sentences.map((s) => escapeHtml(s));
    } else {
        lines = [
            escapeHtml(sentences[0]),
            escapeHtml(sentences[1]),
            "…",
            escapeHtml(sentences[sentences.length - 2]),
            escapeHtml(sentences[sentences.length - 1]),
        ];
    }
    return lines
        .map((line) => line === "…"
            ? "<div class='pending-review-preview-line pending-review-preview-ellipsis'>…</div>"
            : `<div class="pending-review-preview-line">${line}</div>`)
        .join("");
}

async function openPendingSession(session) {
    if (!session || !session.id) return;
    try {
        await api.openReviewSession(session.id);
    } catch (e) {
        notify(e.message || "Could not open review session.");
        return;
    }
    state.view = "reviewSession";
    state.openSessionId = session.id;
    state.openSession = session;
    renderApp();
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
        : state.pendingSessions.map((session, index) => html`
            <div class="card pending-review-item pending-review-color-${index % 5} ${isInitialReviewSession(session) ? "pending-review-initial" : ""}">
              <div class="pending-review-info">
                <div class="pending-review-title">${escapeHtml(reviewSessionTitle(session))}</div>
                <div class="pending-review-preview">${buildSessionPreviewHtml(session.items)}</div>
                <div class="pending-review-meta">
                  ${new Date(session.startAt).toLocaleString()} (${session.items.length} sentences)
                  ${isWeeklyCatchUpSession(session) ? " • Weekly catch-up" : ""}
                  ${isInitialReviewSession(session) ? " • New sentences" : ""}
                </div>
              </div>
              <div class="pending-review-actions">
                <button data-session-open="${session.id}" class="secondary">${escapeHtml(reviewSessionOpenLabel(session))}</button>
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
            openPendingSession(session);
        });
    });
    container.querySelectorAll("[data-session-complete]").forEach((button) => {
        button.addEventListener("click", () => {
            const id = Number(button.getAttribute("data-session-complete"));
            showMarkReviewedConfirmPopup(id, async () => {
                const card = button.closest(".pending-review-item");
                try {
                    await api.completeReviewSession(id);
                    state.statsOverview = null;
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

let incompleteReviewWarningEl = null;

function showIncompleteReviewWarningPopup(incompleteCount, onConfirm, completedCount = 0) {
    const incompletePart = incompleteCount === 1
        ? "1 sentence hasn't completed all 3 practice stages."
        : `${incompleteCount} sentences haven't completed all 3 practice stages.`;
    const remainderPart = incompleteCount === 1
        ? "It'll be saved for a future review session"
        : "They'll be saved for a future review session";
    const message = completedCount > 0
        ? `${incompletePart} ${remainderPart} — mark the rest as reviewed now?`
        : `${incompletePart} Nothing will be submitted unless at least one sentence completes its practice.`;
    if (!incompleteReviewWarningEl) {
        incompleteReviewWarningEl = document.createElement("div");
        incompleteReviewWarningEl.className = "sentence-action-popup-backdrop mark-reviewed-confirm-backdrop";
        incompleteReviewWarningEl.innerHTML = `
          <div class="sentence-action-popup mark-reviewed-confirm-popup incomplete-review-warning-popup">
            <h4>Incomplete practice</h4>
            <p class="mark-reviewed-confirm-message incomplete-review-warning-message"></p>
            <div class="popup-actions">
              <button type="button" class="secondary popup-cancel">Cancel</button>
              <button type="button" class="popup-confirm incomplete-review-warning-confirm-btn">Mark as reviewed</button>
            </div>
          </div>
        `;
        incompleteReviewWarningEl.addEventListener("click", (e) => {
            if (e.target === incompleteReviewWarningEl) closeIncompleteReviewWarningPopup();
        });
        document.body.appendChild(incompleteReviewWarningEl);
    }
    const messageEl = incompleteReviewWarningEl.querySelector(".incomplete-review-warning-message");
    if (messageEl) messageEl.textContent = message;
    const popup = incompleteReviewWarningEl.querySelector(".mark-reviewed-confirm-popup");
    const cancelBtn = popup.querySelector(".popup-cancel");
    const confirmBtn = popup.querySelector(".incomplete-review-warning-confirm-btn");
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    const newCancel = popup.querySelector(".popup-cancel");
    const newConfirm = popup.querySelector(".incomplete-review-warning-confirm-btn");
    newCancel.addEventListener("click", () => closeIncompleteReviewWarningPopup());
    newConfirm.addEventListener("click", () => {
        closeIncompleteReviewWarningPopup();
        onConfirm();
    });
    incompleteReviewWarningEl.classList.add("is-visible");
    requestAnimationFrame(() => {
        requestAnimationFrame(() => incompleteReviewWarningEl.classList.add("is-open"));
    });
}

function closeIncompleteReviewWarningPopup() {
    if (!incompleteReviewWarningEl) return;
    incompleteReviewWarningEl.classList.remove("is-open");
    setTimeout(() => incompleteReviewWarningEl.classList.remove("is-visible"), 320);
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

    const retryStatsBtn = document.getElementById("retryStatsBtn");
    if (retryStatsBtn) {
        retryStatsBtn.addEventListener("click", () => ensureStatsOverviewLoaded(true));
    }

    const retryExcludedBtn = document.getElementById("retryExcludedBtn");
    if (retryExcludedBtn) {
        retryExcludedBtn.addEventListener("click", () => ensureExcludedSentencesLoaded(true));
    }

    bindListItemActions();

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
                await refreshAndRender({ refreshReviewSessions: true });
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
            const sentence = findSentenceById(sentenceId);
            openPlayphrasePopup(sentence ? sentence.content : "");
        });
    });

    document.querySelectorAll("[data-sentence-youglish]").forEach((button) => {
        button.addEventListener("click", () => {
            const sentenceId = Number(button.getAttribute("data-sentence-youglish"));
            const sentence = findSentenceById(sentenceId);
            openYouglish(sentence ? sentence.content : "");
        });
    });

    document.querySelectorAll("[data-sentence-group]").forEach((button) => {
        button.addEventListener("click", () => {
            openMeaningGroupForSentence(Number(button.getAttribute("data-sentence-group")));
        });
    });

    document.querySelectorAll("[data-sentence-unlink]").forEach((button) => {
        button.addEventListener("click", () => {
            sentenceUnlink(Number(button.getAttribute("data-sentence-unlink")));
        });
    });

    document.querySelectorAll("[data-sentence-test-review]").forEach((button) => {
        button.addEventListener("click", () => openTestReviewPopup(Number(button.getAttribute("data-sentence-test-review"))));
    });

    document.querySelectorAll("[data-sentence-naturalness]").forEach((button) => {
        button.addEventListener("click", () => sentenceNaturalness(Number(button.getAttribute("data-sentence-naturalness"))));
    });

    document.querySelectorAll("[data-sentence-stats]").forEach((button) => {
        button.addEventListener("click", () => openSentenceStatsPopup(Number(button.getAttribute("data-sentence-stats"))));
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

    document.querySelectorAll("[data-sentence-toggle-excluded]").forEach((button) => {
        button.addEventListener("click", () => sentenceToggleExcluded(Number(button.getAttribute("data-sentence-toggle-excluded"))));
    });

    document.querySelectorAll("[data-sentence-video]").forEach((button) => {
        button.addEventListener("click", () => sentenceVideo(Number(button.getAttribute("data-sentence-video"))));
    });

    const saveSettingsBtn = document.getElementById("saveSettingsBtn");
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener("click", async () => {
            const updatedSettings = await api.updateSettings({
                timezone: document.getElementById("timezoneInput").value.trim() || "UTC",
                language: getLanguagePickerValue(document.getElementById("languageInputPicker")),
                mergeWindowMinutes: Number(document.getElementById("mergeWindowInput").value),
                weeklyReviewDay: Number(document.getElementById("weeklyDayInput").value),
                autoExcludeAfterReviews: Number(document.getElementById("autoExcludeAfterReviewsInput").value)
            });
            state.settings = updatedSettings;
            if (state.user) {
                state.user.language = getLanguagePickerValue(document.getElementById("languageInputPicker"));
            }
            setTtsLanguage(getAppLanguage());
            await refreshAndRender();
        });
    }
    const useNaturalTtsInput = document.getElementById("useNaturalTtsInput");
    if (useNaturalTtsInput) {
        useNaturalTtsInput.addEventListener("change", () => {
            setUseNaturalTts(useNaturalTtsInput.checked);
            if (useNaturalTtsInput.checked) preloadTTS(getAppLanguage());
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

async function scrollToSentence(sentenceId) {
    const el = document.querySelector(`.sentence-item[data-sentence-id="${sentenceId}"]`);
    if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }
    let needsRerender = false;
    state.sentencesLoading = true;
    try {
        while (state.sentencesHasMore) {
            const data = await api.getSentencesPage(state.selectedListId, state.sentencesPage + 1, 20);
            const newItems = data.content || [];
            state.sentences = [...state.sentences, ...newItems];
            state.sentencesPage++;
            state.sentencesHasMore = data.hasMore === true;
            needsRerender = true;
            if (newItems.some((s) => s.id === sentenceId)) break;
        }
    } finally {
        state.sentencesLoading = false;
    }
    if (needsRerender) renderApp();
    const found = document.querySelector(`.sentence-item[data-sentence-id="${sentenceId}"]`);
    if (found) found.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function refreshAndRender(options = {}) {
    try {
        await loadAppData(options);
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
    if (!MIND_MAP_ENABLED) return;
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
                refreshAndRender().then(() => scrollToSentence(node.id));
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
        refreshAndRender().then(() => scrollToSentence(node.id));
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

let backToDashboardConfirmEl = null;

function showBackToDashboardConfirmPopup(sessionId, onConfirm) {
    if (!backToDashboardConfirmEl) {
        backToDashboardConfirmEl = document.createElement("div");
        backToDashboardConfirmEl.className = "sentence-action-popup-backdrop mark-reviewed-confirm-backdrop";
        backToDashboardConfirmEl.innerHTML = `
          <div class="sentence-action-popup mark-reviewed-confirm-popup back-to-dashboard-confirm-popup">
            <h4>Back to dashboard?</h4>
            <p class="mark-reviewed-confirm-message">You’ll leave this review session. Unsaved progress on this page will be lost.</p>
            <div class="popup-actions">
              <button type="button" class="secondary popup-cancel">Cancel</button>
              <button type="button" class="popup-confirm back-to-dashboard-confirm-btn">Back to dashboard</button>
            </div>
          </div>
        `;
        backToDashboardConfirmEl.addEventListener("click", (e) => {
            if (e.target === backToDashboardConfirmEl) closeBackToDashboardConfirmPopup();
        });
        document.body.appendChild(backToDashboardConfirmEl);
    }
    const popup = backToDashboardConfirmEl.querySelector(".mark-reviewed-confirm-popup");
    const cancelBtn = popup.querySelector(".popup-cancel");
    const confirmBtn = popup.querySelector(".back-to-dashboard-confirm-btn");
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    const newCancel = popup.querySelector(".popup-cancel");
    const newConfirm = popup.querySelector(".back-to-dashboard-confirm-btn");
    newCancel.addEventListener("click", () => closeBackToDashboardConfirmPopup());
    newConfirm.addEventListener("click", () => {
        closeBackToDashboardConfirmPopup();
        onConfirm();
    });
    backToDashboardConfirmEl.classList.add("is-visible");
    requestAnimationFrame(() => {
        requestAnimationFrame(() => backToDashboardConfirmEl.classList.add("is-open"));
    });
}

function closeBackToDashboardConfirmPopup() {
    if (!backToDashboardConfirmEl) return;
    backToDashboardConfirmEl.classList.remove("is-open");
    setTimeout(() => backToDashboardConfirmEl.classList.remove("is-visible"), 320);
}

bootstrap();
