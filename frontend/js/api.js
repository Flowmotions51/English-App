const effectiveHost = window.location.hostname === "0.0.0.0"
    ? "localhost"
    : window.location.hostname;
const API_BASE = `${window.location.protocol}//${effectiveHost}:8080/api`;

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
        throw new Error(data.error || "Request failed");
    }
    return data;
}

export const api = {
    register: (payload) => request("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
    login: (payload) => request("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
    logout: () => request("/auth/logout", { method: "POST" }),
    me: () => request("/auth/me"),

    getLists: () => request("/lists"),
    createList: (payload) => request("/lists", { method: "POST", body: JSON.stringify(payload) }),
    renameList: (id, payload) => request(`/lists/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    deleteList: (id) => request(`/lists/${id}`, { method: "DELETE" }),

    getSentences: (listId) => request(`/lists/${listId}/sentences`),
    addSentence: (listId, payload) => request(`/lists/${listId}/sentences`, { method: "POST", body: JSON.stringify(payload) }),
    editSentence: (id, payload) => request(`/sentences/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    deleteSentence: (id) => request(`/sentences/${id}`, { method: "DELETE" }),
    moveSentence: (id, payload) => request(`/sentences/${id}/move`, { method: "POST", body: JSON.stringify(payload) }),

    getSchedule: (sentenceId) => request(`/sentences/${sentenceId}/schedule`),
    updateSchedule: (sentenceId, payload) => request(`/sentences/${sentenceId}/schedule`, { method: "PUT", body: JSON.stringify(payload) }),

    getPendingReviews: () => request("/reviews/pending"),
    openReviewSession: (id) => request(`/reviews/sessions/${id}/open`, { method: "POST" }),
    completeReviewSession: (id) => request(`/reviews/sessions/${id}/complete`, { method: "POST" }),

    getSettings: () => request("/settings"),
    updateSettings: (payload) => request("/settings", { method: "PUT", body: JSON.stringify(payload) }),

    getMindMap: (listId) => request(`/lists/${listId}/mind-map`),
    getAllMindMap: () => request("/mind-map"),

    checkGrammar: (text) => request("/grammar/check", { method: "POST", body: JSON.stringify({ text }) }),
    grammarConfigured: () => request("/grammar/configured")
};
