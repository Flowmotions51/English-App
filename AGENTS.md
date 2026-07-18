# AGENTS.md

Rules and context for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repository.

## What this project is

**Repeat Every Day** is a spaced-repetition app for English sentences and phrases, not single vocabulary words in isolation (though a single word is allowed). The core unit is a **sentence**: a piece of real usage — a full sentence, an expression, or occasionally a single word — that the user wants to internalize with context.

Domain model, top to bottom:

- **User account** — registers, logs in, has a timezone and a preferred weekly review day.
- **List** (`SentenceList`) — a named container the user creates first. Sentences always belong to a list.
- **Sentence** — content + creation timestamp, belongs to exactly one list, optionally tagged to a **Meaning Group** (sentences that share a meaning/translation, e.g. paraphrases of the same idea, so the app can show them as variants of each other).
- **Schedule** (`ScheduleTemplate` + `SentenceScheduleStep`) — defines when a sentence comes up for review. There is a global default schedule (currently 1h, 3h, 6h, 1d, 2d, 1w, then weekly) and it can be overridden per-sentence, including making it open-ended or giving it an end date.
- **Review session** (`ReviewSession` + `ReviewSessionItem`) — a batch of due sentences the user reviews together. Sessions have a `kind`: `INITIAL` (first exposure), `REGULAR` (normal spaced-repetition due date), or `WEEKLY_CATCH_UP` (bundles sentences due on the user's chosen weekly day). Regular/initial sessions cap at **15 sentences**; weekly catch-up caps at **30**. Sessions merge sentences that fall due within a configurable time window (default 60 min) so the user isn't pinged repeatedly.
- **Sentence review** (`SentenceReview`) — the historical record of a completed review of one sentence (used to compute due dates, review counts, and mind-map opacity).
- **Pronunciation attempt** — optional speaking practice tied to a review session (mic input, staged/partial phrase checking).

### What a user can do with a sentence

- Add it to a list (list must already exist).
- Edit its content.
- Delete it.
- Move it to a different list.
- Review it in place (outside of a formal session) via `/api/review/sentences/{id}/complete`.
- Run an AI naturalness check (Claude) and/or a local grammar check (LanguageTool) to sanity-check phrasing before committing it to memory.
- Open it in **YouGlish** or **Playphrase.me** to hear the phrase spoken in real videos — this is a client-side deep link, no backend involvement.
- Attach video links (`SentenceVideoLink`) found this way for later reference.

### Reviews tab

Shows sessions composed from sentences that became due, grouped/merged by timing as described above, 15 sentences per regular/initial session. The user opens a session, works through the sentences (optionally with pronunciation practice and TTS playback), and completes it — which records `SentenceReview` rows and reschedules each sentence.

### Other features already implemented

- Per-list interactive mind map (`/api/lists/{id}/mind-map`) and a global one (`/api/mind-map`): one bubble per sentence, color varies, opacity increases with review count.
- Stats endpoints (`/api/stats`) for progress tracking.
- Password reset via email.
- Native iOS wrapper (`ios/EnglishSRS`) — a `WKWebView` shell around the same frontend, not a separate implementation.

## Architecture

```
┌─────────────────┐        HTTPS/JSON, session cookie        ┌──────────────────────┐
│ frontend/        │ ─────────────────────────────────────▶  │ backend/               │
│ vanilla HTML/CSS/ │ ◀───────────────────────────────────── │ Spring Boot 3 (Java 17)│
│ JS, no framework  │                                          │                        │
└─────────────────┘                                          └──────────┬────────────┘
        ▲                                                                │ JPA/Hibernate
        │ WKWebView shell                                                ▼
┌─────────────────┐                                          ┌──────────────────────┐
│ ios/EnglishSRS    │                                          │ PostgreSQL 16          │
│ (native wrapper)  │                                          │ (Flyway-migrated)      │
└─────────────────┘                                          └──────────────────────┘
```

- **Frontend** (`frontend/`): static `index.html` + `js/app.js` (UI + state), `js/api.js` (HTTP client), `js/tts.js` (speech), `js/language.js`. No build step, no framework, no bundler — served as-is by `serve.py` or any static file server. Talks to the backend over `fetch` with credentials (session cookie), base URL controlled by `ENGLISH_APP_API_BASE` (see `js/api-env.js`).
- **Backend** (`backend/`): Spring Boot 3.3 / Java 17, layered as `api` (REST controllers) → `service` (business logic) → `repository` (Spring Data JPA) → `model` (JPA entities). Auth is classic server-side session (Spring Security + `DaoAuthenticationProvider` + BCrypt), **not** JWT — the cookie is what makes the frontend and iOS wrapper need to share an HTTPS origin in production.
- **Database**: PostgreSQL 16, schema owned by Flyway migrations under `backend/src/main/resources/db/migration` (`V1__init.sql` … `V10__ai_check_cache.sql`). Hibernate `ddl-auto` is `validate` — schema changes always go through a new Flyway migration, never through Hibernate auto-DDL.
- **iOS** (`ios/EnglishSRS`): thin native wrapper, references `../../frontend` directly as a bundled resource — it is not a second frontend to keep in sync, it *is* the same frontend. Points at the hosted API in production.
- **External services**: Anthropic Claude API (naturalness check, optional — degrades gracefully without a key), LanguageTool (grammar check, runs locally, no key needed), YouGlish/Playphrase.me (client-side outbound links only, no API integration).

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Java 17, Spring Boot 3.3 (Web, Security, Data JPA, Validation, Mail), Gradle |
| Database | PostgreSQL 16, Flyway migrations |
| Grammar check | LanguageTool (`org.languagetool:language-en`, embedded, offline) |
| AI naturalness check | Anthropic Claude API (`claude-3-5-sonnet-20241022` by default), optional via `ANTHROPIC_API_KEY` |
| Auth | Spring Security, session cookies, BCrypt password hashing |
| Frontend | Vanilla JavaScript (ES2017+), HTML, CSS — no framework, no build tooling |
| Mobile | Native iOS `WKWebView` wrapper (Xcode project), macOS/Xcode required to build |
| Local dev infra | Docker Compose (Postgres only) |
| Prod infra | EC2 + nginx (reverse proxy / TLS termination on port 443), domain `repeat-every-day.com` |

## Deployment

### Local development

```bash
docker compose up -d              # Postgres on localhost:5432
cd backend && ./gradlew bootRun   # API on localhost:8080
cd frontend && python3 -m http.server 5173   # UI on localhost:5173
```

Optional env vars for the backend:

```bash
export ANTHROPIC_API_KEY=your_api_key
export ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

### Production (EC2)

- Backend: build and run the Spring Boot jar (`./gradlew bootJar` → `build/libs/english-app-backend-*.jar`) behind nginx, which terminates TLS on 443 and proxies `/api` to it.
- Frontend: served as static files via `frontend/serve.py`, run detached:
  ```bash
  cd frontend
  export ENGLISH_APP_API_BASE=https://repeat-every-day.com/api   # no port — nginx serves 443
  nohup python3 serve.py 5173 > outputPython.log 2>&1 &
  ```
- Frontend and backend must be reachable under the **same HTTPS origin** in front of nginx — the session cookie auth depends on it, and it's also required for cookies to persist correctly inside the iOS `WKWebView`.
- iOS app config (`ios/EnglishSRS/AppConfig.plist`) points `APIBaseURL`/`FrontendURL` at the hosted origin above; it is not rebuilt as part of backend/frontend deploys.

### Database migrations

New schema changes = new file in `backend/src/main/resources/db/migration/`, named `V{next}__description.sql`, applied automatically by Flyway on backend startup. Never edit a migration that has already shipped.

## Conventions & guardrails for agents working in this repo

- **No JS build step.** Don't introduce bundlers, npm, or a frontend framework without discussing it first — the "no framework" choice is deliberate for a small app.
- **Auth is session/cookie-based, not token-based.** Don't add JWT or `Authorization: Bearer` handling without discussing it — it would break the shared-origin cookie model the iOS wrapper depends on.
- **Schema changes go through Flyway**, never through `ddl-auto`. Add a new `V{n}__*.sql` file; don't edit past ones.
- **The 15/30-sentence review batch caps live in `ReviewService`** (`MAX_SENTENCES_PER_REVIEW_SESSION`, `MAX_WEEKLY_CATCH_UP_SENTENCES`) — treat as intentional product limits, not magic numbers to "clean up".
- **AI naturalness check must degrade gracefully** without `ANTHROPIC_API_KEY` set — don't make it a hard dependency of core flows (adding/reviewing sentences must work with zero external API keys configured).
- **`ios/EnglishSRS` is a thin wrapper**, not a parallel codebase — UI/feature work happens in `frontend/`, and iOS changes should stay limited to the native shell (config, permissions, WebView setup) unless the task is explicitly about the iOS project.
- **Keep `frontend`, `backend`, and `ios` in sync on features that touch all three** (e.g. a new frontend button that needs a native permission, like the microphone entry for pronunciation practice).
