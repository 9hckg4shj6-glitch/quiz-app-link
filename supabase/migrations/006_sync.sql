-- 端末間データ同期。
-- 「同期コード」1つで、引き継ぎ（一度きりの移行）と継続的な同期の両方を賄う。
-- 認証は使わず、コードを知っている端末だけが読み書きできる（ランキング/コミュニティと同じくRPC限定）。
--
-- 統合はクライアント側の mergeProgress/mergeMeta（問題ごとに最大値・和集合）で行う。
-- pull → merge → push の順に動かすため、どちらの端末の記録も失われない。

create extension if not exists pgcrypto;

create table if not exists public.sync_data (
  sync_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sync_data enable row level security;
-- ポリシー無し = 直接アクセス不可。RPC のみ。

-- 紛らわしい文字（0/1/I/L/O）を除いた31文字から10桁を生成する。
-- 31^10 ≒ 8.2e14 通りあるため、総当たりは現実的でない。
create or replace function public.gen_sync_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  n int := length(alphabet);
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..10 loop
      -- 暗号論的に安全な乱数を使う（random() は使わない）
      code := code || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % n), 1);
    end loop;
    exit when not exists (select 1 from public.sync_data where sync_key = code);
  end loop;
  return code;
end; $$;

-- 入力されたコードを正規化（小文字・ハイフン・空白を許容する）
create or replace function public.norm_sync_code(p_key text)
returns text language sql immutable
as $$
  select upper(regexp_replace(coalesce(p_key, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

-- 同期を開始してコードを発行する
create or replace function public.sync_create(p_payload jsonb)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
  i int;
begin
  if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 1048576 then
    raise exception '記録が大きすぎます';
  end if;
  -- gen_sync_code は「未使用か確認 → 返す」ため、2人が同時に発行すると
  -- 確認と挿入の隙間で同じコードを掴む可能性がある（確率は極小）。
  -- 主キー違反を捕まえて引き直し、必ず全員が別のコードを受け取れるようにする。
  for i in 1..5 loop
    begin
      v_code := public.gen_sync_code();
      insert into public.sync_data (sync_key, payload) values (v_code, coalesce(p_payload, '{}'::jsonb));
      return v_code;
    exception when unique_violation then
      null; -- 衝突したので引き直す
    end;
  end loop;
  raise exception '同期コードを発行できませんでした。もう一度お試しください。';
end; $$;

-- コードの記録を取得する。存在しなければ0行（クライアントは「コードが違います」を表示）
create or replace function public.sync_pull(p_key text)
returns table(payload jsonb, updated_at timestamptz)
language sql security definer set search_path = public
as $$
  select s.payload, s.updated_at
  from public.sync_data s
  where s.sync_key = public.norm_sync_code(p_key);
$$;

-- 統合済みの記録を書き戻す。既存のコードにのみ書ける（push でキーを新規作成はできない）
create or replace function public.sync_push(p_key text, p_payload jsonb)
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_key text := public.norm_sync_code(p_key);
  v_at timestamptz;
begin
  if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 1048576 then
    raise exception '記録が大きすぎます';
  end if;
  update public.sync_data
  set payload = coalesce(p_payload, '{}'::jsonb), updated_at = now()
  where sync_key = v_key
  returning updated_at into v_at;

  if v_at is null then
    raise exception '同期コードが見つかりません';
  end if;
  return v_at;
end; $$;

-- 同期を完全にやめる（サーバ上の記録を削除する）
create or replace function public.sync_delete(p_key text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.sync_data where sync_key = public.norm_sync_code(p_key);
$$;

revoke all on function public.gen_sync_code() from public;
revoke all on function public.sync_create(jsonb) from public;
revoke all on function public.sync_pull(text) from public;
revoke all on function public.sync_push(text, jsonb) from public;
revoke all on function public.sync_delete(text) from public;

grant execute on function public.sync_create(jsonb) to anon, authenticated;
grant execute on function public.sync_pull(text) to anon, authenticated;
grant execute on function public.sync_push(text, jsonb) to anon, authenticated;
grant execute on function public.sync_delete(text) to anon, authenticated;
