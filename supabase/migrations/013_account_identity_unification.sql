-- Googleアカウントを端末横断の所有者として統一する。
-- 学習スナップショット・答案・カード・デッキは既存のowner_id同期を使い、
-- 本マイグレーションではランキング、掲示板、公開名、旧端末IDの帰属を統合する。

create table if not exists public.account_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 24),
  leaderboard_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_devices (
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (owner_id, device_id)
);

create table if not exists public.leaderboard_device_totals (
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  subject text not null,
  solved_count integer not null default 0 check (solved_count between 0 and 100000),
  initialized boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_id, device_id, subject)
);

alter table public.leaderboard add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.boards add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.posts add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.reports add column if not exists owner_id uuid references auth.users(id) on delete cascade;

create unique index if not exists leaderboard_owner_subject_uidx
  on public.leaderboard (owner_id, subject) where owner_id is not null;
create unique index if not exists reports_owner_target_uidx
  on public.reports (owner_id, target_type, target_id) where owner_id is not null;
create index if not exists boards_owner_created_idx on public.boards (owner_id, created_at desc);
create index if not exists posts_owner_created_idx on public.posts (owner_id, created_at desc);

alter table public.account_profiles enable row level security;
alter table public.account_devices enable row level security;
alter table public.leaderboard_device_totals enable row level security;
revoke all on table public.account_profiles from anon, authenticated;
revoke all on table public.account_devices from anon, authenticated;
revoke all on table public.leaderboard_device_totals from anon, authenticated;

create or replace function public.account_clean_name(p_name text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g')), 24);
$$;

create or replace function public.account_profile_set_name(p_name text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.account_clean_name(p_name);
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if length(v_name) < 1 then raise exception '名前を入力してください'; end if;

  insert into public.account_profiles (owner_id, display_name)
  values (v_uid, v_name)
  on conflict (owner_id) do update
    set display_name = excluded.display_name, updated_at = now();

  update public.leaderboard set display_name = v_name where owner_id = v_uid;
  update public.boards set display_name = v_name where owner_id = v_uid;
  update public.posts set display_name = v_name where owner_id = v_uid;
  return v_name;
end;
$$;

create or replace function public.account_identity_sync(
  p_device_id uuid,
  p_name text,
  p_leaderboard_opt_in boolean
)
returns table(display_name text, leaderboard_opt_in boolean)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.account_clean_name(p_name);
  v_subject text;
  v_score integer;
  v_first_at timestamptz;
  v_had_guest boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_device_id is null then raise exception '端末IDがありません'; end if;

  insert into public.account_devices (owner_id, device_id)
  values (v_uid, p_device_id)
  on conflict do nothing;

  insert into public.account_profiles (owner_id, display_name, leaderboard_opt_in)
  values (v_uid, v_name, coalesce(p_leaderboard_opt_in, false))
  on conflict (owner_id) do update set
    display_name = case
      when public.account_profiles.display_name = '' then excluded.display_name
      else public.account_profiles.display_name
    end,
    leaderboard_opt_in = public.account_profiles.leaderboard_opt_in or excluded.leaderboard_opt_in,
    updated_at = now();

  -- 旧端末ですでにランキングへ参加していれば、localStorageが無い端末からの
  -- 初回ログインでも参加状態を失わない。
  if exists (
    select 1 from public.leaderboard legacy
    where legacy.owner_id is null and legacy.device_id = p_device_id
  ) then
    update public.account_profiles
    set leaderboard_opt_in = true, updated_at = now()
    where owner_id = v_uid;
  end if;

  select p.display_name into v_name
  from public.account_profiles p where p.owner_id = v_uid;

  -- この端末で作られた旧ランキングを、科目ごとにアカウントの1行へ畳み込む。
  for v_subject in
    select distinct l.subject from public.leaderboard l
    where l.owner_id = v_uid or (l.owner_id is null and l.device_id = p_device_id)
  loop
    select exists (
      select 1 from public.leaderboard guest
      where guest.owner_id is null and guest.device_id = p_device_id and guest.subject = v_subject
    ) into v_had_guest;
    select sum(l.solved_count)::integer, min(l.updated_at)
      into v_score, v_first_at
    from public.leaderboard l
    where l.subject = v_subject
      and (l.owner_id = v_uid or (l.owner_id is null and l.device_id = p_device_id));

    delete from public.leaderboard l
    where l.owner_id is null and l.device_id = p_device_id and l.subject = v_subject;

    update public.leaderboard l
    set solved_count = coalesce(v_score, l.solved_count),
        display_name = case when v_name = '' then l.display_name else v_name end,
        updated_at = least(l.updated_at, coalesce(v_first_at, l.updated_at))
    where l.owner_id = v_uid and l.subject = v_subject;

    if not found then
      insert into public.leaderboard (device_id, owner_id, subject, display_name, solved_count, updated_at)
      values (p_device_id, v_uid, v_subject, coalesce(nullif(v_name, ''), '利用者'), coalesce(v_score, 0), coalesce(v_first_at, now()));
    end if;

    if v_had_guest then
      insert into public.leaderboard_device_totals (owner_id, device_id, subject, solved_count, initialized)
      values (v_uid, p_device_id, v_subject, 0, false)
      on conflict (owner_id, device_id, subject) do nothing;
    end if;
  end loop;

  update public.boards set owner_id = v_uid
  where owner_id is null and device_id = p_device_id;
  update public.posts set owner_id = v_uid
  where owner_id is null and device_id = p_device_id;

  -- 同じアカウントの別端末ですでに同じ対象を通報していれば旧端末側を重複削除する。
  delete from public.reports r
  where r.owner_id is null and r.device_id = p_device_id
    and exists (
      select 1 from public.reports owned
      where owned.owner_id = v_uid
        and owned.target_type = r.target_type and owned.target_id = r.target_id
    );
  update public.reports set owner_id = v_uid
  where owner_id is null and device_id = p_device_id;

  if v_name <> '' then
    update public.leaderboard set display_name = v_name where owner_id = v_uid;
    update public.boards set display_name = v_name where owner_id = v_uid;
    update public.posts set display_name = v_name where owner_id = v_uid;
  end if;

  return query
    select p.display_name, p.leaderboard_opt_in
    from public.account_profiles p where p.owner_id = v_uid;
end;
$$;

-- ランキング：ゲストは従来どおり端末単位、ログイン中はアカウント・科目ごとに1行。
create or replace function public.publish_score(
  p_device_id uuid,
  p_name text,
  p_solved int,
  p_subject text,
  p_device_solved int
)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.account_clean_name(p_name);
  v_subject text := public.norm_subject(p_subject);
  v_device_solved integer := greatest(0, least(coalesce(p_device_solved, 0), 100000));
  v_previous integer;
  v_delta integer;
  v_initialized boolean;
begin
  if length(v_name) < 1 then raise exception '名前を入力してください'; end if;
  if v_uid is null then
    insert into public.leaderboard as l (device_id, subject, display_name, solved_count, updated_at)
    values (p_device_id, v_subject, v_name, greatest(0, least(coalesce(p_solved, 0), 100000)), now())
    on conflict (device_id, subject) do update set
      display_name = excluded.display_name,
      solved_count = greatest(l.solved_count, excluded.solved_count),
      updated_at = now();
    return;
  end if;

  perform * from public.account_identity_sync(p_device_id, v_name, true);
  v_name := public.account_profile_set_name(v_name);
  update public.account_profiles set leaderboard_opt_in = true, updated_at = now() where owner_id = v_uid;

  if not exists (select 1 from public.leaderboard l where l.owner_id = v_uid and l.subject = v_subject) then
    insert into public.leaderboard (device_id, owner_id, subject, display_name, solved_count, updated_at)
    values (p_device_id, v_uid, v_subject, v_name, greatest(0, least(coalesce(p_solved, 0), 100000)), now());
    insert into public.leaderboard_device_totals (owner_id, device_id, subject, solved_count, initialized)
    values (v_uid, p_device_id, v_subject, v_device_solved, true)
    on conflict (owner_id, device_id, subject) do update
      set solved_count = greatest(public.leaderboard_device_totals.solved_count, excluded.solved_count),
          initialized = true, updated_at = now();
    return;
  end if;

  select d.solved_count, d.initialized into v_previous, v_initialized
  from public.leaderboard_device_totals d
  where d.owner_id = v_uid and d.device_id = p_device_id and d.subject = v_subject
  for update;
  if found then
    v_delta := case when v_initialized then greatest(0, v_device_solved - v_previous) else 0 end;
    update public.leaderboard_device_totals
    set solved_count = greatest(solved_count, v_device_solved), initialized = true, updated_at = now()
    where owner_id = v_uid and device_id = p_device_id and subject = v_subject;
  else
    v_delta := v_device_solved;
    insert into public.leaderboard_device_totals (owner_id, device_id, subject, solved_count, initialized)
    values (v_uid, p_device_id, v_subject, v_device_solved, true);
  end if;

  update public.leaderboard l
  set display_name = v_name,
      solved_count = least(100000, l.solved_count + v_delta),
      updated_at = now()
  where l.owner_id = v_uid and l.subject = v_subject;
end;
$$;

-- 旧クライアントとの互換。端末別カウンター未対応時は従来の最大値方式で更新する。
create or replace function public.publish_score(p_device_id uuid, p_name text, p_solved int, p_subject text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.account_clean_name(p_name);
  v_subject text := public.norm_subject(p_subject);
begin
  if length(v_name) < 1 then raise exception '名前を入力してください'; end if;
  if v_uid is null then
    insert into public.leaderboard as l (device_id, subject, display_name, solved_count, updated_at)
    values (p_device_id, v_subject, v_name, greatest(0, least(coalesce(p_solved, 0), 100000)), now())
    on conflict (device_id, subject) do update set
      display_name = excluded.display_name,
      solved_count = greatest(l.solved_count, excluded.solved_count), updated_at = now();
    return;
  end if;
  perform * from public.account_identity_sync(p_device_id, v_name, true);
  v_name := public.account_profile_set_name(v_name);
  update public.account_profiles set leaderboard_opt_in = true, updated_at = now() where owner_id = v_uid;
  update public.leaderboard l
  set display_name = v_name,
      solved_count = greatest(l.solved_count, greatest(0, least(coalesce(p_solved, 0), 100000))),
      updated_at = now()
  where l.owner_id = v_uid and l.subject = v_subject;
  if not found then
    insert into public.leaderboard (device_id, owner_id, subject, display_name, solved_count, updated_at)
    values (p_device_id, v_uid, v_subject, v_name, greatest(0, least(coalesce(p_solved, 0), 100000)), now());
  end if;
end;
$$;

create or replace function public.get_leaderboard(p_device_id uuid, p_subject text)
returns table(rank int, display_name text, solved_count int, is_you boolean)
language sql security definer
set search_path = public, pg_temp
as $$
  select (row_number() over (order by l.solved_count desc, l.updated_at asc))::int,
         l.display_name, l.solved_count,
         case when auth.uid() is null then l.owner_id is null and l.device_id = p_device_id
              else l.owner_id = auth.uid() end
  from public.leaderboard l
  where l.subject = public.norm_subject(p_subject)
  order by l.solved_count desc, l.updated_at asc
  limit 100;
$$;

create or replace function public.get_my_rank(p_device_id uuid, p_subject text)
returns table(rank int, solved_count int)
language sql security definer
set search_path = public, pg_temp
as $$
  select (1 + (
    select count(*) from public.leaderboard b
    where b.subject = a.subject
      and (b.solved_count > a.solved_count
        or (b.solved_count = a.solved_count and b.updated_at < a.updated_at))
  ))::int, a.solved_count
  from public.leaderboard a
  where a.subject = public.norm_subject(p_subject)
    and (case when auth.uid() is null then a.owner_id is null and a.device_id = p_device_id
              else a.owner_id = auth.uid() end);
$$;

create or replace function public.remove_score(p_device_id uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    delete from public.leaderboard where owner_id is null and device_id = p_device_id;
  else
    delete from public.leaderboard where owner_id = auth.uid();
    update public.account_profiles set leaderboard_opt_in = false, updated_at = now()
    where owner_id = auth.uid();
  end if;
end;
$$;

-- 掲示板：所有判定、レート制限、削除権限をアカウント単位へ切り替える。
create or replace function public.list_boards(p_device_id uuid)
returns table(id uuid, title text, description text, author text, post_count int, last_post_at timestamptz, is_mine boolean)
language sql security definer
set search_path = public, pg_temp
as $$
  select b.id, b.title, b.description, b.display_name,
         coalesce(s.cnt, 0)::int, coalesce(s.last_at, b.created_at),
         case when auth.uid() is null then b.owner_id is null and b.device_id = p_device_id
              else b.owner_id = auth.uid() end
  from public.boards b
  left join lateral (
    select count(*) cnt, max(p.created_at) last_at from public.posts p
    where p.board_id = b.id and p.deleted_at is null and p.flag_count < 3
  ) s on true
  where b.deleted_at is null and b.flag_count < 3
  order by coalesce(s.last_at, b.created_at) desc
  limit 100;
$$;

create or replace function public.create_board(p_device_id uuid, p_name text, p_title text, p_description text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.clean_name(p_name);
  v_title text := left(btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', '', 'g')), 40);
  v_desc text := left(btrim(regexp_replace(coalesce(p_description, ''), '[[:cntrl:]]', '', 'g')), 200);
  v_id uuid;
begin
  if length(v_title) < 1 then raise exception 'タイトルを入力してください'; end if;
  if v_uid is not null then
    perform * from public.account_identity_sync(p_device_id, v_name, false);
    v_name := public.account_profile_set_name(v_name);
  end if;
  if (select count(*) from public.boards b where b.created_at > now() - interval '1 minute'
      and (case when v_uid is null then b.owner_id is null and b.device_id = p_device_id else b.owner_id = v_uid end)) >= 5 then
    raise exception '掲示板の作成が続いています。少し待ってからお試しください。';
  end if;
  if (select count(*) from public.boards b where b.created_at > now() - interval '1 day'
      and (case when v_uid is null then b.owner_id is null and b.device_id = p_device_id else b.owner_id = v_uid end)) >= 30 then
    raise exception '1日に作成できる掲示板の上限に達しました。';
  end if;
  insert into public.boards (device_id, owner_id, display_name, title, description)
  values (p_device_id, v_uid, v_name, v_title, v_desc) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_posts(p_device_id uuid, p_board_id uuid)
returns table(id uuid, author text, body text, created_at timestamptz, is_mine boolean)
language sql security definer
set search_path = public, pg_temp
as $$
  select t.id, t.author, t.body, t.created_at, t.is_mine
  from (
    select p.id, p.display_name author, p.body, p.created_at,
      case when auth.uid() is null then p.owner_id is null and p.device_id = p_device_id
           else p.owner_id = auth.uid() end is_mine
    from public.posts p
    where p.board_id = p_board_id and p.deleted_at is null and p.flag_count < 3
    order by p.created_at desc limit 200
  ) t order by t.created_at asc;
$$;

create or replace function public.create_post(p_device_id uuid, p_name text, p_board_id uuid, p_body text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := public.clean_name(p_name);
  v_body text := btrim(left(regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), 1000));
  v_id uuid;
begin
  if length(v_body) < 1 then raise exception '本文を入力してください'; end if;
  if not exists (select 1 from public.boards where id = p_board_id and deleted_at is null) then
    raise exception 'この掲示板は削除されています';
  end if;
  if v_uid is not null then
    perform * from public.account_identity_sync(p_device_id, v_name, false);
    v_name := public.account_profile_set_name(v_name);
  end if;
  if (select count(*) from public.posts p where p.created_at > now() - interval '1 minute'
      and (case when v_uid is null then p.owner_id is null and p.device_id = p_device_id else p.owner_id = v_uid end)) >= 10 then
    raise exception '投稿が速すぎます。少し待ってからお試しください。';
  end if;
  if (select count(*) from public.posts p where p.created_at > now() - interval '1 hour'
      and (case when v_uid is null then p.owner_id is null and p.device_id = p_device_id else p.owner_id = v_uid end)) >= 200 then
    raise exception '1時間あたりの投稿上限に達しました。';
  end if;
  insert into public.posts (board_id, device_id, owner_id, display_name, body)
  values (p_board_id, p_device_id, v_uid, v_name, v_body) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_my_post(p_device_id uuid, p_post_id uuid)
returns void language sql security definer set search_path = public, pg_temp
as $$
  update public.posts set deleted_at = now() where id = p_post_id and deleted_at is null
    and (case when auth.uid() is null then owner_id is null and device_id = p_device_id else owner_id = auth.uid() end);
$$;

create or replace function public.delete_my_board(p_device_id uuid, p_board_id uuid)
returns void language sql security definer set search_path = public, pg_temp
as $$
  update public.boards set deleted_at = now() where id = p_board_id and deleted_at is null
    and (case when auth.uid() is null then owner_id is null and device_id = p_device_id else owner_id = auth.uid() end);
$$;

create or replace function public.report_post(p_device_id uuid, p_post_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    insert into public.reports (target_type, target_id, device_id)
    values ('post', p_post_id, p_device_id) on conflict do nothing;
  elsif not exists (select 1 from public.reports where owner_id = auth.uid() and target_type = 'post' and target_id = p_post_id) then
    insert into public.reports (target_type, target_id, device_id, owner_id)
    values ('post', p_post_id, p_device_id, auth.uid());
  end if;
  update public.posts set flag_count = (select count(*) from public.reports where target_type = 'post' and target_id = p_post_id)
  where id = p_post_id;
end;
$$;

create or replace function public.report_board(p_device_id uuid, p_board_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    insert into public.reports (target_type, target_id, device_id)
    values ('board', p_board_id, p_device_id) on conflict do nothing;
  elsif not exists (select 1 from public.reports where owner_id = auth.uid() and target_type = 'board' and target_id = p_board_id) then
    insert into public.reports (target_type, target_id, device_id, owner_id)
    values ('board', p_board_id, p_device_id, auth.uid());
  end if;
  update public.boards set flag_count = (select count(*) from public.reports where target_type = 'board' and target_id = p_board_id)
  where id = p_board_id;
end;
$$;

revoke all on function public.account_clean_name(text) from public;
revoke all on function public.account_profile_set_name(text) from public;
revoke all on function public.account_identity_sync(uuid, text, boolean) from public;
grant execute on function public.account_profile_set_name(text) to authenticated;
grant execute on function public.account_identity_sync(uuid, text, boolean) to authenticated;

revoke all on function public.publish_score(uuid, text, int, text) from public;
revoke all on function public.publish_score(uuid, text, int, text, int) from public;
revoke all on function public.get_leaderboard(uuid, text) from public;
revoke all on function public.get_my_rank(uuid, text) from public;
revoke all on function public.remove_score(uuid) from public;
revoke all on function public.list_boards(uuid) from public;
revoke all on function public.create_board(uuid, text, text, text) from public;
revoke all on function public.list_posts(uuid, uuid) from public;
revoke all on function public.create_post(uuid, text, uuid, text) from public;
revoke all on function public.delete_my_post(uuid, uuid) from public;
revoke all on function public.delete_my_board(uuid, uuid) from public;
revoke all on function public.report_post(uuid, uuid) from public;
revoke all on function public.report_board(uuid, uuid) from public;

grant execute on function public.publish_score(uuid, text, int, text) to anon, authenticated;
grant execute on function public.publish_score(uuid, text, int, text, int) to anon, authenticated;
grant execute on function public.get_leaderboard(uuid, text) to anon, authenticated;
grant execute on function public.get_my_rank(uuid, text) to anon, authenticated;
grant execute on function public.remove_score(uuid) to anon, authenticated;
grant execute on function public.list_boards(uuid) to anon, authenticated;
grant execute on function public.create_board(uuid, text, text, text) to anon, authenticated;
grant execute on function public.list_posts(uuid, uuid) to anon, authenticated;
grant execute on function public.create_post(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.delete_my_post(uuid, uuid) to anon, authenticated;
grant execute on function public.delete_my_board(uuid, uuid) to anon, authenticated;
grant execute on function public.report_post(uuid, uuid) to anon, authenticated;
grant execute on function public.report_board(uuid, uuid) to anon, authenticated;
