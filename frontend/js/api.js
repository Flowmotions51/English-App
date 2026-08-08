function defaultApiBase() {
    const effectiveHost = window.location.hostname === "0.0.0.0"
        ? "localhost"
        : window.location.hostname;
    return `${window.location.protocol}//${effectiveHost}:8080/api`;
}

// Optional override: set `window.__ENGLISH_APP_API_BASE__` in an inline (classic) script in index.html
// before `app.js` loads — e.g. from a launch script that injects the backend URL. Value must include
// the `/api` path, e.g. "http://127.0.0.1:8080/api" (no trailing slash required).
function resolveApiBase() {
    const override = typeof window !== "undefined" && window.__ENGLISH_APP_API_BASE__;
    if (typeof override === "string" && override.trim() !== "") {
        return override.trim().replace(/\/$/, "");
    }
    return defaultApiBase();
}

const API_BASE = resolveApiBase();

async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });

    if (response.status === 204) {
        return null;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const err = new Error(data.error || "Request failed");
        err.responseData = data;
        throw err;
    }
    return data;
}

export const api = {
    register: (payload) => request("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
    login: (payload) => request("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
    logout: () => request("/auth/logout", { method: "POST" }),
    me: () => request("/auth/me"),
    forgotPassword: (payload) => request("/auth/forgot-password", { method: "POST", body: JSON.stringify(payload) }),
    resetPassword: (payload) => request("/auth/reset-password", { method: "POST", body: JSON.stringify(payload) }),

    getLists: () => request("/lists"),
    createList: (payload) => request("/lists", { method: "POST", body: JSON.stringify(payload) }),
    renameList: (id, payload) => request(`/lists/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    deleteList: (id) => request(`/lists/${id}`, { method: "DELETE" }),

    searchSentences: (q) => request(`/sentences/search?q=${encodeURIComponent(q)}`),
    getSentences: (listId) => request(`/lists/${listId}/sentences`),
    getSentencesPage: (listId, page, size = 20) =>
        request(`/lists/${listId}/sentences?page=${page}&size=${size}`),
    addSentence: (listId, payload) => request(`/lists/${listId}/sentences`, { method: "POST", body: JSON.stringify(payload) }),
    editSentence: (id, payload) => request(`/sentences/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    deleteSentence: (id) => request(`/sentences/${id}`, { method: "DELETE" }),
    moveSentence: (id, payload) => request(`/sentences/${id}/move`, { method: "POST", body: JSON.stringify(payload) }),
    excludeSentenceFromSchedule: (id) => request(`/sentences/${id}/exclude`, { method: "POST" }),
    includeSentenceInSchedule: (id) => request(`/sentences/${id}/include`, { method: "POST" }),
    getExcludedSentences: () => request("/sentences/excluded"),

    getSentenceVideoLinks: (sentenceId) => request(`/sentences/${sentenceId}/video-links`),
    addSentenceVideoLink: (sentenceId, payload) => request(`/sentences/${sentenceId}/video-links`, { method: "POST", body: JSON.stringify(payload) }),
    deleteSentenceVideoLink: (sentenceId, linkId) => request(`/sentences/${sentenceId}/video-links/${linkId}`, { method: "DELETE" }),

    getSchedule: (sentenceId) => request(`/sentences/${sentenceId}/schedule`),
    updateSchedule: (sentenceId, payload) => request(`/sentences/${sentenceId}/schedule`, { method: "PUT", body: JSON.stringify(payload) }),

    getPendingReviews: () => request("/reviews/pending"),
    /** Rebuilds pending review sessions from schedules; call before getPendingReviews when entering the app. */
    refreshReviewSessions: () => request("/reviews/refresh-sessions", { method: "POST" }),
    openReviewSession: (id) => request(`/reviews/sessions/${id}/open`, { method: "POST" }),
    completeReviewSession: (id, sentenceIds) => request(`/reviews/sessions/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(sentenceIds ? { sentenceIds } : {})
    }),
    completeSentenceReview: (sentenceId) => request(`/reviews/sentences/${sentenceId}/complete`, { method: "POST" }),

    getSettings: () => request("/settings"),
    updateSettings: (payload) => request("/settings", { method: "PUT", body: JSON.stringify(payload) }),

    getMindMap: (listId) => request(`/lists/${listId}/mind-map`),
    getAllMindMap: () => request("/mind-map"),

    checkGrammar: (text, language = "en") => request("/grammar/check", {
        method: "POST",
        body: JSON.stringify({ text, language })
    }),
    grammarConfigured: () => request("/grammar/configured"),
    checkNaturalness: (text, language = "en", listTitle = "") => request("/ai/naturalness/check", {
        method: "POST",
        body: JSON.stringify({ text, language, listTitle })
    }),
    naturalnessConfigured: () => request("/ai/naturalness/configured"),

    getMeaningGroups: () => request("/meaning-groups"),
    getMeaningGroup: (groupId) => request(`/meaning-groups/${groupId}`),
    createMeaningGroup: (payload) => request("/meaning-groups", { method: "POST", body: JSON.stringify(payload) }),
    updateMeaningGroup: (groupId, payload) => request(`/meaning-groups/${groupId}`, { method: "PUT", body: JSON.stringify(payload) }),
    deleteMeaningGroup: (groupId) => request(`/meaning-groups/${groupId}`, { method: "DELETE" }),
    getMeaningGroupSentences: (groupId) => request(`/meaning-groups/${groupId}/sentences`),
    getSentenceVariants: (sentenceId) => request(`/sentences/${sentenceId}/variants`),
    assignSentenceToMeaningGroup: (sentenceId, payload) =>
        request(`/sentences/${sentenceId}/meaning-group`, { method: "PUT", body: JSON.stringify(payload) }),
    unassignSentenceFromMeaningGroup: (sentenceId) =>
        request(`/sentences/${sentenceId}/meaning-group`, { method: "DELETE" }),

    getStatsOverview: () => request("/stats"),
    getSentenceStats: (sentenceId) => request(`/stats/sentences/${sentenceId}`),
    recordPronunciationAttempt: (payload) => request("/stats/pronunciation-attempts", {
        method: "POST",
        body: JSON.stringify(payload)
    })
};
