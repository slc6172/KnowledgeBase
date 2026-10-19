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
-- 擴充功能一律放在 extensions schema,不放 public:public 裡的函式與型別會出現在 Supabase 的
-- API 裡(安全顧問 Lint 0014)。Supabase 專案出廠就有 extensions schema,這行只是讓這份檔案在
-- 任何 PostgreSQL 上都能獨立執行。型別與運算子類別下面一律寫全限定名稱(extensions.xxx),
-- 不依賴使用者的 search_path。
create schema if not exists extensions;
create extension if not exists vector  with schema extensions;  -- pgvector,語意搜尋用
create extension if not exists pg_trgm with schema extensions;  -- trigram 模糊比對,中文友善的關鍵字搜尋

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
-- 搜尋用的向量不放在這裡:一篇文章切成多段、每段各有一個向量,存在 article_chunks
--   (見下方)。只在 status = 'published' 時產生/更新,草稿階段不呼叫 embedding API 省成本。
-- ------------------------------------------------------------
create table articles (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  content_md  text not null,
  category_id uuid references categories(id) on delete set null,
  status      text not null default 'draft' check (status in ('draft', 'published')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on articles (category_id);
create index on articles (status);

-- updated_at 自動更新
create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public, extensions as $$
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
  using gin ((title || ' ' || content_md) extensions.gin_trgm_ops);

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
-- 文章段落與段落向量(語意搜尋與相關文章的檢索單位)
-- 為什麼要分段:嵌入模型單筆輸入上限約 2,048 token,整篇只算一個向量時,長文後半段
-- 被靜默截斷、對檢索而言不存在。每篇已發布文章切成多段(每段最多約 1,500 字,切法見
-- src/Chunking.gs),每段各有一個向量;搜尋與相關文章取「該文章最接近的那一段」的距離。
-- - 存段落「文字」而不是在 content_md 裡的起訖位置:JavaScript 與 PostgreSQL 計算字元
--   位置的方式不同(代理對、表情符號會對不齊),存位置會悄悄切錯段落。
-- - embedding_model 記錄這段向量是哪個模型產生的;換模型後,重建工具靠它找出待重建的文章。
-- - 不對 GAS 開放(不在代理的資料表白名單內):所有讀寫都經 save_article /
--   articles_needing_reindex 這類函式。
-- ------------------------------------------------------------
create table article_chunks (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references articles(id) on delete cascade,
  chunk_index     int  not null check (chunk_index >= 0),
  content         text not null,
  embedding       extensions.vector(768) not null,
  embedding_model text not null,
  created_at      timestamptz not null default now(),
  unique (article_id, chunk_index)
);

create index article_chunks_embedding_idx
  on article_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

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
-- 語意那一路以「段落」為單位:每篇文章取它「最接近查詢的那一段」的 cosine 距離當作這篇文章的
-- 語意距離,所以長文的任何位置符合都找得到(整篇只算一個向量時,超過模型輸入上限的後半段
-- 被靜默截斷,對檢索而言不存在——見 article_chunks 的說明)。關鍵字那一路仍然拿整篇
-- 標題 + 內文做 trigram 比對;長文對短查詢的 trigram 相似度本來就很低,這一路對長文偏弱,
-- 是已知限制(要改需要另建段落層級的 trigram 索引)。
--
-- 回傳:文章 id(依融合後的相關度排序),以及語意那一路命中的段落序號、段落文字與距離;
-- 只由關鍵字命中的文章這三個欄位是 null。GAS 目前只取 id,再另外查詢整列補上分類與標籤;
-- 命中段落是為「AI 問答只送命中段落」預先備好的資料(spec_chunked_embeddings 的後續項目)。
--
-- tag_ids 帶入時採 AND 語意:必須同時擁有所有指定標籤才會出現在結果中。
-- only_published 預設 true:草稿不會出現在搜尋結果,除非明確帶 false。
-- max_semantic_distance:語意比對的 cosine distance 門檻(0 = 完全相同,
--   2 = 完全無關),超過就不算是「有語意關聯」的結果、被排除掉。關鍵字那一半
--   (pg_trgm 的 % 運算子)本來就有內建門檻,語意那一半原本沒有,不管多不相關
--   都會回傳「最接近的」幾篇,加這個參數避免搜尋結果混進明顯不相關的文章。
--   預設 0.4 是用「整篇一個向量」校準的經驗值起點;改成段落之後距離分布可能不同,
--   實際資料累積後再量測是否需要調整。沒有放諸四海皆準的數字。
--   前端(JavaScript.html)與 AI 問答(RagChat.gs)會明確帶入同一個 0.4,
--   改預設值時要一併檢查這兩處。
-- min_full_text_similarity:關鍵字那一半的 trigram 相似度下限(預設 0.3)。
--
-- 效能備註:語意那一路先篩出門檻內的段落、再對每篇文章取最近的一段(視窗函式),沒有用到
-- HNSW 索引做近似最近鄰;以個人 / 小團隊知識庫的規模(數百篇、數千段)是足夠的。若段落數成長到
-- 數十萬,再改成「先用索引取前 N 段、再依文章彙總」。
-- ============================================================
create or replace function hybrid_search_articles(
  query_text              text,
  query_embedding         extensions.vector(768),
  match_count             int default 20,
  full_text_weight        float default 1,
  semantic_weight         float default 1,
  rrf_k                   int default 50,
  only_published          boolean default true,
  tag_ids                 uuid[] default null,
  max_semantic_distance   float default 0.4,
  min_full_text_similarity float default 0.3
)
returns table (
  id                  uuid,
  best_chunk_index    int,
  best_chunk_content  text,
  semantic_distance   float8
)
language sql
set search_path = public, extensions
as $$
  with tag_filtered as (
    select a.id as article_id from articles a
    where tag_ids is null or array_length(tag_ids, 1) is null
       or a.id in (
         select at.article_id from article_tags at
         where at.tag_id = any(tag_ids)
         group by at.article_id
         having count(distinct at.tag_id) = array_length(tag_ids, 1)
       )
  ),
  full_text as (
    select
      a.id as article_id,
      row_number() over (
        order by similarity(a.title || ' ' || a.content_md, query_text) desc
      ) as rank_ix
    from articles a
    join tag_filtered t on t.article_id = a.id
    where similarity(a.title || ' ' || a.content_md, query_text) >= min_full_text_similarity
      and (not only_published or a.status = 'published')
    order by rank_ix
    limit least(match_count, 30) * 2
  ),
  chunk_distance as (
    -- 門檻內的段落,依文章分組後第 1 名就是這篇文章「最接近的那一段」。
    -- query_embedding 為 null(降級)時,距離是 null、比較結果是 null,整個 CTE 自然為空。
    select
      c.article_id,
      c.chunk_index,
      c.content,
      c.embedding <=> query_embedding as dist,
      row_number() over (
        partition by c.article_id order by c.embedding <=> query_embedding
      ) as per_article_ix
    from article_chunks c
    join articles a on a.id = c.article_id
    join tag_filtered t on t.article_id = a.id
    where c.embedding <=> query_embedding < max_semantic_distance
      and (not only_published or a.status = 'published')
  ),
  semantic as (
    select
      d.article_id,
      d.chunk_index,
      d.content,
      d.dist,
      row_number() over (order by d.dist) as rank_ix
    from chunk_distance d
    where d.per_article_ix = 1
    order by rank_ix
    limit least(match_count, 30) * 2
  )
  select
    coalesce(full_text.article_id, semantic.article_id) as id,
    semantic.chunk_index as best_chunk_index,
    semantic.content as best_chunk_content,
    semantic.dist as semantic_distance
  from full_text
    full outer join semantic on full_text.article_id = semantic.article_id
  order by
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
    coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    desc
  limit least(match_count, 30)
$$;

-- 使用範例(query_embedding 由 GAS 呼叫 Gemini gemini-embedding-001 產生後帶入):
-- select * from hybrid_search_articles(
--   'react 元件設計',
--   '[0.01, 0.02, ...]'::extensions.vector(768),
--   20
-- );

-- ============================================================
-- 相關文章推薦:純向量最近鄰搜尋,不做關鍵字比對。
-- 「來源文章的任何一段」與「候選文章的任何一段」之間最近的距離,就是這兩篇文章的距離——
-- 所以長文的尾段與另一篇文章相近,兩篇也會互相推薦。跟 hybrid_search_articles 概念相同,
-- 用 max_semantic_distance 門檻避免在文章數少的知識庫裡湊出明顯不相關的「相關文章」。
-- 只推薦已發布的文章,不推薦自己。
--
-- source_article_id 查無資料,或該文章本身沒有任何段落(從沒發布過、或向量產生失敗)時,
-- 回傳空集合,不報錯——呼叫端(GAS)不需要另外判斷「這篇文章存不存在」。
-- 取消發布的文章段落會保留,所以它仍然可以當來源找到相關文章。
-- ============================================================
create or replace function related_articles(
  source_article_id     uuid,
  match_count            int default 3,
  max_semantic_distance float default 0.6
)
returns setof articles
language sql
set search_path = public, extensions
as $$
  select a.*
  from articles a
  cross join lateral (
    select min(c.embedding <=> s.embedding) as dist
    from article_chunks c
    cross join article_chunks s
    where c.article_id = a.id
      and s.article_id = source_article_id
  ) d
  where a.id <> source_article_id
    and a.status = 'published'
    and d.dist < max_semantic_distance
  order by d.dist
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
set search_path = public, extensions
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
-- 標籤合併(單一交易)
-- 把「來源標籤」合併進「目標標籤」:同時擁有兩者的文章只刪除指向來源的關聯(直接 update
-- 會撞 (article_id, tag_id) 的 unique);其餘文章的關聯改指向目標;最後刪除來源標籤。
-- 為什麼放在資料庫:原本由 GAS 逐篇文章發出多個請求,中途失敗會留下「一半搬完」的狀態;
-- 放進單一函式,任何一步失敗整筆回滾,也不再需要「一次最多合併幾篇」的上限。
-- 來源等於目標、任一標籤不存在都會拒絕(errcode 22023 / P0002),不動任何資料。
-- 沒有 security definer:以呼叫者身分執行,匿名角色因為 RLS 什麼都動不了。
-- ============================================================
create or replace function merge_tags(
  source_tag_id uuid,
  target_tag_id uuid
)
returns tags
language plpgsql
set search_path = public, extensions
as $$
declare
  target_row tags;
begin
  if source_tag_id = target_tag_id then
    raise exception 'merge_tags: source and target must differ' using errcode = '22023';
  end if;
  if not exists (select 1 from tags where id = source_tag_id) then
    raise exception 'merge_tags: source tag not found' using errcode = 'P0002';
  end if;
  select * into target_row from tags where id = target_tag_id;
  if not found then
    raise exception 'merge_tags: target tag not found' using errcode = 'P0002';
  end if;

  delete from article_tags s
   where s.tag_id = source_tag_id
     and exists (
       select 1 from article_tags t
        where t.article_id = s.article_id and t.tag_id = target_tag_id
     );
  update article_tags set tag_id = target_tag_id where tag_id = source_tag_id;
  delete from tags where id = source_tag_id;

  return target_row;
end;
$$;

-- ============================================================
-- 原子寫入:建立 / 更新文章欄位、狀態、整批取代段落、整組取代標籤——單一交易
-- 為什麼放在資料庫:原本向量是 articles 的一個欄位,和內容合併成同一個 PATCH,所以內容與向量
-- 一起提交;向量搬到段落表之後,若由 GAS 分成「PATCH 文章 → 刪舊段落 → 插新段落 → 改標籤」
-- 多個請求,中間失敗會留下「內容是新的、段落向量還是舊的」或「標籤全部消失」的半成品。
-- 放進單一函式,任何一步失敗整筆回滾。
--
-- 各部分彼此獨立、都是可選的:
--   p_id         null = 建立新文章(此時 p_fields 必須含 title);否則更新該文章
--   p_fields     jsonb,可含 title / content_md / category_id / status。沒給的 key 不動;
--                category_id 明確給 null 代表清除分類。整個 p_fields 為 null = 不動文章欄位
--                (此時也不會觸發 updated_at,只重建段落不會讓文章在列表裡跳到最前面)
--   p_tag_ids    null = 標籤不動;陣列(含空陣列)= 標籤集合整組換成這份(差集:保留的關聯列不重寫)
--   p_chunks     null = 段落不動;jsonb 陣列 [{content, embedding}, ...] = 整批取代全部段落,
--                序號依陣列順序從 0 起。段數上限 40(與 GAS 的 CHUNK_MAX_COUNT_ 一致)
--   p_embedding_model  提供段落時必填
-- 對應流程:建立草稿(欄位+標籤)、更新草稿、更新已發布文章(欄位+標籤+段落)、發布(狀態+段落)、
-- 取消發布(只有狀態;段落保留,搜尋本來就只看已發布,重新發布時整批重算覆蓋)、
-- 重建工具(只有段落)。
-- 沒有 security definer:以呼叫者身分執行,匿名角色因為 RLS 什麼都寫不進去。
-- ============================================================
create or replace function save_article(
  p_id               uuid  default null,
  p_fields           jsonb default null,
  p_tag_ids          uuid[] default null,
  p_chunks           jsonb default null,
  p_embedding_model  text  default null
)
returns articles
language plpgsql
set search_path = public, extensions
as $$
declare
  saved       articles;
  chunk_count int;
begin
  if p_fields is not null and (p_fields ? 'status')
     and (p_fields ->> 'status') not in ('draft', 'published') then
    raise exception 'save_article: invalid status' using errcode = '22023';
  end if;

  if p_chunks is not null then
    if jsonb_typeof(p_chunks) <> 'array' then
      raise exception 'save_article: chunks must be a json array' using errcode = '22023';
    end if;
    chunk_count := jsonb_array_length(p_chunks);
    if chunk_count > 40 then
      raise exception 'save_article: too many chunks (max 40)' using errcode = '54000';
    end if;
    if p_embedding_model is null or p_embedding_model = '' then
      raise exception 'save_article: embedding_model required when chunks are given' using errcode = '22023';
    end if;
  end if;

  if p_id is null then
    if p_fields is null or not (p_fields ? 'title') then
      raise exception 'save_article: title required for create' using errcode = '22023';
    end if;
    insert into articles (title, content_md, category_id, status)
    values (
      p_fields ->> 'title',
      coalesce(p_fields ->> 'content_md', ''),
      nullif(p_fields ->> 'category_id', '')::uuid,
      coalesce(p_fields ->> 'status', 'draft')
    )
    returning * into saved;
  elsif p_fields is not null then
    update articles
       set title       = case when p_fields ? 'title'       then p_fields ->> 'title'       else title end,
           content_md  = case when p_fields ? 'content_md'  then p_fields ->> 'content_md'  else content_md end,
           category_id = case when p_fields ? 'category_id' then nullif(p_fields ->> 'category_id', '')::uuid else category_id end,
           status      = case when p_fields ? 'status'      then p_fields ->> 'status'      else status end
     where id = p_id
     returning * into saved;
    if not found then
      raise exception 'save_article: article not found' using errcode = 'P0002';
    end if;
  else
    select * into saved from articles where id = p_id;
    if not found then
      raise exception 'save_article: article not found' using errcode = 'P0002';
    end if;
  end if;

  if p_tag_ids is not null then
    delete from article_tags
     where article_id = saved.id and tag_id <> all (p_tag_ids);
    insert into article_tags (article_id, tag_id)
    select saved.id, t from unnest(p_tag_ids) as t
    on conflict do nothing;
  end if;

  if p_chunks is not null then
    delete from article_chunks where article_id = saved.id;
    insert into article_chunks (article_id, chunk_index, content, embedding, embedding_model)
    select saved.id,
           (ord - 1)::int,
           elem ->> 'content',
           (elem ->> 'embedding')::extensions.vector(768),
           p_embedding_model
      from jsonb_array_elements(p_chunks) with ordinality as c(elem, ord);
  end if;

  return saved;
end;
$$;

-- ============================================================
-- 待重建的文章(重建工具用)
-- 回傳「已發布,而且沒有任何段落、或任一段的 embedding_model 與傳入的目前模型不同」的文章 ID。
-- 需要它是因為 article_chunks 不對 GAS 開放,工具無法直接判斷哪些文章該重建。
-- ============================================================
create or replace function articles_needing_reindex(current_model text)
returns table (id uuid)
language sql
stable
set search_path = public, extensions
as $$
  select a.id
    from articles a
   where a.status = 'published'
     and (
       not exists (select 1 from article_chunks c where c.article_id = a.id)
       or exists (select 1 from article_chunks c where c.article_id = a.id and c.embedding_model <> current_model)
     )
   order by a.updated_at;
$$;

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
alter table article_chunks enable row level security;
