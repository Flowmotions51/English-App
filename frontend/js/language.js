/** Account languages: English and Serbian / Croatian (Latin). */
export const APP_LANGUAGES = {
    en: { label: "English", speechLocale: "en-US", grammarCode: "en-US" },
    sr: { label: "Serbian / Croatian", speechLocale: "sr-RS", grammarCode: "sr" }
};

export function normalizeAppLanguage(language) {
    return language === "sr" ? "sr" : "en";
}

export function getLanguageConfig(language) {
    return APP_LANGUAGES[normalizeAppLanguage(language)];
}

export function getSpeechLocale(language) {
    return getLanguageConfig(language).speechLocale;
}

export function languageOptionsHtml(selectedLanguage) {
    const selected = normalizeAppLanguage(selectedLanguage);
    return Object.entries(APP_LANGUAGES)
        .map(([code, { label }]) => `<option value="${code}"${code === selected ? " selected" : ""}>${label}</option>`)
        .join("");
}

export function languagePickerHtml(selectedLanguage, escapeHtmlFn) {
    const selected = normalizeAppLanguage(selectedLanguage);
    return Object.entries(APP_LANGUAGES)
        .map(([code, { label }]) => {
            const isSelected = code === selected;
            const safeLabel = escapeHtmlFn(label);
            return `<button type="button" class="language-picker-option${isSelected ? " is-selected" : ""}" data-language="${code}" aria-pressed="${isSelected ? "true" : "false"}">${safeLabel}</button>`;
        })
        .join("");
}

export function bindLanguagePicker(containerEl) {
    if (!containerEl) return;
    containerEl.querySelectorAll(".language-picker-option").forEach((btn) => {
        btn.addEventListener("click", () => {
            containerEl.querySelectorAll(".language-picker-option").forEach((option) => {
                option.classList.remove("is-selected");
                option.setAttribute("aria-pressed", "false");
            });
            btn.classList.add("is-selected");
            btn.setAttribute("aria-pressed", "true");
        });
    });
}

export function getLanguagePickerValue(containerEl) {
    const value = containerEl?.querySelector(".language-picker-option.is-selected")?.getAttribute("data-language");
    return normalizeAppLanguage(value || "en");
}
