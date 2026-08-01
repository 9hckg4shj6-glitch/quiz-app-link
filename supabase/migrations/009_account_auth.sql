-- Googleで認証した利用者向けの学習記録同期。
-- 旧同期コードは安全に「取得 → 統合 → 移行済み」へできるよう所有者を持たせる。

create table if not exists public.account_sync_data (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_sync_data enable row level security;
-- ポリシー無し。読み書きは必ず下記RPCを経由する。

create table if not exists public.account_written_attempts (
  owner_id uuid not null references auth.users(id) on delete cascade,
  attempt_id text not null,
  payload jsonb not null,
  client_updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  primary key (owner_id, attempt_id)
);

alter table public.account_written_attempts enable row level security;

revoke all on table public.account_sync_data from anon, authenticated;
revoke all on table public.account_written_attempts from anon, authenticated;

create index if not exists account_written_attempts_cursor_idx
  on public.account_written_attempts (owner_id, server_updated_at, attempt_id);

alter table public.sync_data
  add column if not exists claimed_by uuid references auth.users(id) on delete cascade,
  add column if not exists claimed_at timestamptz,
  add column if not exists retired_at timestamptz;

create index if not exists sync_data_claimed_by_idx on public.sync_data (claimed_by);

-- アカウントの現在スナップショット。未作成なら0行。
create or replace function public.account_sync_pull()
returns table(payload jsonb, version bigint, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  return query
    select s.payload, s.version, s.updated_at
    from public.account_sync_data s
    where s.owner_id = v_uid;
end; $$;

-- expected_version が一致するときだけ更新する（compare-and-swap）。
create or replace function public.account_sync_push(p_payload jsonb, p_expected_version bigint)
returns table(ok boolean, version bigint, conflict boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current bigint;
  v_next bigint;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 1048576 then
    raise exception '記録が大きすぎます';
  end if;

  select s.version into v_current
  from public.account_sync_data s
  where s.owner_id = v_uid;

  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      return query select false, 0::bigint, true;
      return;
    end if;
    begin
      insert into public.account_sync_data (owner_id, payload, version)
      values (v_uid, coalesce(p_payload, '{}'::jsonb), 1)
      returning account_sync_data.version into v_next;
      return query select true, v_next, false;
      return;
    exception when unique_violation then
      select s.version into v_current from public.account_sync_data s where s.owner_id = v_uid;
      return query select false, coalesce(v_current, 0), true;
      return;
    end;
  end if;

  if v_current <> coalesce(p_expected_version, 0) then
    return query select false, v_current, true;
    return;
  end if;

  update public.account_sync_data s
  set payload = coalesce(p_payload, '{}'::jsonb),
      version = s.version + 1,
      updated_at = now()
  where s.owner_id = v_uid and s.version = v_current
  returning s.version into v_next;

  if v_next is null then
    select s.version into v_current from public.account_sync_data s where s.owner_id = v_uid;
    return query select false, coalesce(v_current, 0), true;
  else
    return query select true, v_next, false;
  end if;
end; $$;

create or replace function public.account_written_attempts_push(p_attempts jsonb)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row jsonb;
  v_id text;
  v_updated text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' then
    raise exception '答案の形式が正しくありません';
  end if;
  if jsonb_array_length(p_attempts) > 100 then raise exception '一度に送れる答案は100件までです'; end if;
  if pg_column_size(p_attempts) > 524288 then raise exception '答案が大きすぎます'; end if;

  for v_row in select * from jsonb_array_elements(p_attempts) loop
    v_id := v_row->>'id';
    v_updated := v_row->>'updatedAt';
    if v_id is null or v_updated is null or (v_row->>'questionId') is null then
      raise exception '答案に id / updatedAt / questionId がありません';
    end if;
    insert into public.account_written_attempts (owner_id, attempt_id, payload, client_updated_at)
    values (v_uid, v_id, v_row, v_updated::timestamptz)
    on conflict (owner_id, attempt_id) do update
      set payload = excluded.payload,
          client_updated_at = excluded.client_updated_at,
          server_updated_at = now()
      where public.account_written_attempts.client_updated_at <= excluded.client_updated_at;
  end loop;
  return now();
end; $$;

create or replace function public.account_written_attempts_pull(
  p_after timestamptz,
  p_after_id text,
  p_limit integer
)
returns table(attempt_id text, payload jsonb, server_updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  return query
    select a.attempt_id, a.payload, a.server_updated_at
    from public.account_written_attempts a
    where a.owner_id = v_uid
      and (
        p_after is null
        or a.server_updated_at > p_after
        or (a.server_updated_at = p_after and a.attempt_id > coalesce(p_after_id, ''))
      )
    order by a.server_updated_at, a.attempt_id
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end; $$;

-- 旧コードをログイン中のユーザーへ排他的に帰属させ、移行用データを返す。
create or replace function public.claim_sync_code(p_key text)
returns table(payload jsonb, updated_at timestamptz, retired boolean)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := public.norm_sync_code(p_key);
  v_row public.sync_data%rowtype;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_row from public.sync_data where sync_key = v_key for update;
  if not found then return; end if;
  if v_row.claimed_by is not null and v_row.claimed_by <> v_uid then
    raise exception 'SYNC_CODE_CLAIMED';
  end if;
  if v_row.claimed_by is null then
    update public.sync_data set claimed_by = v_uid, claimed_at = now() where sync_key = v_key;
  end if;
  return query select v_row.payload, v_row.updated_at, (v_row.retired_at is not null);
end; $$;

create or replace function public.complete_sync_code_migration(p_key text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.sync_data
  set retired_at = coalesce(retired_at, now())
  where sync_key = public.norm_sync_code(p_key) and claimed_by = v_uid;
  if not found then raise exception 'SYNC_CODE_CLAIMED'; end if;
end; $$;

-- 既存のコード同期RPCに、取得済み・移行済みコードのアクセス制御を加える。
create or replace function public.sync_pull(p_key text)
returns table(payload jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_owner uuid;
begin
  select s.claimed_by into v_owner from public.sync_data s where s.sync_key = v_key;
  if not found then return; end if;
  if v_owner is not null and v_owner is distinct from auth.uid() then raise exception 'SYNC_CODE_CLAIMED'; end if;
  return query select s.payload, s.updated_at from public.sync_data s where s.sync_key = v_key;
end; $$;

create or replace function public.sync_push(p_key text, p_payload jsonb)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_owner uuid;
  v_retired timestamptz;
  v_at timestamptz;
begin
  if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 1048576 then raise exception '記録が大きすぎます'; end if;
  select claimed_by, retired_at into v_owner, v_retired from public.sync_data where sync_key = v_key;
  if not found then raise exception '同期コードが見つかりません'; end if;
  if v_owner is not null and v_owner is distinct from auth.uid() then raise exception 'SYNC_CODE_CLAIMED'; end if;
  if v_retired is not null then raise exception 'SYNC_CODE_RETIRED'; end if;
  update public.sync_data set payload = coalesce(p_payload, '{}'::jsonb), updated_at = now()
  where sync_key = v_key returning updated_at into v_at;
  return v_at;
end; $$;

create or replace function public.sync_delete(p_key text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_owner uuid;
begin
  select claimed_by into v_owner from public.sync_data where sync_key = v_key;
  if not found then return; end if;
  -- 取得済みの行は復旧用として保持し、Authユーザー削除時だけ外部キーで削除する。
  if v_owner is not null then raise exception 'SYNC_CODE_RETIRED'; end if;
  delete from public.sync_data where sync_key = v_key;
end; $$;

-- 旧コードの答案RPCにも同じ所有者ガードを適用する。
create or replace function public.sync_written_attempts_push(p_key text, p_attempts jsonb)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_owner uuid;
  v_retired timestamptz;
  v_row jsonb;
  v_id text;
  v_updated text;
begin
  select claimed_by, retired_at into v_owner, v_retired from public.sync_data where sync_key = v_key;
  if not found then raise exception '同期コードが見つかりません'; end if;
  if v_owner is not null and v_owner is distinct from auth.uid() then raise exception 'SYNC_CODE_CLAIMED'; end if;
  if v_retired is not null then raise exception 'SYNC_CODE_RETIRED'; end if;
  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' then raise exception '答案の形式が正しくありません'; end if;
  if jsonb_array_length(p_attempts) > 100 then raise exception '一度に送れる答案は100件までです'; end if;
  if pg_column_size(p_attempts) > 524288 then raise exception '答案が大きすぎます'; end if;
  for v_row in select * from jsonb_array_elements(p_attempts) loop
    v_id := v_row->>'id'; v_updated := v_row->>'updatedAt';
    if v_id is null or v_updated is null or (v_row->>'questionId') is null then
      raise exception '答案に id / updatedAt / questionId がありません';
    end if;
    insert into public.sync_written_attempts (sync_key, attempt_id, payload, client_updated_at)
    values (v_key, v_id, v_row, v_updated::timestamptz)
    on conflict (sync_key, attempt_id) do update
      set payload = excluded.payload, client_updated_at = excluded.client_updated_at, server_updated_at = now()
      where public.sync_written_attempts.client_updated_at <= excluded.client_updated_at;
  end loop;
  return now();
end; $$;

create or replace function public.sync_written_attempts_pull(
  p_key text, p_after timestamptz, p_after_id text, p_limit integer
)
returns table(attempt_id text, payload jsonb, server_updated_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_owner uuid;
begin
  select claimed_by into v_owner from public.sync_data where sync_key = v_key;
  if not found then return; end if;
  if v_owner is not null and v_owner is distinct from auth.uid() then raise exception 'SYNC_CODE_CLAIMED'; end if;
  return query
    select a.attempt_id, a.payload, a.server_updated_at
    from public.sync_written_attempts a
    where a.sync_key = v_key
      and (p_after is null or a.server_updated_at > p_after
        or (a.server_updated_at = p_after and a.attempt_id > coalesce(p_after_id, '')))
    order by a.server_updated_at, a.attempt_id
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end; $$;

create or replace function public.sync_written_attempts_delete_all(p_key text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_owner uuid;
begin
  select claimed_by into v_owner from public.sync_data where sync_key = v_key;
  if not found then return; end if;
  if v_owner is not null then raise exception 'SYNC_CODE_RETIRED'; end if;
  delete from public.sync_written_attempts where sync_key = v_key;
end; $$;

revoke all on function public.account_sync_pull() from public;
revoke all on function public.account_sync_push(jsonb, bigint) from public;
revoke all on function public.account_written_attempts_push(jsonb) from public;
revoke all on function public.account_written_attempts_pull(timestamptz, text, integer) from public;
revoke all on function public.claim_sync_code(text) from public;
revoke all on function public.complete_sync_code_migration(text) from public;

grant execute on function public.account_sync_pull() to authenticated;
grant execute on function public.account_sync_push(jsonb, bigint) to authenticated;
grant execute on function public.account_written_attempts_push(jsonb) to authenticated;
grant execute on function public.account_written_attempts_pull(timestamptz, text, integer) to authenticated;
grant execute on function public.claim_sync_code(text) to authenticated;
grant execute on function public.complete_sync_code_migration(text) to authenticated;

-- 置換した旧関数の権限を再固定する。
revoke all on function public.sync_pull(text) from public;
revoke all on function public.sync_push(text, jsonb) from public;
revoke all on function public.sync_delete(text) from public;
revoke all on function public.sync_written_attempts_push(text, jsonb) from public;
revoke all on function public.sync_written_attempts_pull(text, timestamptz, text, integer) from public;
revoke all on function public.sync_written_attempts_delete_all(text) from public;

grant execute on function public.sync_pull(text) to anon, authenticated;
grant execute on function public.sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_delete(text) to anon, authenticated;
grant execute on function public.sync_written_attempts_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_written_attempts_pull(text, timestamptz, text, integer) to anon, authenticated;
grant execute on function public.sync_written_attempts_delete_all(text) to anon, authenticated;
