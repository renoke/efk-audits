# Deploy (Vercel)

Only the Next.js app in **`app/`** is deployed. The ingestion pipeline (`ingest/`, `db/`, `eval/`, `data/`) and the native `better-sqlite3` dependency stay local and are excluded automatically because Vercel's **Root Directory** is set to `app/`.

`app/` is self-contained: it has its own `app/package.json` (app deps only) and `app/model.env` (non-secret model config, committed). Secrets live only in Vercel's env settings.

## A. Dashboard (recommended)

1. Push the repo to GitHub/GitLab/Bitbucket.
2. Vercel → **Add New… → Project** → import the repo.
3. **Root Directory** → set to **`app`** (Edit → select `app`). Framework auto-detects **Next.js**.
4. Add **Environment Variables** (Production + Preview):

   | Name | Value | Notes |
   |---|---|---|
   | `INFOMANIAK_TOKEN` | *(your token)* | secret |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://mvsevzjyfnuskmnbjoqf.supabase.co` | |
   | `SUPABASE_SERVICE_ROLE_KEY` | *(your service role key)* | secret, server-only |

   Optional overrides (defaults already in `app/model.env`): `LLM_MODEL`, `EMBEDDING_MODEL`, `RERANK_MODEL`, `INFOMANIAK_PRODUCT_ID`, `LLM_TEMPERATURE`, `RETRIEVAL_CANDIDATES`, `RETRIEVAL_TOP_K`, `SYSTEM_PROMPT`.

5. **Deploy**.

## B. CLI

```bash
cd app
vercel login
vercel link            # create/link the project (Root Directory = current dir)
# add env vars:
vercel env add INFOMANIAK_TOKEN production
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel --prod
```

## Notes

- **No DB connection limits**: the app talks to Supabase over REST (PostgREST via `@supabase/supabase-js`) and to Infomaniak over HTTPS — both serverless-friendly. No Postgres pooler needed at runtime.
- **Chat route** runs on the Node runtime (`runtime = 'nodejs'`) and streams Server-Sent Events; `maxDuration = 60` (fits Vercel Hobby). Raise it on Pro if needed.
- **Secrets never ship**: `.env.local` (and the `app/.env.local` symlink used for local dev) are gitignored; production secrets come only from Vercel env settings.
- **Latency**: Infomaniak is in CH. Optionally pin the Vercel function region near your Supabase region.
- The DB is shared with another app; this deployment only reads/writes the `efk_*` tables via the service-role key.
