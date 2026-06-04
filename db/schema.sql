-- EFK Audits RAG — isolated schema (efk_ prefix) to coexist with other apps in the same project.
-- Run in Supabase SQL Editor.

create extension if not exists vector;

create table if not exists efk_audits (
  group_key       text primary key,
  folder_id       integer,
  number          text,
  year            integer,
  date_published  date,
  title_fr        text,
  title_de        text,
  title_en        text,
  title_it        text,
  url_fr          text,
  url_de          text,
  url_en          text,
  url_it          text
);

-- Embeddings: Bge Multilingual Gemma2 = 3584 dims. pgvector HNSW supports <=2000 dims for `vector`,
-- so we use `halfvec(3584)` (HNSW supports halfvec up to 4000 dims).
create table if not exists efk_chunks (
  id            bigint generated always as identity primary key,
  group_key     text references efk_audits(group_key) on delete cascade,
  folder_id     integer,
  language      text not null,
  position      integer,
  content       text not null,
  content_hash  text not null unique,
  embedding     halfvec(3584),
  fts           tsvector generated always as (to_tsvector('simple', content)) stored
);

create index if not exists efk_chunks_embedding
  on efk_chunks using hnsw (embedding halfvec_cosine_ops);
create index if not exists efk_chunks_fts on efk_chunks using gin (fts);
create index if not exists efk_chunks_language on efk_chunks (language);
create index if not exists efk_chunks_group on efk_chunks (group_key);
