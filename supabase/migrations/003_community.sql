-- コミュニティ（掲示板）。全公開・誰でも掲示板を作成できる。
-- 識別は端末ごとの device_id（Dexie settings の "deviceId"）。認証は使わない。
-- device_id は公開したくないため、テーブルへの直接アクセスは全面禁止し、
-- 読み書きはすべて security definer の RPC 経由に限定する（ランキングと同じ方式）。

create extension if not exists pgcrypto;

-- 掲示板（ユーザーが自由に作成できる）
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  display_name text not null,
  title text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  flag_count int not null default 0
);

-- 掲示板への書き込み
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  device_id uuid not null,
  display_name text not null,
  body text not null,
  question_id text,                       -- 将来の「問題ごとのコメント」用（現在は未使用）
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  flag_count int not null default 0
);

-- 管理者トークン置き場。RLS有効＋ポリシー無しなので、security definer 関数からしか読めない。
create table if not exists public.app_secrets (
  key text primary key,
  value text not null
);
insert into public.app_secrets(key, value)
values ('admin_token', 'CHANGE_ME_' || encode(gen_random_bytes(12), 'hex'))
on conflict (key) do nothing;

alter table public.boards enable row level security;
alter table public.posts enable row level security;
alter table public.app_secrets enable row level security;
-- anon / authenticated 向けポリシーは作らない = 直接アクセス不可。RPC のみ。

create index if not exists posts_board_created_idx on public.posts (board_id, created_at desc);
create index if not exists posts_device_created_idx on public.posts (device_id, created_at desc);
create index if not exists boards_device_created_idx on public.boards (device_id, created_at desc);

-- 名前の正規化（制御文字除去・24文字・空不可）
create or replace function public.clean_name(p_name text)
returns text language plpgsql immutable as $$
declare v text;
begin
  v := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  v := left(v, 24);
  if length(v) < 1 then raise exception '名前を入力してください'; end if;
  return v;
end; $$;

-- 掲示板を作成。レート制限：5分に1件、1日5件まで。
create or replace function public.create_board(p_device_id uuid, p_name text, p_title text, p_description text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text; v_title text; v_desc text; v_id uuid;
begin
  v_name  := public.clean_name(p_name);
  v_title := btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', '', 'g'));
  v_title := left(v_title, 40);
  if length(v_title) < 1 then raise exception 'タイトルを入力してください'; end if;
  v_desc  := left(btrim(regexp_replace(coalesce(p_description, ''), '[[:cntrl:]]', '', 'g')), 200);

  if (select count(*) from public.boards
      where device_id = p_device_id and created_at > now() - interval '5 minutes') >= 1 then
    raise exception '掲示板の作成が続いています。5分ほど待ってからお試しください。';
  end if;
  if (select count(*) from public.boards
      where device_id = p_device_id and created_at > now() - interval '1 day') >= 5 then
    raise exception '1日に作成できる掲示板は5件までです。';
  end if;

  insert into public.boards (device_id, display_name, title, description)
  values (p_device_id, v_name, v_title, v_desc)
  returning id into v_id;
  return v_id;
end; $$;

-- 掲示板一覧（新しい書き込み順）。他人の device_id は返さない。
create or replace function public.list_boards(p_device_id uuid)
returns table(id uuid, title text, description text, author text, post_count int, last_post_at timestamptz, is_mine boolean)
language sql security definer set search_path = public
as $$
  select b.id, b.title, b.description, b.display_name,
         coalesce(s.cnt, 0)::int,
         coalesce(s.last_at, b.created_at),
         (b.device_id = p_device_id)
  from public.boards b
  left join lateral (
    select count(*) as cnt, max(p.created_at) as last_at
    from public.posts p
    where p.board_id = b.id and p.deleted_at is null and p.flag_count < 3
  ) s on true
  where b.deleted_at is null and b.flag_count < 3
  order by coalesce(s.last_at, b.created_at) desc
  limit 100;
$$;

-- 書き込み。レート制限：1分3件、1時間20件まで。
create or replace function public.create_post(p_device_id uuid, p_name text, p_board_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text; v_body text; v_id uuid;
begin
  v_name := public.clean_name(p_name);
  -- 改行・タブは残し、それ以外の制御文字だけを除去する。
  -- （[:print:] 等の文字クラスはロケール依存で日本語を巻き込む恐れがあるため使わない）
  v_body := regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  v_body := btrim(left(v_body, 1000));
  if length(v_body) < 1 then raise exception '本文を入力してください'; end if;

  if not exists (select 1 from public.boards where id = p_board_id and deleted_at is null) then
    raise exception 'この掲示板は削除されています';
  end if;

  if (select count(*) from public.posts
      where device_id = p_device_id and created_at > now() - interval '1 minute') >= 3 then
    raise exception '投稿が速すぎます。少し待ってからお試しください。';
  end if;
  if (select count(*) from public.posts
      where device_id = p_device_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception '1時間あたりの投稿上限に達しました。';
  end if;

  insert into public.posts (board_id, device_id, display_name, body)
  values (p_board_id, p_device_id, v_name, v_body)
  returning id into v_id;
  return v_id;
end; $$;

-- 書き込み一覧（古い順＝掲示板の自然な読み順）。他人の device_id は返さない。
create or replace function public.list_posts(p_device_id uuid, p_board_id uuid)
returns table(id uuid, author text, body text, created_at timestamptz, is_mine boolean)
language sql security definer set search_path = public
as $$
  select p.id, p.display_name, p.body, p.created_at, (p.device_id = p_device_id)
  from public.posts p
  where p.board_id = p_board_id and p.deleted_at is null and p.flag_count < 3
  order by p.created_at asc
  limit 500;
$$;

-- 自分の書き込みを削除（ソフト削除）
create or replace function public.delete_my_post(p_device_id uuid, p_post_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.posts set deleted_at = now()
  where id = p_post_id and device_id = p_device_id and deleted_at is null;
$$;

-- 自分の掲示板を削除（中の書き込みも隠れる）
create or replace function public.delete_my_board(p_device_id uuid, p_board_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.boards set deleted_at = now()
  where id = p_board_id and device_id = p_device_id and deleted_at is null;
$$;

-- 通報。3件で自動的に一覧から消える。
create or replace function public.report_post(p_post_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.posts set flag_count = flag_count + 1 where id = p_post_id;
$$;

create or replace function public.report_board(p_board_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.boards set flag_count = flag_count + 1 where id = p_board_id;
$$;

-- 管理者：トークン照合
create or replace function public.is_admin(p_token text)
returns boolean language sql security definer set search_path = public
as $$
  select exists (
    select 1 from public.app_secrets
    where key = 'admin_token' and value = p_token and length(coalesce(p_token, '')) > 0
  );
$$;

-- 管理者：任意の書き込み／掲示板を削除
create or replace function public.admin_delete_post(p_token text, p_post_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin(p_token) then raise exception '権限がありません'; end if;
  update public.posts set deleted_at = now() where id = p_post_id;
end; $$;

create or replace function public.admin_delete_board(p_token text, p_board_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin(p_token) then raise exception '権限がありません'; end if;
  update public.boards set deleted_at = now() where id = p_board_id;
end; $$;

revoke all on function public.create_board(uuid, text, text, text) from public;
revoke all on function public.list_boards(uuid) from public;
revoke all on function public.create_post(uuid, text, uuid, text) from public;
revoke all on function public.list_posts(uuid, uuid) from public;
revoke all on function public.delete_my_post(uuid, uuid) from public;
revoke all on function public.delete_my_board(uuid, uuid) from public;
revoke all on function public.report_post(uuid) from public;
revoke all on function public.report_board(uuid) from public;
revoke all on function public.is_admin(text) from public;
revoke all on function public.admin_delete_post(text, uuid) from public;
revoke all on function public.admin_delete_board(text, uuid) from public;

grant execute on function public.create_board(uuid, text, text, text) to anon, authenticated;
grant execute on function public.list_boards(uuid) to anon, authenticated;
grant execute on function public.create_post(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.list_posts(uuid, uuid) to anon, authenticated;
grant execute on function public.delete_my_post(uuid, uuid) to anon, authenticated;
grant execute on function public.delete_my_board(uuid, uuid) to anon, authenticated;
grant execute on function public.report_post(uuid) to anon, authenticated;
grant execute on function public.report_board(uuid) to anon, authenticated;
grant execute on function public.is_admin(text) to anon, authenticated;
grant execute on function public.admin_delete_post(text, uuid) to anon, authenticated;
grant execute on function public.admin_delete_board(text, uuid) to anon, authenticated;
