# English Spaced Repetition System

Full-stack sentence memorization app with:
- Java 17 + Spring Boot backend
- PostgreSQL persistence
- Vanilla ES2017+ frontend (separate app)
- Spaced repetition schedules with default pattern and custom adjustments
- Merged pending review sessions and notifications
- Per-list interactive mind map visualization

## Project Structure

- `backend` - Spring Boot API and Flyway migrations
- `frontend` - static HTML/CSS/JS app (no framework)
- `docker-compose.yml` - local PostgreSQL service

## Features Implemented

- Account registration, login, logout (`/api/auth/*`)
- Sentence lists: create, rename, delete, fetch
- Sentences: add, edit, delete, move to another list
- Sentence creation date storage and automatic default schedule:
  - 1h, 3h, 6h, 1d, 2d, 1w
- Custom schedule update (intervals, optional end date, open-ended weekly repeat)
- Pending review sessions with merged scheduling logic:
  - configurable merge window (default 60 min)
  - weekly cadence merged by preferred user review day
- Open/complete review session flow and notification state
- Mind map endpoint and UI:
  - one map per list
  - multicolor circles
  - circle opacity increases as sentence review count grows

## Run Locally

### 1) Start Postgres

```bash
docker compose up -d
```

### 2) Start backend

```bash
cd backend
./gradlew bootRun
```

If you do not have wrapper files yet, use your local Gradle:

```bash
gradle bootRun
```

Backend API runs on `http://localhost:8080`.

### 3) Start frontend

Serve `frontend` directory as static files, for example:

```bash
cd frontend
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

## Testing

Run backend tests:

```bash
cd backend
./gradlew test
```

Includes schedule algorithm tests for:
- window bucketing
- weekly merge day behavior
- open-ended weekly continuation
- end-date cutoff
