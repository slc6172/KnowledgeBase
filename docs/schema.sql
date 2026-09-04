-- ============================================================
-- GAS + Supabase 個人知識庫 — 資料庫 Schema
-- 設計依據:2026-08-15 grilling 訪談定案(見 DESIGN.md 決策紀錄)
-- ============================================================

-- 擴充套件
create extension if not exists vector;    -- pgvector,語意搜尋用
create extension if not exists pg_trgm;   -- trigram 模糊比對,中文友善的關鍵字搜尋

-- ------------------------------------------------------------
-- 分類(2 層:parent_id 為 null = 大分類,非 null = 子分類)
-- 是否為 2 層由應用層(GAS)檢查,DB 不強制,未來要開放更多層級不需改 schema。
-- ------------------------------------------------------------
create table categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid references categories(id) on delete set null,
  created_at timestamptz not null default now()
);

create index on categories (parent_id);

-- ------------------------------------------------------------
-- 標籤
-- ------------------------------------------------------------
create table tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 文章(核心內容,Markdown 原文;心得/歷程/成果都寫在 content_md 裡)
-- status: draft(草稿,不進搜尋索引) / published(正式,進搜尋索引)
-- embedding: 整篇文章一個向量(Gemini gemini-embedding-001,outputDimensionality: 768)
--   只在 status = 'published' 時產生/更新,草稿階段不呼叫 embedding API 省成本。
-- ------------------------------------------------------------
create table articles (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content_md  text not null,
  category_id uuid references categories(id) on delete set null,
  status      text not null default 'draft' check (status in ('draft', 'published')),
  embedding   vector(768),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on articles (category_id);
create index on articles (status);

-- updated_at 自動更新
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger articles_touch_updated_at
  before update on articles
  for each row execute function touch_updated_at();

-- 關鍵字搜尋索引(trigram,中英文皆可、不需斷詞)
create index articles_title_trgm_idx   on articles using gin (title gin_trgm_ops);
create index articles_content_trgm_idx on articles using gin (content_md gin_trgm_ops);

-- 語意搜尋索引(HNSW,cosine 距離)
create index articles_embedding_idx on articles using hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------------------
-- 文章 <-> 標籤(多對多)
-- ------------------------------------------------------------
create table article_tags (
  article_id uuid not null references articles(id) on delete cascade,
  tag_id     uuid not null references tags(id) on delete cascade,
  primary key (article_id, tag_id)
);

create index on article_tags (tag_id);

-- ------------------------------------------------------------
-- 附件(檔案/連結型;學習心得、實作歷程不算附件,屬於文章本文)
-- type = url 時只存 url,不佔用 Storage;其餘型態存進 Storage bucket "attachments"
--   路徑慣例:attachments/{article_id}/{uuid}_{file_name}
--
-- type 對照:
--   code      程式碼檔(.py / .js / .sql ...)
--   photo     圖檔(.png / .jpg / .gif / .webp ...)
--   zip       壓縮檔(.zip)
--   md_file   Markdown 筆記(.md)
--   office_doc Microsoft Office 文件(.doc/.docx/.xls/.xlsx/.ppt/.pptx)
--   pdf       PDF 檔(.pdf)
--   odf_doc   OpenDocument 文件(.odt/.ods/.odp)
--   url       外部連結(不佔 Storage)
-- ------------------------------------------------------------
create table attachments (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  type       text not null check (type in (
               'code', 'photo', 'zip', 'md_file',
               'office_doc', 'pdf', 'odf_doc', 'url'
             )),
  file_path  text,    -- Storage object path;type = 'url' 時為 null
  url        text,    -- 外部連結;type <> 'url' 時為 null
  file_name  text,    -- 原始檔名(顯示用)
  file_size  bigint,  -- bytes(code 型附件的線上預覽會用這欄位做大小上限判斷,見 DESIGN.md)
  created_at timestamptz not null default now(),
  constraint attachment_source_check check (
    (type = 'url' and url is not null and file_path is null) or
    (type <> 'url' and file_path is not null and url is null)
  )
);

create index on attachments (article_id);

-- ============================================================
-- Hybrid Search:pg_trgm(關鍵字)+ pgvector(語意)用 RRF 融合排序
-- 改編自 Supabase 官方 hybrid search pattern,關鍵字比對從 tsvector 換成
-- pg_trgm(zhparser 等中文斷詞套件 Supabase 未提供,trigram 對中文更合適)。
--
-- tag_ids 帶入時採 AND 語意:必須同時擁有所有指定標籤才會出現在結果中。
-- only_published 預設 true:草稿不會出現在搜尋結果,除非明確帶 false。
-- max_semantic_distance:語意比對的 cosine distance 門檻(0 = 完全相同,
--   2 = 完全無關),超過就不算是「有語意關聯」的結果、被排除掉。關鍵字那一半
--   (pg_trgm 的 % 運算子)本來就有內建門檻,語意那一半原本沒有,不管多不相關
--   都會回傳「最接近的」幾篇,加這個參數避免搜尋結果混進明顯不相關的文章。
--   0.6 是經驗值起點,依實際文章內容分佈調整,沒有放諸四海皆準的數字。
-- ============================================================
create or replace function hybrid_search_articles(
  query_text              text,
  query_embedding         vector(768),
  match_count             int default 20,
  full_text_weight        float default 1,
  semantic_weight         float default 1,
  rrf_k                   int default 50,
  only_published          boolean default true,
  tag_ids                 uuid[] default null,
  max_semantic_distance   float default 0.4,
  min_full_text_similarity float default 0.3
)
returns setof articles
language sql
as $$
  with tag_filtered as (
    select id from articles
    where tag_ids is null or array_length(tag_ids, 1) is null
       or id in (
         select article_id from article_tags
         where tag_id = any(tag_ids)
         group by article_id
         having count(distinct tag_id) = array_length(tag_ids, 1)
       )
  ),
  full_text as (
    select
      a.id,
      row_number() over (
        order by similarity(a.title || ' ' || a.content_md, query_text) desc
      ) as rank_ix
    from articles a
    join tag_filtered t on t.id = a.id
    where similarity(a.title || ' ' || a.content_md, query_text) >= min_full_text_similarity
      and (not only_published or a.status = 'published')
    order by rank_ix
    limit least(match_count, 30) * 2
  ),
  semantic as (
    select
      a.id,
      row_number() over (order by a.embedding <=> query_embedding) as rank_ix
    from articles a
    join tag_filtered t on t.id = a.id
    where a.embedding is not null
      and a.embedding <=> query_embedding < max_semantic_distance
      and (not only_published or a.status = 'published')
    order by rank_ix
    limit least(match_count, 30) * 2
  )
  select articles.*
  from full_text
    full outer join semantic on full_text.id = semantic.id
    join articles on coalesce(full_text.id, semantic.id) = articles.id
  order by
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
    coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    desc
  limit least(match_count, 30)
$$;

-- 使用範例(query_embedding 由 GAS 呼叫 Gemini gemini-embedding-001 產生後帶入):
-- select * from hybrid_search_articles(
--   'react 元件設計',
--   '[0.01, 0.02, ...]'::vector(768),
--   20
-- );

-- ============================================================
-- 相關文章推薦:純向量最近鄰搜尋,不做關鍵字比對。
-- 拿一篇已存在文章自己的 embedding 去找語意最相近的其他已發布文章——
-- 跟 hybrid_search_articles 共用同一個 max_semantic_distance 門檻概念,
-- 避免在文章數少的知識庫裡湊出明顯不相關的「相關文章」。
--
-- source_article_id 查無資料,或該文章本身還沒有 embedding(草稿、或
-- embedding 產生失敗)時,回傳空集合,不報錯——呼叫端(GAS)不需要另外
-- 判斷「這篇文章存不存在」。
-- ============================================================
create or replace function related_articles(
  source_article_id     uuid,
  match_count            int default 3,
  max_semantic_distance float default 0.6
)
returns setof articles
language sql
as $$
  select a.*
  from articles a
  join articles source on source.id = source_article_id
  where source.embedding is not null
    and a.id <> source_article_id
    and a.status = 'published'
    and a.embedding is not null
    and a.embedding <=> source.embedding < max_semantic_distance
  order by a.embedding <=> source.embedding
  limit match_count
$$;

-- 使用範例:
-- select * from related_articles('11111111-1111-1111-1111-111111111111', 3);

-- ============================================================
-- 附件資料夾分類(attachment-folders/01)——使用者自訂分組,跟附件既有的
-- 型態分類(code/photo/zip/...)正交、疊加使用。資料夾綁在單一篇文章底下
-- (不是跨文章共用的獨立附件庫),所以用 article_id 當作 unique 範圍,而不是
-- 全站唯一。attachments.folder_id 用 on delete set null(不是 cascade)——
-- 刪除資料夾只解散分組,裡面的附件不受影響。
-- ============================================================
create table attachment_folders (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (article_id, name)
);

create index on attachment_folders (article_id);

alter table attachments
  add column folder_id uuid references attachment_folders(id) on delete set null;
