-- ============================================================
-- GAS + Supabase 個人知識庫 — 資料庫 Schema
-- 設計依據:2026-08-15 grilling 訪談定案(見 DESIGN.md 決策紀錄)
--
-- 這份檔案描述「最終狀態」,用途是在一個全新的 Supabase 專案上從無到有建立
-- (貼到 SQL Editor 一次執行)。本專案不提供、也不維護「從舊版本升級」的腳本:
-- 資料表、欄位、索引都已直接寫進最終形狀,沒有 alter / drop 之類的補丁。
-- 另外兩件不在這份檔案裡的事,見 README「快速開始」:Storage bucket
-- `attachments`(private)要自己建立;Edge Function 代理要自己部署。
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

-- 關鍵字搜尋索引(trigram,中英文皆可、不需斷詞)。
-- 索引運算式必須與 hybrid_search_articles 全文比對用的運算式
-- `title || ' ' || content_md` 逐字相同,規劃器才用得上;分別對 title、
-- content_md 各建一個單欄位索引是用不上的(實測過是 Seq Scan)。
create index articles_title_content_trgm_idx
  on articles
  using gin ((title || ' ' || content_md) gin_trgm_ops);

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
-- 附件資料夾——使用者自訂分組,跟附件既有的型態分類(code/photo/zip/...)
-- 正交、疊加使用。資料夾綁在單一篇文章底下(不是跨文章共用的獨立附件庫),
-- 所以用 article_id 當作 unique 範圍,而不是全站唯一。
-- attachments.folder_id 用 on delete set null(不是 cascade)——刪除資料夾
-- 只解散分組,裡面的附件不受影響。
-- ------------------------------------------------------------
create table attachment_folders (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (article_id, name)
);

create index on attachment_folders (article_id);

-- ------------------------------------------------------------
-- 附件(檔案/連結型;學習心得、實作歷程不算附件,屬於文章本文)
-- type = url 時只存 url,不佔用 Storage;其餘型態存進 Storage bucket "attachments"
--   Storage 物件鍵:{article_id}/{uuid}[.副檔名](bucket 為 attachments;原始檔名
--   不進路徑,只存在 file_name 欄位,因此中文檔名不影響 Storage)
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
  folder_id  uuid references attachment_folders(id) on delete set null,
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
--   預設 0.4 是經驗值起點,依實際文章內容分佈調整,沒有放諸四海皆準的數字。
--   前端(JavaScript.html)與 AI 問答(RagChat.gs)會明確帶入同一個 0.4,
--   改預設值時要一併檢查這兩處。
-- min_full_text_similarity:關鍵字那一半的 trigram 相似度下限(預設 0.3)。
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
-- 標籤篩選文章列表,篩選/排序/分頁都在 SQL 端完成(見
-- docs/specs/spec_tag_filter_pagination.md)。原因:在 GAS 端先撈出「同時
-- 擁有全部指定標籤」的所有文章 id、再塞進網址,會撞上 URL 長度上限(約 42 篇
-- 就會失敗);改成 SQL 端 limit/offset 後,GAS 只需處理「這一頁」的結果。
-- 沿用 hybrid_search_articles 的 AND 語意;不做全文/語意排序,依 updated_at。
--
-- tag_ids 採 AND 語意,跟 hybrid_search_articles 一致:必須同時擁有所有
-- 指定標籤才會出現在結果中。status_filter/category_id_filter 為 null 時
-- 不套用該條件,語意對齊 GAS 端 listArticles「沒帶這個篩選條件就不篩」的
-- 既有行為。tag_ids 沒有預設值(必填)——這個函式只給「真的有標籤篩選」的
-- 情境用,呼叫端(listArticles)沒有標籤篩選時完全不會呼叫這裡,不需要像
-- hybrid_search_articles 那樣容忍 tag_ids 是 null/空陣列的情況。
-- ============================================================
create or replace function articles_by_tags(
  tag_ids             uuid[],
  status_filter       text default null,
  category_id_filter  uuid default null,
  lim                 int default 50,
  off                 int default 0
)
returns setof articles
language sql
as $$
  select a.*
  from articles a
  where a.id in (
    select article_id from article_tags
    where tag_id = any(tag_ids)
    group by article_id
    having count(distinct tag_id) = array_length(tag_ids, 1)
  )
  and (status_filter is null or a.status = status_filter)
  and (category_id_filter is null or a.category_id = category_id_filter)
  order by a.updated_at desc
  limit lim
  offset off
$$;

-- 使用範例:
-- select * from articles_by_tags(
--   array['11111111-1111-1111-1111-111111111111']::uuid[],
--   'published', null, 50, 0
-- );


-- ============================================================
-- Row Level Security(縱深防禦,不是這個 app 的主要防線)
-- 存取路徑:瀏覽器 → GAS → Edge Function 代理 `kb-proxy` → Supabase。只有代理
-- 持有新版 secret key(service_role 等級,會繞過 RLS);GAS 不持有任何
-- Supabase 金鑰,前端也從不直接呼叫 Supabase 的資料 API,所以 RLS 開不開,
-- 對這個 app 的任何功能都沒有影響。
--
-- 這裡還是把 RLS 打開、刻意不建立任何 policy——Supabase 對「RLS 打開但沒有
-- policy」的表,預設對 anon / authenticated 角色全部拒絕讀寫。以後如果專案的
-- publishable(anon)key 不小心被貼到某個地方,這層能擋住用它讀寫任何一張表,
-- 不會直接變成整個資料庫對外開放。成本是 0。
--
-- 這不是「已經足夠」的資安措施。真正的防線是:(1) 代理的共用密鑰與路徑白名單
-- (supabase/functions/kb-proxy/handler.ts);(2) Storage bucket `attachments`
-- 必須是 private——bucket 的 public / private 不是這份檔案管得到的設定,請在
-- Supabase Dashboard 的 Storage 頁面自己核對。
-- ============================================================
alter table categories enable row level security;
alter table tags enable row level security;
alter table articles enable row level security;
alter table article_tags enable row level security;
alter table attachments enable row level security;
alter table attachment_folders enable row level security;
