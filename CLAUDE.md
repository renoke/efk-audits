# CLAUDE.md — EFK Audits RAG

Project context for Claude Code. Read entirely before any action.

## Objective

Semantic search + AI chat on **200-250 Swiss audit reports** (EFK — Eidgenössisches Finanzkontrollorgan) in **4 languages** (FR, DE, EN, IT). User asks question in any language, app retrieves relevant audit sections, **Mistral LLM responds in user's language**, with citations.

Two separate components (never mixed):
1. **`ingest/`** — batch pipeline (scrape → download PDFs → extract → chunk → embed → store). Run locally, not deployed.
2. **`app/`** — Next.js web app (search + chat). Only retrieves & generates.

## Non-negotiable constraints

- **Copyright** — Audit reports belong to EFK. Verify `https://www.efk.admin.ch/robots.txt` and copyright page before scraping. Rate-limit (≥2s between requests). Chat **never reproduces full audit**, only synthesizes sections with citations. Always cite: report #, title, date, link.
- **Anti-hallucination** — LLM answers **only from retrieved context**. If no match: "I didn't find this in the audit reports."
- **Multilingual citations** — Every response must cite source audits: "**EFK 2024-XX**: Audit Title (FR)" with link.
- **Idempotence** — Re-running ingestion must not duplicate chunks. Hash-based dedup across all 4 languages.
- **Language-agnostic responses** — User can ask in FR/DE/EN/IT. Chat detects language and responds in the same language.

## Stack (final decisions)

- **Language** — TypeScript.
- **Framework** — **Next.js (App Router)**.
- **Chat** — Vercel AI SDK (`streamText` server-side, `useChat` client-side).
- **LLM** — **Infomaniak: `mistralai/Ministral-3-14B-Instruct-2512`** (supports FR/DE/EN/IT).
- **Embeddings** — **Infomaniak: `Bge Multilingual Gemma2`** (3584 dims, 100+ languages).
- **Re-ranking** — **Infomaniak: `BAAI/bge-reranker-v2-m3`** (multilingual, for hybrid search).
- **Database** — **Supabase Postgres + pgvector** (vector + full-text + language tags).

### Embedding model

**Bge Multilingual Gemma2**: 3584 dimensions, supports FR/DE/EN/IT explicitly. All chunks tagged with `language` field for filtering/analytics.

## Data source

- **Index page** — `https://www.efk.admin.ch/fr/rapports/` (list of ~200-250 audits with metadata).
- **PDF per audit, 4 languages** — pattern like `https://www.efk.admin.ch/.../report-2024-xx-fr.pdf` (verify exact URL pattern during Phase 1).
- **Prioritize PDFs** (structured, clean) over HTML.

## Repo structure

```
/
├── CLAUDE.md
├── ingest/
│   ├── 1-fetch-index.ts        # Scrape audit index (FR page), extract metadata
│   ├── 2-download-pdfs.ts      # Download all 4 language versions (rate-limited)
│   ├── 3-extract-chunk.ts      # PDF→text→chunks, tag language, dedupe
│   ├── 4-embed-store.ts        # Embed via Infomaniak, store idempotently
│   └── lib/
│       ├── infomaniak.ts       # API client (embeddings + LLM)
│       └── pdf-extract.ts      # PDF text extraction
│
├── app/
│   ├── app/
│   │   ├── page.tsx            # UI chat (useChat, sources clickable)
│   │   └── api/chat/route.ts   # streamText + retrieval (Node.js runtime)
│   └── lib/
│       ├── retrieval.ts        # Hybrid search, re-rank, query rewrite
│       ├── supabase.ts         # Client (pooler)
│       └── language.ts         # Detect user language, format response
│
├── db/
│   ├── schema.sql              # Vector + full-text + language tags
│   └── search_hybrid.sql       # RPC for hybrid search
│
├── eval/
│   ├── testset.json            # 20-30 (question, audit refs) pairs in FR/DE/EN
│   └── run-eval.ts             # Recall@k
│
└── model.env                   # LLM config (temperature, language response rules)
```

## Database schema (reference)

```sql
create extension if not exists vector;

create table audits (
  id          int primary key,
  year        int,
  number      text,                           -- e.g., "2024-01"
  title_fr    text,
  title_de    text,
  title_en    text,
  title_it    text,
  date_published date,
  url_base    text                            -- e.g., https://www.efk.admin.ch/.../2024-01
);

create table chunks (
  id              bigint generated always as identity primary key,
  audit_id        int references audits(id),
  language        text not null,               -- 'fr' | 'de' | 'en' | 'it'
  position        int,
  content         text not null,
  content_hash    text not null unique,        -- hash(content) for dedup across langs
  embedding       vector(3584),                -- Bge Multilingual Gemma2
  fts             tsvector generated always as (to_tsvector('english', content)) stored
);

create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks using gin (fts);
create index on chunks(language);
create index on chunks(audit_id);
```

## Retrieval (quality core)

Hybrid search in a Postgres RPC:
1. **Vector search** (cosine, HNSW) — top-N by semantic similarity.
2. **Full-text search** (BM25-like) — top-N by keyword match.
3. **Fusion** — Reciprocal Rank Fusion (RRF).
4. **Re-rank** — Infomaniak `bge-reranker-v2-m3` on top-k.
5. **Return** — chunks + audit metadata (title in user's language).

**Before embedding user query:**
- **Language detection** — detect if FR/DE/EN/IT.
- **Query rewriting** — optional: rephrase if vague (e.g., "financial audit" → "audit financier" if FR).

## Chat flow

1. User sends message (any language).
2. Detect user language → will respond in that language.
3. Embed query with Infomaniak embeddings.
4. Hybrid search → retrieve top chunks.
5. Extract audit references → build "Available audits:" list.
6. Call Mistral with context + references.
7. **Mistral responds in user's language** (system prompt enforces this).
8. Stream response to client.
9. Parse markdown + render.

## Commands (to be added)

```bash
# Ingest
npm run ingest:index      # 1-fetch-index
npm run ingest:download   # 2-download-pdfs
npm run ingest:chunk      # 3-extract-chunk
npm run ingest:embed      # 4-embed-store

# Database
npm run db:migrate        # schema.sql + search_hybrid.sql

# App
npm run dev               # Next.js dev
npm run eval              # Recall@k on eval/testset.json

# Quality
npm run typecheck
npm run lint
```

## Configuration (model.env)

```
# Mistral LLM
LLM_MODEL=mistralai/Ministral-3-14B-Instruct-2512
LLM_TEMPERATURE=0.7
LLM_FREQUENCY_PENALTY=0.3
LLM_TOP_P=0.95

# Embeddings
EMBEDDING_MODEL=Bge Multilingual Gemma2

# Retrieval
RETRIEVAL_TOP_K=10
RETRIEVAL_VECTOR_WEIGHT=0.6
RETRIEVAL_TEXT_WEIGHT=0.4

# System Prompt
SYSTEM_PROMPT=You are an expert analyst of Swiss EFK (Federal Audit Office) audit reports. Users ask in FR, DE, EN, or IT. You respond in the user's language using the provided context only. Format responses in markdown with clear sections. Always cite source audits: "**EFK YYYY-XX**: Title". If you cannot find relevant information, say so honestly. Never fabricate audit details.
```

## Conventions

- **TypeScript strict**, no silent `any`.
- **Secrets only via env** (`.env`, never commit): `INFOMANIAK_API_KEY`, `SUPABASE_*`.
- **Connection pooler** on Supabase (port 6543 for serverless).
- **Pipeline never imported by app**.
- **All network calls** — retry with exponential backoff.
- **Language tagging** — every chunk tagged with language field.

## Known pitfalls

- **Infomaniak rate limits** — respect API quotas. Use backoff.
- **PDF structure varies** — EFK audits may have different layouts; chunking strategy must adapt (chapters, sections, not fixed windows).
- **Language dedup** — same audit content in 4 languages → same `content_hash` if truly identical (translations won't be). Decide: embed once or 4×?
- **pgvector 3584 dims** — ensure Supabase project supports this (usually yes).
- **Mistral multilingual** — verify language detection works; Mistral is good at it.

## Do NOT

- Never publish full audit text in chat response.
- Never embed HTML; extract clean text from PDFs first.
- Never mix ingestion + app code.
- Never change embedding dimensions without re-embedding all chunks.
- Never respond outside context (audit reports only).

## Phases

- [ ] **Phase 1** — Research (verify copyright, download samples, test Infomaniak API).
- [ ] **Phase 2** — Ingestion (index → PDFs → chunks → embed → store).
- [ ] **Phase 3** — Search + chat (hybrid search, Mistral integration, language detection).
- [ ] **Phase 4** — UI + deploy (Vercel, eval, polish).

## Status

Starting Phase 1.
