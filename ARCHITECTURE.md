# KarpathyWiki — AI Second Brain: Complete Project Context

> **Purpose of this document**: Give any LLM or developer full context about this project so they can understand, modify, or extend it without reading any source code.

---

## 1. What Is This Project?

An **AI-powered personal knowledge wiki** (called "Second Brain"). The user stores notes as Markdown files on disk, then asks natural-language questions through a web UI. The app finds the most relevant notes, sends them to Claude (Anthropic's LLM), and Claude answers **using only those notes** — citing which files it used.

It is intentionally minimal: no database, no authentication, no embeddings, no vector DB, no RAG framework, no conversation memory.

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 6 |
| Backend | Node.js + Express 4 (ES Modules) |
| LLM | Anthropic Claude API (`claude-sonnet-4-20250514`) |
| Storage | Local filesystem — plain `.md` files |
| Config | `.env` file (holds `ANTHROPIC_API_KEY` and `PORT`) |

**No database. No auth. No embeddings. No vector store.**

---

## 3. Project File Structure

```
karpathywiki/
├── README.md                         # Setup & usage instructions
│
├── backend/
│   ├── package.json                  # Dependencies: express, cors, dotenv, @anthropic-ai/sdk
│   ├── server.js                     # THE ENTIRE BACKEND — all routes + search logic (~418 lines)
│   ├── test-search.js                # Standalone test script for search scoring
│   ├── .env                          # ANTHROPIC_API_KEY=... (not committed)
│   ├── .env.example                  # Template for .env
│   └── .gitignore                    # Ignores node_modules/ and .env
│
├── frontend/
│   ├── package.json                  # Dependencies: react, react-dom, vite, @vitejs/plugin-react
│   ├── vite.config.js                # Dev server on :5173, proxies /api → localhost:3001
│   ├── index.html                    # HTML shell
│   └── src/
│       ├── main.jsx                  # React entry point
│       └── App.jsx                   # THE ENTIRE FRONTEND — single component (~330 lines)
│
└── data/
    ├── knowledge/                    # ← SECOND BRAIN LIVES HERE
    │   ├── llm/
    │   │   ├── attention.md
    │   │   ├── transformer.md
    │   │   └── gpt.md
    │   ├── karpathy/
    │   │   └── micrograd.md
    │   └── test/
    │       └── deep/
    │           └── test-note.md      # Deep-nesting test file
    │
    └── internship/                   # ← INTERNSHIP UPDATES GO HERE
        └── (YYYY-MM-DD.md files)
```

---

## 4. How It Runs

Two processes, two terminals:

```bash
# Terminal 1 — Backend (Express API on port 3001)
cd backend
npm run dev          # uses: node --watch server.js

# Terminal 2 — Frontend (Vite dev server on port 5173)
cd frontend
npm run dev          # serves React app, proxies /api to :3001
```

Open `http://localhost:5173` in a browser.

**The Vite dev server proxies all `/api/*` requests to `http://localhost:3001`**, so the frontend never talks to the backend directly — it just calls `/api/chat`, `/api/knowledge`, etc.

---

## 5. API Endpoints (All in `server.js`)

### 5.1 `GET /api/knowledge`
**Purpose**: List all discovered `.md` files in the knowledge base.

- Recursively scans `data/knowledge/`
- Returns relative paths (forward slashes)

```json
// Response
{ "files": ["llm/attention.md", "karpathy/micrograd.md", ...] }
```

---

### 5.2 `POST /api/chat`
**Purpose**: The core feature — ask a question, get an AI answer from your notes.

```json
// Request
{ "message": "What is attention?" }

// Response
{
  "answer": "Based on your notes...",
  "sources": ["llm/attention.md", "llm/transformer.md"]
}
```

**Internal flow:**
1. Discover all `.md` files under `data/knowledge/` (recursive)
2. Extract keywords from the question (stop-word filtered)
3. Extract bigram + trigram phrases
4. Score every file using weighted keyword matching (see Section 6)
5. Take top 5 files with score > 0
6. Build a system prompt that injects the relevant note contents
7. Send to Claude API (`claude-sonnet-4-20250514`, max 1024 tokens)
8. Return Claude's answer + source file paths

**When no files match:** Claude is still called, but with a different system prompt that tells it the Second Brain has no relevant notes. Claude can give a general answer but must clearly state it's NOT from the wiki.

---

### 5.3 `POST /api/knowledge`
**Purpose**: Create a new knowledge note via the UI.

```json
// Request
{ "title": "Self Attention", "content": "My notes...", "folder": "ai/llm" }

// Response
{ "path": "ai/llm/self-attention.md" }
```

- Title → sanitized to filename: `"Self Attention"` → `self-attention.md`
- Folder is optional. If omitted, file goes in `data/knowledge/` root
- Folder path segments are sanitized (`.` and `..` stripped to prevent traversal)
- Creates any missing directories with `fs.mkdir(recursive: true)`
- File content is written as: `# {title}\n\n{content}\n`
- Immediately searchable on the next query (no restart needed)

---

### 5.4 `POST /api/internship`
**Purpose**: Save a daily internship update.

```json
// Request
{ "title": "First day setup", "update": "Set up dev environment..." }

// Response
{ "path": "internship/2026-08-25.md" }
```

- Filename is always today's date: `YYYY-MM-DD.md`
- Saved to `data/internship/` (NOT inside `data/knowledge/`, so NOT searchable by the brain)
- If the file for today already exists, the new entry is **appended** with a `---` separator
- Title is optional (defaults to "Internship Update — YYYY-MM-DD")

---

## 6. Search & Scoring Algorithm (The Brain)

This is the core intelligence. It's a **weighted keyword matching** system — NOT embeddings, NOT semantic search, NOT RAG in the formal sense.

### 6.1 Query Processing

1. **Normalize**: lowercase, strip punctuation, collapse whitespace
2. **Extract keywords**: split on spaces, remove words ≤ 1 char, remove stop words (100+ English stop words)
3. **Extract phrases**: generate bigrams and trigrams from the remaining keywords

Example: `"How are transformers related to attention?"`
- Keywords: `[transformers, related, attention]`
- Phrases: `[transformers related, related attention, transformers related attention]`

### 6.2 Scoring Weights

Each file is scored against the query using 5 signals:

| Signal | Weight | Description |
|--------|--------|-------------|
| `TITLE_EXACT` | **15** | The filename (without `.md`) exactly equals a keyword. E.g., query has "attention" and file is `attention.md` |
| `FILENAME_MATCH` | **10** | A keyword appears anywhere in the file path. E.g., "karpathy" matches `karpathy/micrograd.md` |
| `PHRASE_MATCH` | **8** | A multi-word phrase (bigram/trigram) appears in the content |
| `HEADING_MATCH` | **5** | A keyword appears in a markdown heading (`# ...` through `###### ...`) |
| `CONTENT_MATCH` | **1** | A keyword appears anywhere in the body text |

All counts are additive — if "attention" appears 20 times in the content, that's +20 content points.

### 6.3 File Selection

- All files are scored
- Sorted by score descending
- Top 5 files with score > 0 are selected
- Their full content is injected into Claude's system prompt

### 6.4 Known Limitation

Keyword matching only finds **literal word matches**. It cannot understand that "neural network" is related to "backpropagation" unless those exact words co-occur. True RAG with embeddings would handle semantic similarity.

---

## 7. Frontend (App.jsx)

A single React component with 3 sections, all inline-styled (no CSS framework):

### Section 1: Search My Brain
- Text input + "Search My Brain" button
- Calls `POST /api/chat`
- Displays: Answer text + Sources list (as `📄 path/to/file.md`)

### Section 2: Add Knowledge
- Fields: Title, Folder (optional), Content (textarea)
- Calls `POST /api/knowledge`
- Shows success message with the created file path

### Section 3: Internship Update
- Fields: Title (optional), Update (textarea)
- Calls `POST /api/internship`
- Shows success message with the saved file path

All API calls go to `/api/*` which Vite proxies to `localhost:3001`.

---

## 8. Security

| Concern | How It's Handled |
|---------|-----------------|
| API key exposure | `ANTHROPIC_API_KEY` is only in backend `.env`, never sent to frontend |
| Path traversal (read) | `readKnowledgeFile()` resolves the path and checks it starts with `KNOWLEDGE_DIR` |
| Path traversal (write) | `sanitizeFolderPath()` strips `.` and `..` segments, `sanitizeFilename()` removes unsafe chars, final path is checked against `KNOWLEDGE_DIR` |
| File type restriction | Only `.md` files are discovered and read |

---

## 9. Data Flow Diagram

```
User types question in browser
        │
        ▼
Frontend (React, port 5173)
        │  POST /api/chat { message: "..." }
        │  (proxied by Vite)
        ▼
Backend (Express, port 3001)
        │
        ├── 1. Recursively scan data/knowledge/ for all .md files
        ├── 2. Extract keywords + phrases from the question
        ├── 3. Score each file (filename, headings, content, phrases)
        ├── 4. Sort by score, take top 5
        ├── 5. Build system prompt with file contents injected
        ├── 6. Call Claude API (claude-sonnet-4-20250514)
        │       └── System prompt: "Answer from these notes only..."
        │       └── User message: the original question
        ├── 7. Receive Claude's response
        └── 8. Return { answer, sources } to frontend
                    │
                    ▼
Frontend displays Answer + Sources
```

---

## 10. Dependencies

### Backend (`backend/package.json`)
```json
{
  "@anthropic-ai/sdk": "^0.39.0",
  "cors": "^2.8.5",
  "dotenv": "^16.4.7",
  "express": "^4.21.2"
}
```

### Frontend (`frontend/package.json`)
```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "@vitejs/plugin-react": "^4.3.4",  // devDep
  "vite": "^6.0.7"                    // devDep
}
```

---

## 11. What This App Is NOT

- **Not RAG**: No embeddings, no vector database, no chunking strategy — just keyword scoring
- **Not a chatbot**: No conversation memory, each question is independent
- **Not authenticated**: Anyone with access to the URL can use it
- **Not a database app**: Everything is flat files on disk
- **Not production-ready**: No rate limiting, no input sanitization beyond path safety, no HTTPS
