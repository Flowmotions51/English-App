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
/** No AbortController exists inside kokoro-js's fetch/inference calls, so a stalled download or stuck
 * WebGPU compute would otherwise await forever. These bound how long we wait with *no progress at all*
 * before giving up and falling back — a slow-but-progressing load can still take as long as it needs.
 * `progress_callback` only fires for download progress: once the download finishes, WASM compile/session
 * init and the first inference pass report nothing until they're done. On older/slower browsers — no
 * WebGPU, no cross-origin-isolated threads, so onnxruntime-web quietly drops to single-threaded WASM
 * instead of erroring — that silent stretch can genuinely take longer than a "stuck download" timeout
 * should be, so these need real headroom rather than a short one meant only to catch a truly dead fetch. */
const KOKORO_LOAD_STALL_MS = 90000;
const KOKORO_GENERATION_STALL_MS = 60000;

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

/**
 * Only one speak()/speakWithFallback() call is ever "live" at a time (stopCurrentPlayback always
 * fully stops any prior playback first), so a single pending resolver is enough to let callers
 * await actual playback completion instead of just "playback started".
 */
let playbackDoneResolve = null;

function settlePlaybackDone() {
    const resolve = playbackDoneResolve;
    playbackDoneResolve = null;
    if (resolve) resolve();
}

function waitForPlaybackDone() {
    settlePlaybackDone();
    return new Promise((resolve) => { playbackDoneResolve = resolve; });
}

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
    settlePlaybackDone();
}

/** navigator.gpu existing doesn't mean requestAdapter() will succeed (blocklisted GPU, disabled HW accel, VM/RDP, etc). */
async function resolveKokoroDevice() {
    if (typeof navigator === "undefined" || !navigator.gpu) return { device: "wasm", dtype: "q8" };
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
            // fp16 halves the download vs. fp32 and is broadly supported (Apple Silicon, most modern
            // discrete/integrated GPUs); only fall back to the larger fp32 build when the adapter lacks it.
            const dtype = adapter.features?.has("shader-f16") ? "fp16" : "fp32";
            return { device: "webgpu", dtype };
        }
    } catch (_) {}
    return { device: "wasm", dtype: "q8" };
}

/** Rejects if ping() isn't called within idleMs of the last call (or of creation). Lets an operation that
 * keeps making progress run indefinitely while still catching a true stall/hang. */
function createStallWatchdog(idleMs, message) {
    let timer = null;
    let reject = null;
    const promise = new Promise((_, rej) => { reject = rej; });
    const ping = () => {
        clearTimeout(timer);
        timer = setTimeout(() => reject(new Error(message)), idleMs);
    };
    ping();
    return { ping, promise, cancel: () => clearTimeout(timer) };
}

async function loadKokoro() {
    if (!isKokoroSupported()) return Promise.reject(new Error("Kokoro not supported on this device"));
    if (kokoroTTS) return kokoroTTS;
    if (kokoroLoadPromise) return kokoroLoadPromise;
    kokoroLoadPromise = (async () => {
        kokoroModule = await import(/* webpackIgnore: true */ KOKORO_CDN);
        const { KokoroTTS } = kokoroModule;
        const { device, dtype } = await resolveKokoroDevice();
        const watchdog = createStallWatchdog(KOKORO_LOAD_STALL_MS, "Kokoro model download stalled");
        try {
            const loadPromise = KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
                dtype,
                device,
                progress_callback: () => watchdog.ping()
            });
            loadPromise.catch(() => {}); // avoid an unhandled rejection if this loses the race below
            kokoroTTS = await Promise.race([loadPromise, watchdog.promise]);
        } finally {
            watchdog.cancel();
        }
        return kokoroTTS;
    })().catch((err) => {
        kokoroLoadPromise = null; // let the next speak() retry instead of replaying this failure forever
        throw err;
    });
    return kokoroLoadPromise;
}

async function loadPiper() {
    if (piperModule) return piperModule;
    if (piperLoadPromise) return piperLoadPromise;
    piperLoadPromise = (async () => {
        piperModule = await import(/* webpackIgnore: true */ PIPER_CDN);
        return piperModule;
    })().catch((err) => {
        piperLoadPromise = null;
        throw err;
    });
    return piperLoadPromise;
}

function playNextInQueue() {
    if (playbackQueue.length === 0) {
        playbackPlaying = false;
        currentAudio = null;
        settlePlaybackDone();
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

/** Plays a single blob outside the queue (Piper) and resolves once it truly finishes (end, error, or interruption). Resolves true on error so the caller can fall back. */
function playBlobAndWait(blob) {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const generation = playbackGeneration;
    currentAudio = audio;
    let failed = false;
    const finish = (didFail) => {
        URL.revokeObjectURL(url);
        if (generation === playbackGeneration) {
            currentAudio = null;
            failed = didFail;
        }
        settlePlaybackDone();
    };
    const donePromise = waitForPlaybackDone();
    audio.onended = () => finish(false);
    audio.onerror = () => finish(true);
    audio.play().catch(() => finish(true));
    return donePromise.then(() => failed);
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
    if (!window.speechSynthesis) return Promise.resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getSpeechLocale(language);
    const voice = pickSpeechVoice(language);
    if (voice) utterance.voice = voice;
    const donePromise = waitForPlaybackDone();
    utterance.onend = () => settlePlaybackDone();
    utterance.onerror = () => settlePlaybackDone();
    window.speechSynthesis.speak(utterance);
    return donePromise;
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
        await speakWithFallback(t, lang);
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
            await waitForPlaybackDone();
            return;
        }
        try {
            const streamGeneration = playbackGeneration;
            const tts = await loadKokoro();
            const { TextSplitterStream } = kokoroModule;
            const splitter = new TextSplitterStream();
            const stream = tts.stream(splitter, { voice: KOKORO_VOICE });
            const blobs = [];
            let streamAbandoned = false;
            const watchdog = createStallWatchdog(KOKORO_GENERATION_STALL_MS, "Kokoro speech generation stalled");
            const consumeStream = (async () => {
                for await (const { audio: rawAudio } of stream) {
                    // Once we've given up waiting (watchdog fired below), stop feeding a possibly-newer
                    // playback: the generator itself can't be cancelled, so let it run out in the background.
                    if (streamAbandoned) continue;
                    watchdog.ping();
                    const blob = rawAudio.toBlob();
                    blobs.push(blob);
                    if (streamGeneration !== playbackGeneration) continue;
                    playbackQueue.push(blob);
                    if (!playbackPlaying) playNextInQueue();
                }
                if (!streamAbandoned && blobs.length > 0) {
                    ttsCacheEvictIfNeeded();
                    ttsCache.set(key, blobs);
                }
            })();
            consumeStream.catch(() => {}); // avoid an unhandled rejection if this loses the race below
            splitter.push(t);
            splitter.close();
            try {
                await Promise.race([consumeStream, watchdog.promise]);
            } catch (err) {
                streamAbandoned = true;
                throw err;
            } finally {
                watchdog.cancel();
            }
            if (streamGeneration === playbackGeneration) {
                if (playbackPlaying || playbackQueue.length > 0) {
                    await waitForPlaybackDone();
                } else {
                    await speakWithFallback(t, lang);
                }
            }
        } catch (err) {
            console.warn("Kokoro TTS failed, using fallback:", err);
            await speakWithFallback(t, lang);
        }
        return;
    }

    if (!usePiper) {
        await speakWithFallback(t, lang);
        return;
    }

    const key = cacheKey(lang, t);
    const cached = ttsCache.get(key);
    if (cached && cached instanceof Blob) {
        ttsCache.delete(key);
        ttsCache.set(key, cached);
        const failed = await playBlobAndWait(cached);
        if (failed) await speakWithFallback(t, lang);
        return;
    }
    try {
        const tts = await loadPiper();
        const wav = await tts.predict({ text: t, voiceId: getPiperVoice(lang) });
        if (!wav) {
            await speakWithFallback(t, lang);
            return;
        }
        ttsCacheEvictIfNeeded();
        ttsCache.set(key, wav);
        const failed = await playBlobAndWait(wav);
        if (failed) await speakWithFallback(t, lang);
    } catch (err) {
        console.warn("Piper TTS failed, using fallback:", err);
        await speakWithFallback(t, lang);
    }
}

/**
 * Cancel any ongoing TTS playback (Kokoro or SpeechSynthesis).
 */
export function cancelSpeak() {
    stopCurrentPlayback();
}
