-- ============================================================
-- 一次性 migration:把「分段向量與原子寫入」之前的線上資料庫(docs/schema.sql 在
-- 2026-10-02 的狀態,見同資料夾的 schema-before.sql)升級到現行的 docs/schema.sql。
--
-- ⚠️ 這不是專案的升級機制。本專案的目標是「從無到有佈建」:新專案只需要執行一次
--    docs/schema.sql,不需要這個檔案。它只服務擁有者那一個已經建好的線上資料庫,
--    套用一次之後即完成使命(票 10),留在這裡當作歷史紀錄。
--
-- 內容幾乎全部是從 docs/schema.sql 逐字抽出(由腳本組裝,不是手抄),
-- 並有測試(test/sql/MigrationEquivalence.test.js)證明:
--   「舊 schema + 本檔」得到的結構 = 「全新載入 docs/schema.sql」的結構,
--   而且既有的文章、標籤、附件資料都完整保留。
--
-- 舊的搜尋向量(articles.embedding)無法換算成段落,會被丟棄;套用後所有已發布的文章都會
-- 出現在 articles_needing_reindex 的清單裡,由 tools/Reindex.gs 重新計算段落向量。
-- 套用到套用完工具跑完之間,語意搜尋與相關文章找不到任何東西(關鍵字搜尋不受影響)。
--
-- 整份檔案在單一交易內執行:任何一步失敗整份回滾,資料庫維持原狀。
-- ============================================================

begin;

-- 1. 擴充功能搬出 public(Supabase 安全顧問 Lint 0014 的官方修法)。
--    vector / pg_trgm 都是可搬移的擴充功能;既有的欄位、索引、運算子類別會跟著走。
create schema if not exists extensions;
alter extension vector  set schema extensions;
alter extension pg_trgm set schema extensions;

-- 2. 丟棄回傳型別會改變的舊函式。必須明確 drop:新舊並存會讓 PostgREST 無法判斷
--    該呼叫哪一個,搜尋會收到非陣列的回傳。(各只有一個版本,所以不用寫參數列。)
drop function hybrid_search_articles;
drop function related_articles;

-- 3. 移除 articles.embedding 與它的索引(搜尋用的向量改存在 article_chunks)
drop index articles_embedding_idx;
alter table articles drop column embedding;

-- 4. 段落表
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
alter table article_chunks enable row level security;

-- 5. 函式(touch_updated_at 與 articles_by_tags 邏輯不變,只是補上 search_path)
-- updated_at 自動更新
create or replace function touch_updated_at()
returns trigger language plpgsql set search_path = public, extensions as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

-- 6. 讓 PostgREST 重新載入 schema(新函式、新回傳型別立刻生效)
notify pgrst, 'reload schema';

commit;
