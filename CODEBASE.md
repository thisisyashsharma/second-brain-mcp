# KarpathyWiki — Code Reference (Every Function & Route Explained)

> **Purpose**: A line-by-line explanation of every function, route, and component in the codebase. Give this to an LLM alongside `ARCHITECTURE.md` for complete project understanding.

---

## Backend — `backend/server.js` (418 lines, single file)

### Imports & Constants

```js
import "dotenv/config";          // loads .env into process.env
import express from "express";
import cors from "cors";
import fs from "fs/promises";     // async file system
import path from "path";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
```

```js
const KNOWLEDGE_DIR = path.resolve(__dirname, "..", "data", "knowledge");
const INTERNSHIP_DIR = path.resolve(__dirname, "..", "data", "internship");
```

- `KNOWLEDGE_DIR`: absolute path to `data/knowledge/` — where all searchable notes live
- `INTERNSHIP_DIR`: absolute path to `data/internship/` — where internship updates are saved (NOT searched by the brain)

---

### `STOP_WORDS` (Set of ~100 English words)

Used to filter query words. Words like "the", "is", "what", "how", "my", etc. are removed before scoring so they don't inflate relevance scores.

---

### Helper Functions

#### `discoverMarkdownFiles(dir, base)`
- **What**: Recursively walks a directory tree and collects all `.md` files
- **Returns**: Array of relative paths with forward slashes, e.g. `["llm/attention.md", "karpathy/micrograd.md"]`
- **Error handling**: If a directory can't be read, returns `[]` (graceful)
- **Used by**: `GET /api/knowledge`, `POST /api/chat`

#### `readKnowledgeFile(relativePath)`
- **What**: Reads a `.md` file from `data/knowledge/` safely
- **Security**: Resolves the full path and checks it starts with `KNOWLEDGE_DIR` — blocks `../../etc/passwd` style attacks
- **Returns**: File content as UTF-8 string

#### `escapeRegex(str)`
- Escapes special regex characters so user input can be safely used in `new RegExp()`

#### `normalize(text)`
- Lowercases, strips all punctuation (replaces with spaces), collapses multiple spaces
- Example: `"What is Attention?!"` → `"what is attention"`

#### `extractKeywords(query)`
- Normalizes the query, splits on spaces
- Filters out: words ≤ 1 character AND stop words
- Example: `"What did Karpathy teach about micrograd?"` → `["karpathy", "teach", "micrograd"]`

#### `extractPhrases(query)`
- Takes the filtered keyword list (same as `extractKeywords`)
- Generates bigrams (2-word) and trigrams (3-word) from consecutive keywords
- Example from `["karpathy", "teach", "micrograd"]`:
  - Bigrams: `["karpathy teach", "teach micrograd"]`
  - Trigrams: `["karpathy teach micrograd"]`

#### `extractHeadings(content)`
- Parses markdown content line by line
- Extracts text from heading lines (`# Heading` through `###### Heading`)
- Normalizes each heading
- Returns array of normalized heading strings

#### `countWord(text, word)`
- Counts occurrences of `word` in `text` using word-boundary-aware regex (`\b`)
- Case insensitive
- Example: `countWord("attention is the core of self-attention", "attention")` → `2`

#### `countPhrase(normalizedText, phrase)`
- Counts non-overlapping occurrences of a phrase substring in text
- Simple `indexOf` loop

#### `sanitizeFilename(name)`
- Converts to lowercase
- Removes all chars except `a-z`, `0-9`, spaces, hyphens
- Replaces spaces with hyphens, collapses multiple hyphens
- Trims leading/trailing hyphens
- Falls back to `"untitled"` if empty
- Example: `"Self Attention!"` → `"self-attention"`

#### `sanitizeFolderPath(folder)`
- Splits on `/` or `\`
- Removes empty segments, `.`, and `..` (path traversal protection)
- Sanitizes each segment with `sanitizeFilename()`
- Rejoins with `/`
- Example: `"../../ai/llm"` → `"ai/llm"`

---

### Scoring System

#### Weights Object
```js
const WEIGHTS = {
  FILENAME_MATCH: 10,   // keyword found in file path
  HEADING_MATCH: 5,     // keyword found in a markdown heading
  CONTENT_MATCH: 1,     // keyword found in body text
  PHRASE_MATCH: 8,      // multi-word phrase found in content
  TITLE_EXACT: 15,      // filename (without .md) exactly matches a keyword
};
```

#### `scoreFile(filePath, content, keywords, phrases)`
Calculates a single integer score for how relevant a file is to a query.

**Scoring steps (additive):**
1. **Title exact match** (+15 each): If the filename without `.md` exactly equals a keyword
2. **Path keyword match** (+10 per occurrence): Keyword appears anywhere in the file path
3. **Heading keyword match** (+5 per occurrence): Keyword appears in any markdown heading
4. **Content keyword match** (+1 per occurrence): Keyword appears anywhere in body
5. **Phrase match** (+8 per occurrence): A bigram/trigram appears in the content

**Example scoring for query "What is attention?":**
- `llm/attention.md`: +15 (title exact) + 10 (path) + 5+5 (headings) + 23 (content) = 58
- `llm/transformer.md`: +6 (content mentions "attention" a few times)
- `karpathy/micrograd.md`: 0 (no matches)

---

### Routes

#### `GET /api/knowledge`
1. Call `discoverMarkdownFiles(KNOWLEDGE_DIR)`
2. Return `{ files: [...] }`

#### `POST /api/chat`
1. Validate `message` field exists and is a non-empty string
2. Discover all `.md` files
3. If no files exist → return "Your Second Brain is empty" message
4. Extract keywords and phrases from the message
5. Score every file
6. Sort descending, take top 5 with score > 0
7. **If matches found**: Build system prompt injecting note contents with instruction "answer from these notes, cite files, don't make things up"
8. **If no matches**: Build system prompt saying "no relevant notes found, tell user clearly, provide general answer if possible"
9. Call Claude API: `anthropic.messages.create()` with `model: "claude-sonnet-4-20250514"`, `max_tokens: 1024`
10. Return `{ answer: "...", sources: ["file1.md", ...] }`

#### `POST /api/knowledge`
1. Validate `title` and `content` are non-empty strings
2. Sanitize folder path and filename
3. Build full target path, verify it's inside `KNOWLEDGE_DIR`
4. Write file as `# {title}\n\n{content}\n`
5. Create directories as needed (`fs.mkdir recursive`)
6. Return `{ path: "relative/path.md" }`

#### `POST /api/internship`
1. Validate `update` is a non-empty string
2. Generate filename from today's date: `YYYY-MM-DD.md`
3. If file already exists for today → **append** new entry with `---` separator
4. If new file → write fresh content
5. Save to `data/internship/`
6. Return `{ path: "internship/YYYY-MM-DD.md" }`

---

## Frontend — `frontend/src/App.jsx` (330 lines, single component)

### State Variables

```
Search:      query, answer, sources, loading, error
Knowledge:   kTitle, kContent, kFolder, kStatus
Internship:  iTitle, iUpdate, iStatus
```

All state is local React `useState` — no global state management, no context, no Redux.

### Event Handlers

#### `handleSearch(e)`
- `POST /api/chat` with `{ message: query }`
- On success: sets `answer` and `sources`
- On error: sets `error` message

#### `handleAddKnowledge(e)`
- `POST /api/knowledge` with `{ title, content, folder }`
- On success: shows "✅ Created: path", clears form
- On error: shows "❌ error message"

#### `handleInternship(e)`
- `POST /api/internship` with `{ title, update }`
- On success: shows "✅ Saved: path", clears form
- On error: shows "❌ error message"

### UI Layout (top to bottom)

1. **Header**: `🧠 My Second Brain`
2. **Search bar**: text input + blue "Search My Brain" button (horizontal)
3. **Error display**: red box if error
4. **Result box**: Answer text + Sources list (if answer exists)
5. **Divider**
6. **Add Knowledge form**: Title input, Folder input, Content textarea, green "Save Knowledge" button (vertical)
7. **Divider**
8. **Internship Update form**: Title input, Update textarea, teal "Save Update" button (vertical)

### Styling

All styles are inline JavaScript objects — no CSS files, no Tailwind, no CSS-in-JS library:
- Blue buttons for search (`#2563eb`)
- Green button for knowledge (`#16a34a`)
- Teal button for internship (`#0d9488`)
- Max width 720px, centered
- System font stack

---

## Frontend — `frontend/vite.config.js`

```js
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
```

All `/api/*` requests from the frontend are proxied to the Express backend. This means:
- In development: frontend on `:5173`, backend on `:3001`
- The browser never directly contacts port 3001
- No CORS issues in development

---

## Knowledge Files (Starter Content)

### `data/knowledge/llm/attention.md`
Covers: scaled dot-product attention, multi-head attention, self-attention, Q/K/V explanation, `sqrt(d_k)` scaling.

### `data/knowledge/llm/transformer.md`
Covers: encoder-decoder structure, layer composition, positional encoding (sinusoidal formula), why Transformers work (parallelizable, constant path length).

### `data/knowledge/llm/gpt.md`
Covers: GPT as decoder-only Transformer, pre-training + fine-tuning, in-context learning, GPT-1 through GPT-4 comparison table.

### `data/knowledge/karpathy/micrograd.md`
Covers: Karpathy's autograd engine, `Value` class with `.data`, `.grad`, `._backward`, backpropagation via reverse topological sort, MLP built on top.

### `data/knowledge/test/deep/test-note.md`
Contains the unique sentence: *"The quantum flamingo dances at midnight under a binary moon."* — used to verify deeply nested file discovery works.

---

## Key Design Decisions

1. **No database** — Markdown files on disk are the single source of truth. Files are re-scanned on every request, so new files are instantly discoverable.

2. **Keyword scoring, not embeddings** — Keeps the app zero-dependency on ML infrastructure. The tradeoff is no semantic understanding (can't find "backpropagation" when user asks about "training neural networks").

3. **Two separate data directories** — `data/knowledge/` is searchable, `data/internship/` is not. This is intentional so daily logs don't pollute brain search results.

4. **Append behavior for internship** — Multiple updates on the same day are appended to the same file rather than overwriting, separated by `---`.

5. **Claude gets a different prompt when nothing matches** — Instead of refusing to answer, Claude is told to give a general answer but clearly state it's not from the wiki.

6. **Max 5 sources** — Only the top 5 scored files are sent to Claude to stay within reasonable context limits.

7. **Single-file backend, single-component frontend** — Intentional simplicity. No routers, no controllers, no services layer, no component hierarchy.
