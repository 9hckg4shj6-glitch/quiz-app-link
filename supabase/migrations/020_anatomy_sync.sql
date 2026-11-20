-- からだ見聞録（解剖学アプリ。別のリポジトリ anatomy-app）の端末をまたぐ同期。Google でログインした人の学習の記録を置く。
-- このアプリの Google ログイン（auth.users）を借りる。同じ Google アカウントなら同じ利用者だが、表は別なのでこのアプリの記録とは混ざらない。
--
-- 記録は「束」（bucket）ごとに1行にまとめる（行の数を抑え、jsonb の圧縮を効かせて、無料枠の容量を食わないため）:
--   e:2026-11-20 … 解いた記録（その日の分。UTC の日付）
--   s:0〜63     … 覚え具合（問題ごと。キーを散らして64の束に）
--   l:0〜15     … 学んだ語
--   c:0〜7      … 設定・★とメモ・名前と所属
-- 束の中身は { キー: { c: 端末で変えた日時, v: 行（消したら null）, d: 送った端末, s: 受けた順の番号 } }。
-- 同じキーは c の新しい方を残す（同じなら前のまま）。s はサーバーが付け、端末は「前に受け取った番号より後」に入った分だけを読む。
-- 表はどのロールからも直には読めず、自分の束だけを下の2つの RPC で読み書きする。
create sequence if not exists public.anatomy_sync_seq;

create table if not exists public.anatomy_sync(
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  entries jsonb not null default '{}'::jsonb,
  seq bigint not null,
  updated_at timestamptz not null default now(),
  primary key(owner_id, bucket)
);
create index if not exists anatomy_sync_owner_seq_idx on public.anatomy_sync(owner_id, seq);
alter table public.anatomy_sync enable row level security;
revoke all on public.anatomy_sync from anon, authenticated;
revoke all on sequence public.anatomy_sync_seq from anon, authenticated;

-- 束を合わせる。キーごとに c の新しい方を残し、新しく入ったものに番号 s を付ける
create or replace function public._anatomy_sync_merge(p_old jsonb, p_new jsonb, p_seq bigint)
returns jsonb language sql immutable set search_path=public as $$
  select coalesce(jsonb_object_agg(x.k, case
      when x.n is null then x.o
      when x.o is null or (x.n->>'c') > (x.o->>'c') then x.n || jsonb_build_object('s', p_seq)
      else x.o end), '{}'::jsonb)
  from (select coalesce(a.key, b.key) as k, a.value as o, b.value as n
        from jsonb_each(coalesce(p_old, '{}'::jsonb)) a
        full join jsonb_each(coalesce(p_new, '{}'::jsonb)) b on a.key = b.key) x
$$;
revoke execute on function public._anatomy_sync_merge(jsonb, jsonb, bigint) from public, anon, authenticated;

-- 送る: { 束: { キー: { c, v, d } } }。1回に500束・2MBまで。c が先の日時（端末の時計の狂い）なら今に直す
create or replace function public.anatomy_sync_push(p_buckets jsonb)
returns bigint language plpgsql volatile security definer set search_path=public as $$
declare
  v_uid uuid := auth.uid();
  v_bucket text;
  v_entries jsonb;
  v_clean jsonb;
  v_seq bigint := 0;
  v_count integer := 0;
  v_max text := to_char((now() + interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_buckets is null or jsonb_typeof(p_buckets) <> 'object' then raise exception 'BAD_PAYLOAD'; end if;
  if pg_column_size(p_buckets) > 2097152 then raise exception 'TOO_LARGE'; end if;
  -- 同じ人の送信は1つずつ（番号の順と書き終わる順をそろえ、読む側が取りこぼさないように）
  perform pg_advisory_xact_lock(hashtextextended('anatomy_sync:' || v_uid::text, 0));
  for v_bucket, v_entries in select key, value from jsonb_each(p_buckets) loop
    v_count := v_count + 1;
    if v_count > 500 then raise exception 'TOO_MANY_BUCKETS'; end if;
    if v_bucket !~ '^(e:\d{4}-\d{2}-\d{2}|s:\d{1,2}|l:\d{1,2}|c:\d)$' or jsonb_typeof(v_entries) <> 'object' then
      raise exception 'BAD_BUCKET %', left(v_bucket, 40);
    end if;
    if exists (select 1 from jsonb_each(v_entries) e
               where length(e.key) > 200 or jsonb_typeof(e.value) <> 'object'
                 or coalesce(e.value->>'c', '') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
                 or jsonb_typeof(coalesce(e.value->'v', 'null'::jsonb)) not in ('object', 'null')) then
      raise exception 'BAD_ENTRY';
    end if;
    select coalesce(jsonb_object_agg(e.key, jsonb_build_object(
        'c', least(e.value->>'c', v_max),
        'v', coalesce(e.value->'v', 'null'::jsonb),
        'd', left(coalesce(e.value->>'d', ''), 64))), '{}'::jsonb)
      into v_clean from jsonb_each(v_entries) e;
    v_seq := nextval('public.anatomy_sync_seq');
    insert into anatomy_sync as t(owner_id, bucket, entries, seq)
    values (v_uid, v_bucket, _anatomy_sync_merge('{}'::jsonb, v_clean, v_seq), v_seq)
    on conflict (owner_id, bucket) do update
      set entries = _anatomy_sync_merge(t.entries, v_clean, v_seq), seq = v_seq, updated_at = now();
  end loop;
  return v_seq;
end $$;
revoke execute on function public.anatomy_sync_push(jsonb) from public, anon;
grant execute on function public.anatomy_sync_push(jsonb) to authenticated;

-- 読む: 前回までに受け取った番号 p_since より後に入った分を、束の番号の順に p_limit 束ずつ（p_after は前のページの最後の束の番号）。
-- 1回の受け取りの間は、はじめのページで返した head（その時の一番新しい番号）までの分だけを返し、次の回は head から読む
-- （ページの間に束が新しくなっても、古い分を取りこぼさないように。p_until に head を渡す）。p_device の端末が送った分は除く
drop function if exists public.anatomy_sync_pull(bigint, text, integer);
create or replace function public.anatomy_sync_pull(p_after bigint, p_since bigint, p_until bigint, p_device text, p_limit integer)
returns table(bucket text, entries jsonb, seq bigint, head bigint)
language plpgsql stable security definer set search_path=public as $$
declare
  v_uid uuid := auth.uid();
  v_since bigint := coalesce(p_since, 0);
  v_head bigint;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  -- 送信は人ごとに1つずつ（anatomy_sync_push）なので、ここで見える一番新しい番号までの分は書き終わっている
  select coalesce(max(t.seq), 0) into v_head from anatomy_sync t where t.owner_id = v_uid;
  if p_until is not null then v_head := least(v_head, p_until); end if;
  return query
    select t.bucket,
      coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(t.entries) e
                where coalesce((e.value->>'s')::bigint, 0) > v_since
                  and coalesce((e.value->>'s')::bigint, 0) <= v_head
                  and coalesce(e.value->>'d', '') <> coalesce(p_device, '')), '{}'::jsonb),
      t.seq, v_head
    from anatomy_sync t
    where t.owner_id = v_uid and t.seq > greatest(coalesce(p_after, 0), v_since)
    order by t.seq
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;
revoke execute on function public.anatomy_sync_pull(bigint, bigint, bigint, text, integer) from public, anon;
grant execute on function public.anatomy_sync_pull(bigint, bigint, bigint, text, integer) to authenticated;
