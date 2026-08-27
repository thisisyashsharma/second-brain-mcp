# 🧠 My Second Brain — AI-Powered Knowledge Wiki

A minimal AI-powered Second Brain that lets you store knowledge as Markdown files and ask questions answered by Claude using your own notes.

## Architecture

```
┌─────────────────┐     HTTP      ┌──────────────────┐     API     ┌─────────┐
│  React + Vite   │ ───────────── │  Express Backend │ ──────────  │  Claude │
│    Frontend     │   /api/chat   │                  │             │   API   │
│   (port 5173)   │   /api/know.  │   (port 3001)    │             └─────────┘
└─────────────────┘               └────────┬─────────┘
                                           │ reads
                                  ┌────────▼─────────┐
                                  │ data/knowledge/  │
                                  │   *.md files     │
                                  │   (any nesting)  │
                                  └──────────────────┘
```

**How it works:**

1. You ask a question in the UI
2. Backend recursively scans `data/knowledge/` for all `.md` files
3. Each file is scored against your query using simple keyword matching
4. The top relevant files are sent to Claude as context
5. Claude answers based **only** on your notes and cites sources
6. The answer and source file paths are returned to the UI

## Quick Start

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)

### 1. Set your API key

```bash
cd backend
# Edit .env and replace 'your-api-key-here' with your actual key
```

### 2. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 3. Run

Open two terminals:

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

Open **http://localhost:5173** in your browser.

## Adding Knowledge

Drop `.md` files anywhere inside `data/knowledge/`:

```
data/knowledge/
├── llm/
│   ├── attention.md
│   └── transformer.md
├── karpathy/
│   └── micrograd.md
└── your-topic/
    └── anything.md
```

Files are auto-discovered on every search — no restart needed.

## API

| Method | Endpoint          | Description                        |
|--------|-------------------|------------------------------------|
| POST   | `/api/chat`       | Ask a question against your notes  |
| GET    | `/api/knowledge`  | List all discovered `.md` files    |

### POST `/api/chat`

```json
// Request
{ "message": "What did I learn about attention?" }

// Response
{
  "answer": "Based on your Second Brain notes...",
  "sources": ["llm/attention.md", "llm/transformer.md"]
}
```

### GET `/api/knowledge`

```json
{
  "files": ["llm/attention.md", "llm/transformer.md", "llm/gpt.md", "karpathy/micrograd.md"]
}
```

## Project Structure

```
karpathywiki/
├── backend/
│   ├── server.js          # Express API server
│   ├── package.json
│   ├── .env               # ANTHROPIC_API_KEY (not committed)
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # React UI
│   │   └── main.jsx       # Entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── data/
│   └── knowledge/         # Your Second Brain lives here
│       ├── llm/
│       └── karpathy/
└── README.md
```

## Security

- `ANTHROPIC_API_KEY` is only read server-side from `.env`
- Path traversal is blocked — only files inside `data/knowledge/` can be read
- Only `.md` files are served
