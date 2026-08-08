/**
 * Text-to-speech: fast browser synthesis by default; optional natural voice via preference.
 * Desktop: Kokoro (WebGPU/WASM) for English. Mobile: Piper (WASM).
 * Serbian / Croatian uses browser voices on desktop and Piper on mobile when natural voice is enabled.
 */

import { getSpeechLocale, normalizeAppLanguage } from "./language.js";

const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_CDN = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const PIPER_CDN = "https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/dist/piper-tts-web.js";
const KOKORO_VOICE = "af_bella";
const PIPER_VOICES = {
    en: "en_US-hfc_female-medium",
    sr: "sr_RS-serbski_institut-medium"
};
const STORAGE_KEY_NATURAL = "english-app-tts-natural";
const TTS_CACHE_MAX_SIZE = 80;

/** In-memory cache: key = `${language}::${text}`, value = Blob[] (Kokoro) or Blob (Piper). LRU eviction. */
const ttsCache = new Map();

let activeTtsLanguage = "en";

/** Kokoro is English-only and not supported on iOS Safari and many mobile browsers. */
function isKokoroSupported() {
    if (typeof navigator === "undefined" || !navigator.userAgent) return false;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
    return true;
}

function useNaturalTts() {
    try {
        return localStorage.getItem(STORAGE_KEY_NATURAL) === "true";
    } catch {
        return false;
    }
}

function getPiperVoice(language) {
    return PIPER_VOICES[normalizeAppLanguage(language)] || PIPER_VOICES.en;
}

function canUseKokoroForLanguage(language) {
    return normalizeAppLanguage(language) === "en" && isKokoroSupported();
}

function cacheKey(language, text) {
    return `${normalizeAppLanguage(language)}::${text}`;
}

let kokoroTTS = null;
let kokoroModule = null;
let kokoroLoadPromise = null;
let piperModule = null;
let piperLoadPromise = null;
let currentAudio = null;
const playbackQueue = [];
let playbackPlaying = false;
/** Bumped on every intentional interruption so stale async audio callbacks (onended/onerror/play()) can tell they're obsolete and no-op instead of clobbering newer playback state. */
let playbackGeneration = 0;

function stopCurrentPlayback() {
    playbackGeneration++;
    playbackQueue.length = 0;
    playbackPlaying = false;
    if (currentAudio) {
        try {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            if (currentAudio.src && currentAudio.src.startsWith("blob:")) {
                URL.revokeObjectURL(currentAudio.src);
            }
        } catch (_) {}
        currentAudio = null;
    }
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
}

/** navigator.gpu existing doesn't mean requestAdapter() will succeed (blocklisted GPU, disabled HW accel, VM/RDP, etc). */
async function resolveKokoroDevice() {
    if (typeof navigator === "undefined" || !navigator.gpu) return { device: "wasm", dtype: "q8" };
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return { device: "webgpu", dtype: "fp32" };
    } catch (_) {}
    return { device: "wasm", dtype: "q8" };
}

async function loadKokoro() {
    if (!isKokoroSupported()) return Promise.reject(new Error("Kokoro not supported on this device"));
    if (kokoroTTS) return kokoroTTS;
    if (kokoroLoadPromise) return kokoroLoadPromise;
    kokoroLoadPromise = (async () => {
        kokoroModule = await import(/* webpackIgnore: true */ KOKORO_CDN);
        const { KokoroTTS } = kokoroModule;
        const { device, dtype } = await resolveKokoroDevice();
        kokoroTTS = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype, device });
        return kokoroTTS;
    })();
    return kokoroLoadPromise;
}

async function loadPiper() {
    if (piperModule) return piperModule;
    if (piperLoadPromise) return piperLoadPromise;
    piperLoadPromise = (async () => {
        piperModule = await import(/* webpackIgnore: true */ PIPER_CDN);
        return piperModule;
    })();
    return piperLoadPromise;
}

function playNextInQueue() {
    if (playbackQueue.length === 0) {
        playbackPlaying = false;
        currentAudio = null;
        return;
    }
    playbackPlaying = true;
    const blob = playbackQueue.shift();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const generation = playbackGeneration;
    currentAudio = audio;
    const advance = () => {
        URL.revokeObjectURL(url);
        if (generation !== playbackGeneration) return;
        currentAudio = null;
        playNextInQueue();
    };
    audio.onended = advance;
    audio.onerror = advance;
    audio.play().catch(() => {});
}

function ttsCacheEvictIfNeeded() {
    if (ttsCache.size >= TTS_CACHE_MAX_SIZE) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey !== undefined) ttsCache.delete(firstKey);
    }
}

function pickSpeechVoice(language) {
    if (!window.speechSynthesis) return null;
    const locale = getSpeechLocale(language);
    const langPrefix = locale.split("-")[0];
    const voices = window.speechSynthesis.getVoices();
    return voices.find((voice) => voice.lang === locale)
        || voices.find((voice) => voice.lang.startsWith(`${langPrefix}-`))
        || voices.find((voice) => voice.lang.startsWith(langPrefix))
        || null;
}

function speakWithFallback(text, language = activeTtsLanguage) {
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getSpeechLocale(language);
    const voice = pickSpeechVoice(language);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
}

/**
 * Whether Kokoro can run on this device (desktop Chrome/Edge; not supported on iOS/Android).
 */
export function getIsKokoroSupported() {
    return isKokoroSupported();
}

export function setTtsLanguage(language) {
    activeTtsLanguage = normalizeAppLanguage(language);
}

export function getTtsLanguage() {
    return activeTtsLanguage;
}

/**
 * Enable natural voice by default for Serbian when the user has not chosen a preference yet.
 */
export function applyDefaultNaturalTtsForLanguage(language) {
    const lang = normalizeAppLanguage(language);
    if (lang !== "sr") return;
    try {
        if (localStorage.getItem(STORAGE_KEY_NATURAL) === null) {
            setUseNaturalTts(true);
        }
    } catch (_) {}
}

/**
 * Whether the user has enabled natural (Kokoro) voice. Default false = instant browser TTS.
 */
export function getUseNaturalTts() {
    return useNaturalTts();
}

/**
 * Enable or disable natural voice. When enabling, preloads Kokoro/Piper in the background.
 */
export function setUseNaturalTts(enabled) {
    try {
        localStorage.setItem(STORAGE_KEY_NATURAL, enabled ? "true" : "false");
        if (enabled) preload(activeTtsLanguage);
    } catch (_) {}
}

export function getNaturalTtsHint(language = activeTtsLanguage) {
    const lang = normalizeAppLanguage(language);
    if (lang === "sr") {
        return isKokoroSupported()
            ? "Serbian browser voice (instant)"
            : "Piper (Serbian, iOS/Android), slower first time";
    }
    return isKokoroSupported()
        ? "Kokoro (desktop)"
        : "Piper (iOS/Android), slower first time";
}

export function preload(language = activeTtsLanguage) {
    if (!useNaturalTts()) return;
    const lang = normalizeAppLanguage(language);
    if (canUseKokoroForLanguage(lang)) {
        loadKokoro().catch(() => {});
    } else {
        loadPiper().catch(() => {});
    }
}

/**
 * Speak the given text. Uses browser TTS by default (instant); uses Kokoro/Piper only if "natural voice" is enabled.
 * Natural TTS output is cached by language + text so repeat listens are instant.
 * @param {string} text - Text to speak
 * @param {string} [language] - Account language (`en` or `sr`)
 * @returns {Promise<void>}
 */
export async function speak(text, language = activeTtsLanguage) {
    const lang = normalizeAppLanguage(language);
    activeTtsLanguage = lang;
    const t = (text || "").trim();
    if (!t) return;

    stopCurrentPlayback();

    const useNatural = useNaturalTts();
    const useKokoro = useNatural && canUseKokoroForLanguage(lang);
    const usePiper = useNatural && !useKokoro;

    if (!useNatural) {
        speakWithFallback(t, lang);
        return;
    }

    if (useKokoro) {
        const key = cacheKey(lang, t);
        const cached = ttsCache.get(key);
        if (cached && Array.isArray(cached) && cached.length > 0) {
            ttsCache.delete(key);
            ttsCache.set(key, cached);
            playbackQueue.push(...cached);
            playNextInQueue();
            return;
        }
        try {
            const streamGeneration = playbackGeneration;
            const tts = await loadKokoro();
            const { TextSplitterStream } = kokoroModule;
            const splitter = new TextSplitterStream();
            const stream = tts.stream(splitter, { voice: KOKORO_VOICE });
            const blobs = [];
            const consumeStream = (async () => {
                for await (const { audio: rawAudio } of stream) {
                    const blob = rawAudio.toBlob();
                    blobs.push(blob);
                    if (streamGeneration !== playbackGeneration) continue;
                    playbackQueue.push(blob);
                    if (!playbackPlaying) playNextInQueue();
                }
                if (blobs.length > 0) {
                    ttsCacheEvictIfNeeded();
                    ttsCache.set(key, blobs);
                }
                if (streamGeneration === playbackGeneration && playbackQueue.length === 0 && !playbackPlaying) {
                    speakWithFallback(t, lang);
                }
            })();
            splitter.push(t);
            splitter.close();
            await consumeStream;
        } catch (err) {
            console.warn("Kokoro TTS failed, using fallback:", err);
            speakWithFallback(t, lang);
        }
        return;
    }

    if (!usePiper) {
        speakWithFallback(t, lang);
        return;
    }

    const key = cacheKey(lang, t);
    const cached = ttsCache.get(key);
    if (cached && cached instanceof Blob) {
        ttsCache.delete(key);
        ttsCache.set(key, cached);
        const url = URL.createObjectURL(cached);
        const audio = new Audio(url);
        const generation = playbackGeneration;
        currentAudio = audio;
        audio.onended = () => {
            URL.revokeObjectURL(url);
            if (generation !== playbackGeneration) return;
            currentAudio = null;
        };
        audio.onerror = () => {
            URL.revokeObjectURL(url);
            if (generation !== playbackGeneration) return;
            currentAudio = null;
            speakWithFallback(t, lang);
        };
        await audio.play().catch(() => {});
        return;
    }
    try {
        const tts = await loadPiper();
        const wav = await tts.predict({ text: t, voiceId: getPiperVoice(lang) });
        if (!wav) {
            speakWithFallback(t, lang);
            return;
        }
        ttsCacheEvictIfNeeded();
        ttsCache.set(key, wav);
        const url = URL.createObjectURL(wav);
        const audio = new Audio(url);
        const generation = playbackGeneration;
        currentAudio = audio;
        audio.onended = () => {
            URL.revokeObjectURL(url);
            if (generation !== playbackGeneration) return;
            currentAudio = null;
        };
        audio.onerror = () => {
            URL.revokeObjectURL(url);
            if (generation !== playbackGeneration) return;
            currentAudio = null;
            speakWithFallback(t, lang);
        };
        await audio.play().catch(() => {});
    } catch (err) {
        console.warn("Piper TTS failed, using fallback:", err);
        speakWithFallback(t, lang);
    }
}

/**
 * Cancel any ongoing TTS playback (Kokoro or SpeechSynthesis).
 */
export function cancelSpeak() {
    stopCurrentPlayback();
}
