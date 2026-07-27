-- 記述問題の答案履歴の差分同期。
-- 仕様: IMMUNOLOGY_WRITTEN_QUESTION_IMPLEMENTATION_PLAN.md §11
--
-- 既存の sync_data.payload は progress と meta を1個のJSONBへまとめており、
-- 上限1MBで運用している。答案本文と描画ストロークをそこへ足すと、
-- 使い続けるかぎり必ず上限に近づく。そこで答案は「1件1行」で持ち、
-- (server_updated_at, attempt_id) のカーソルで差分だけをやり取りする。

create table if not exists public.sync_written_attempts (
  sync_key text not null
    references public.sync_data(sync_key) on delete cascade,
  attempt_id text not null,
  payload jsonb not null,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  primary key (sync_key, attempt_id)
);

alter table public.sync_written_attempts enable row level security;
-- ポリシー無し = 直接アクセス不可。既存の同期と同じく security definer の RPC のみ。

create index if not exists sync_written_attempts_cursor_idx
  on public.sync_written_attempts (sync_key, server_updated_at, attempt_id);

-- 採点済み答案をまとめて送る。1回100件・512KB以下。
-- client_updated_at が既存以上のときだけ更新するので、同じ行を再送しても壊れない（冪等）。
create or replace function public.sync_written_attempts_push(p_key text, p_attempts jsonb)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_row jsonb;
  v_id text;
  v_updated text;
begin
  if not exists (select 1 from public.sync_data where sync_key = v_key) then
    raise exception '同期コードが見つかりません';
  end if;
  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' then
    raise exception '答案の形式が正しくありません';
  end if;
  if jsonb_array_length(p_attempts) > 100 then
    raise exception '一度に送れる答案は100件までです';
  end if;
  if pg_column_size(p_attempts) > 524288 then
    raise exception '答案が大きすぎます';
  end if;

  for v_row in select * from jsonb_array_elements(p_attempts) loop
    v_id := v_row->>'id';
    v_updated := v_row->>'updatedAt';
    -- id・updatedAt・questionId が無い行は、あとで復元できないので受け取らない
    if v_id is null or v_updated is null or (v_row->>'questionId') is null then
      raise exception '答案に id / updatedAt / questionId がありません';
    end if;

    insert into public.sync_written_attempts (sync_key, attempt_id, payload, client_updated_at)
    values (v_key, v_id, v_row, v_updated::timestamptz)
    on conflict (sync_key, attempt_id) do update
      set payload = excluded.payload,
          client_updated_at = excluded.client_updated_at,
          server_updated_at = now()
      where public.sync_written_attempts.client_updated_at <= excluded.client_updated_at;
  end loop;

  return now();
end; $$;

-- カーソル（server_updated_at, attempt_id）より後ろを昇順に返す。0件になるまでページングする。
create or replace function public.sync_written_attempts_pull(
  p_key text,
  p_after timestamptz,
  p_after_id text,
  p_limit integer
)
returns table(attempt_id text, payload jsonb, server_updated_at timestamptz)
language sql security definer set search_path = public
as $$
  select a.attempt_id, a.payload, a.server_updated_at
  from public.sync_written_attempts a
  where a.sync_key = public.norm_sync_code(p_key)
    and (
      p_after is null
      or a.server_updated_at > p_after
      or (a.server_updated_at = p_after and a.attempt_id > coalesce(p_after_id, ''))
    )
  order by a.server_updated_at, a.attempt_id
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- 「学習記録をすべて削除」でリモートの答案も消す
create or replace function public.sync_written_attempts_delete_all(p_key text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.sync_written_attempts
  where sync_key = public.norm_sync_code(p_key);
$$;

revoke all on function public.sync_written_attempts_push(text, jsonb) from public;
revoke all on function public.sync_written_attempts_pull(text, timestamptz, text, integer) from public;
revoke all on function public.sync_written_attempts_delete_all(text) from public;

grant execute on function public.sync_written_attempts_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_written_attempts_pull(text, timestamptz, text, integer) to anon, authenticated;
grant execute on function public.sync_written_attempts_delete_all(text) to anon, authenticated;
