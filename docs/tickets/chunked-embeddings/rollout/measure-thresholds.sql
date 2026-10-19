-- 重新量測兩個距離門檻用的查詢(唯讀,可以直接貼進 Supabase SQL Editor 執行)。
-- 背景見 docs/DESIGN.md 決策 23:搜尋的語意門檻 0.4、相關文章的門檻 0.6,原本是用「整篇一個向量」校準的經驗值,
-- 分段之後需要用真實文章再量測。2026-10-08 第一次量測時,線上幾乎都是內容極短的測試文,結果不具代表性;
-- 等累積了約 30 篇以上的真實文章,再跑這幾支查詢、依結果決定要不要調整(調整需要走 /grilling → 小票,
-- 因為會改變「找得到什麼」的行為)。

-- 1) 所有已發布文章兩兩之間的「最近段落距離」分布(判斷相關文章門檻 0.6 有沒有過濾效果)
--    若 ≥ 0.6 的比例是 0%,代表「相關文章」只是「最近的 N 篇」,沒有過濾。
with pairs as (
  select a.article_id as a_id, b.article_id as b_id, min(a.embedding <=> b.embedding) as d
    from article_chunks a
    join article_chunks b on a.article_id < b.article_id
   group by a.article_id, b.article_id
)
select case when d < 0.1 then '0.00-0.10' when d < 0.2 then '0.10-0.20' when d < 0.3 then '0.20-0.30'
            when d < 0.4 then '0.30-0.40' when d < 0.5 then '0.40-0.50' when d < 0.6 then '0.50-0.60'
            else '>=0.60' end as bucket,
       count(*) as article_pairs,
       round(100.0 * count(*) / sum(count(*)) over (), 1) as pct
  from pairs
 group by 1
 order by 1;

-- 2) 距離最近的文章對(人工判斷:這些真的相關嗎?距離多少以內算「相關」?)
with pairs as (
  select a.article_id as a_id, b.article_id as b_id, min(a.embedding <=> b.embedding) as d
    from article_chunks a
    join article_chunks b on a.article_id < b.article_id
   group by a.article_id, b.article_id
)
select round(d::numeric, 3) as dist, left(x.title, 30) as title_a, left(y.title, 30) as title_b
  from pairs p
  join articles x on x.id = p.a_id
  join articles y on y.id = p.b_id
 where x.status = 'published' and y.status = 'published'
 order by d
 limit 40;

-- 3) 每篇文章離「最近的另一篇」多遠(沒有任何鄰居在 0.3 以內的孤立文章,在較緊的門檻下會沒有相關文章)
with pairs as (
  select a.article_id as a_id, b.article_id as b_id, min(a.embedding <=> b.embedding) as d
    from article_chunks a
    join article_chunks b on a.article_id <> b.article_id
   group by a.article_id, b.article_id
)
select left(x.title, 30) as title, round(min(d)::numeric, 3) as nearest_other_article
  from pairs p
  join articles x on x.id = p.a_id
 where x.status = 'published'
 group by x.title
 order by nearest_other_article desc;
