/**
 * Text-to-speech: fast browser synthesis by default; optional natural voice via preference.
 * Desktop: Kokoro (WebGPU/WASM). Mobile (iOS Safari, Android): Piper (WASM, works on iOS).
 */

const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const KOKORO_CDN = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const PIPER_CDN = "https://cdn.jsdelivr.net/npm/@mintplex-labs/piper-tts-web@1.0.4/dist/piper-tts-web.js";
const KOKORO_VOICE = "af_bella";
const PIPER_VOICE = "en_US-hfc_female-medium";
const STORAGE_KEY_NATURAL = "english-app-tts-natural";
const TTS_CACHE_MAX_SIZE = 80;

/** In-memory cache: key = trimmed text, value = Blob[] (Kokoro) or Blob (Piper). LRU eviction. */
const ttsCache = new Map();

/** Kokoro is not supported on iOS Safari and is unreliable on many mobile browsers (WebGPU/WASM limits). */
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

let kokoroTTS = null;
let kokoroModule = null;
let kokoroLoadPromise = null;
let piperModule = null;
let piperLoadPromise = null;
let currentAudio = null;
const playbackQueue = [];
let playbackPlaying = false;

function stopCurrentPlayback() {
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

async function loadKokoro() {
    if (!isKokoroSupported()) return Promise.reject(new Error("Kokoro not supported on this device"));
    if (kokoroTTS) return kokoroTTS;
    if (kokoroLoadPromise) return kokoroLoadPromise;
    kokoroLoadPromise = (async () => {
        kokoroModule = await import(/* webpackIgnore: true */ KOKORO_CDN);
        const { KokoroTTS } = kokoroModule;
        // Prefer WebGPU (much faster); fall back to WASM. Use lighter dtype on WASM for speed.
        const hasWebGPU = typeof navigator !== "undefined" && !!navigator.gpu;
        const device = hasWebGPU ? "webgpu" : "wasm";
        const dtype = device === "webgpu" ? "fp32" : "q8";
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
    currentAudio = audio;
    audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        playNextInQueue();
    };
    audio.onerror = () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        playNextInQueue();
    };
    audio.play();
}

function ttsCacheEvictIfNeeded() {
    if (ttsCache.size >= TTS_CACHE_MAX_SIZE) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey !== undefined) ttsCache.delete(firstKey);
    }
}

function speakWithFallback(text) {
    if (window.speechSynthesis) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        window.speechSynthesis.speak(utterance);
    }
}

/**
 * Whether Kokoro can run on this device (desktop Chrome/Edge; not supported on iOS/Android).
 */
export function getIsKokoroSupported() {
    return isKokoroSupported();
}

/**
 * Whether the user has enabled natural (Kokoro) voice. Default false = instant browser TTS.
 */
export function getUseNaturalTts() {
    return useNaturalTts();
}

/**
 * Enable or disable natural voice. When enabling, preloads Kokoro in the background.
 */
export function setUseNaturalTts(enabled) {
    try {
        localStorage.setItem(STORAGE_KEY_NATURAL, enabled ? "true" : "false");
        if (enabled) preload();
    } catch (_) {}
}

export function preload() {
    if (!useNaturalTts()) return;
    if (isKokoroSupported()) loadKokoro().catch(() => {});
    else loadPiper().catch(() => {});
}

/**
 * Speak the given text. Uses browser TTS by default (instant); uses Kokoro only if "natural voice" is enabled in Settings.
 * Natural TTS output is cached by text so repeat listens are instant.
 * @param {string} text - Text to speak
 * @returns {Promise<void>}
 */
export async function speak(text) {
    const t = (text || "").trim();
    if (!t) return;

    stopCurrentPlayback();

    if (!useNaturalTts()) {
        speakWithFallback(t);
        return;
    }

    if (isKokoroSupported()) {
        const cached = ttsCache.get(t);
        if (cached && Array.isArray(cached) && cached.length > 0) {
            ttsCache.delete(t);
            ttsCache.set(t, cached);
            playbackQueue.push(...cached);
            playNextInQueue();
            return;
        }
        try {
            const tts = await loadKokoro();
            const { TextSplitterStream } = kokoroModule;
            const splitter = new TextSplitterStream();
            const stream = tts.stream(splitter, { voice: KOKORO_VOICE });
            const blobs = [];
            const consumeStream = (async () => {
                for await (const { audio: rawAudio } of stream) {
                    const blob = rawAudio.toBlob();
                    blobs.push(blob);
                    playbackQueue.push(blob);
                    if (!playbackPlaying) playNextInQueue();
                }
                if (blobs.length > 0) {
                    ttsCacheEvictIfNeeded();
                    ttsCache.set(t, blobs);
                }
                if (playbackQueue.length === 0 && !playbackPlaying) speakWithFallback(t);
            })();
            splitter.push(t);
            splitter.close();
            await consumeStream;
        } catch (err) {
            console.warn("Kokoro TTS failed, using fallback:", err);
            speakWithFallback(t);
        }
        return;
    }

    // Mobile (iOS Safari, Android): use Piper TTS — WASM-based, works on iOS
    const cached = ttsCache.get(t);
    if (cached && cached instanceof Blob) {
        ttsCache.delete(t);
        ttsCache.set(t, cached);
        const url = URL.createObjectURL(cached);
        const audio = new Audio(url);
        currentAudio = audio;
        audio.onended = () => {
            URL.revokeObjectURL(url);
            currentAudio = null;
        };
        audio.onerror = () => {
            URL.revokeObjectURL(url);
            currentAudio = null;
            speakWithFallback(t);
        };
        await audio.play();
        return;
    }
    try {
        const tts = await loadPiper();
        const wav = await tts.predict({ text: t, voiceId: PIPER_VOICE });
        if (!wav) {
            speakWithFallback(t);
            return;
        }
        ttsCacheEvictIfNeeded();
        ttsCache.set(t, wav);
        const url = URL.createObjectURL(wav);
        const audio = new Audio(url);
        currentAudio = audio;
        audio.onended = () => {
            URL.revokeObjectURL(url);
            currentAudio = null;
        };
        audio.onerror = () => {
            URL.revokeObjectURL(url);
            currentAudio = null;
            speakWithFallback(t);
        };
        await audio.play();
    } catch (err) {
        console.warn("Piper TTS failed, using fallback:", err);
        speakWithFallback(t);
    }
}

/**
 * Cancel any ongoing TTS playback (Kokoro or SpeechSynthesis).
 */
export function cancelSpeak() {
    stopCurrentPlayback();
}
