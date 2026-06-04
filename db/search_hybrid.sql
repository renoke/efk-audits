-- Hybrid search (vector + full-text) fused with Reciprocal Rank Fusion.
-- Re-ranking (bge-reranker-v2-m3) is applied afterwards in app code, not here.
-- Run in Supabase SQL Editor after schema.sql.

create or replace function efk_search_hybrid(
  query_embedding halfvec(3584),
  query_text      text,
  match_count     int default 20,
  rrf_k           int default 50,
  filter_language text default null
)
returns table (
  id             bigint,
  group_key      text,
  folder_id      int,
  language       text,
  "position"     int,
  content        text,
  score          double precision
)
language sql stable
as $$
  with vec as (
    select c.id,
           row_number() over (order by c.embedding <=> query_embedding) as rank
    from efk_chunks c
    where filter_language is null or c.language = filter_language
    order by c.embedding <=> query_embedding
    limit match_count * 4
  ),
  fts as (
    select c.id,
           row_number() over (
             order by ts_rank_cd(c.fts, websearch_to_tsquery('simple', query_text)) desc
           ) as rank
    from efk_chunks c
    where (filter_language is null or c.language = filter_language)
      and c.fts @@ websearch_to_tsquery('simple', query_text)
    limit match_count * 4
  ),
  fused as (
    select coalesce(vec.id, fts.id) as id,
           coalesce(1.0 / (rrf_k + vec.rank), 0.0)
         + coalesce(1.0 / (rrf_k + fts.rank), 0.0) as score
    from vec
    full outer join fts on vec.id = fts.id
  )
  select c.id, c.group_key, c.folder_id, c.language, c.position, c.content, f.score
  from fused f
  join efk_chunks c on c.id = f.id
  order by f.score desc
  limit match_count;
$$;
