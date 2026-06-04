import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';
import { DB_PATH, DATA_DIR, PDF_DIR } from './config.js';

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(PDF_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
create table if not exists pages (
  url             text primary key,
  lang            text not null,
  group_key       text not null,
  title           text,
  description     text,
  date_published  text,
  date_modified   text,
  folder_id       integer,
  http_status     integer,
  fetched_at      text
);
create index if not exists pages_group on pages(group_key);

create table if not exists audits (
  group_key       text primary key,
  folder_id       integer,
  year            integer,
  number          text,
  date_published  text,
  title_fr        text,
  title_de        text,
  title_en        text,
  title_it        text,
  url_fr          text,
  url_de          text,
  url_en          text,
  url_it          text
);

create table if not exists pdfs (
  url             text primary key,
  group_key       text,
  folder_id       integer,
  kind            text not null,
  lang            text,
  local_path      text,
  bytes           integer,
  sha256          text,
  page_count      integer,
  http_status     integer,
  downloaded_at   text
);
create index if not exists pdfs_group on pdfs(group_key);

create table if not exists chunks (
  id            integer primary key autoincrement,
  pdf_url       text not null,
  group_key     text,
  folder_id     integer,
  lang          text not null,
  position      integer not null,
  content       text not null,
  content_hash  text not null unique,
  char_len      integer,
  created_at    text
);
create index if not exists chunks_pdf on chunks(pdf_url);
create index if not exists chunks_group on chunks(group_key);
`);

export function nowIso(): string {
  return new Date().toISOString();
}
