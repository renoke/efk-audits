# EFK Audits RAG

Semantic search and AI chat on 200-250 Swiss audit reports (EFK) in 4 languages (FR, DE, EN, IT).

## Quick Start

1. Read `CLAUDE.md` for full project context
2. **Phase 1**: Research (verify copyright, test Infomaniak API)
3. **Phase 2**: Ingest (scrape index, download PDFs, chunk, embed)
4. **Phase 3**: Build chat (search, retrieval, Mistral integration)
5. **Phase 4**: Deploy (Vercel)

## Project Structure

```
ingest/     - Batch pipeline (local only)
app/        - Next.js chat app
db/         - Supabase schema + RPC
eval/       - Evaluation testsets
model.env   - Configuration
```

## Key Tech

- **LLM**: Mistral 3.14B via Infomaniak
- **Embeddings**: Bge Multilingual Gemma2 (3584 dims)
- **Database**: Supabase + pgvector
- **App**: Next.js + Vercel AI SDK

See `CLAUDE.md` for details.
