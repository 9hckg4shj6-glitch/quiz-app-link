-- 通報の重複排除。
-- 003 の report_post/report_board は flag_count を単純加算していたため、
-- 1人が3回通報するだけで任意の投稿を非表示にできた（＝誰でも検閲できる状態）。
-- 通報を「端末ごとに1回」に制限し、flag_count は通報した端末数から再計算する。

create table if not exists public.reports (
  target_type text not null check (target_type in ('post', 'board')),
  target_id uuid not null,
  device_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (target_type, target_id, device_id)
);

alter table public.reports enable row level security;
-- ポリシー無し = 直接アクセス不可。RPC のみ。

-- 旧シグネチャは必ず削除する（残すとオーバーロードとして呼び出せてしまう）
drop function if exists public.report_post(uuid);
drop function if exists public.report_board(uuid);

create or replace function public.report_post(p_device_id uuid, p_post_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.reports (target_type, target_id, device_id)
  values ('post', p_post_id, p_device_id)
  on conflict do nothing;

  update public.posts
  set flag_count = (
    select count(*) from public.reports
    where target_type = 'post' and target_id = p_post_id
  )
  where id = p_post_id;
end; $$;

create or replace function public.report_board(p_device_id uuid, p_board_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.reports (target_type, target_id, device_id)
  values ('board', p_board_id, p_device_id)
  on conflict do nothing;

  update public.boards
  set flag_count = (
    select count(*) from public.reports
    where target_type = 'board' and target_id = p_board_id
  )
  where id = p_board_id;
end; $$;

-- 加算方式で溜まった既存の flag_count を、実際の通報数に合わせて作り直す
update public.posts p
set flag_count = coalesce((
  select count(*) from public.reports r
  where r.target_type = 'post' and r.target_id = p.id
), 0);

update public.boards b
set flag_count = coalesce((
  select count(*) from public.reports r
  where r.target_type = 'board' and r.target_id = b.id
), 0);

revoke all on function public.report_post(uuid, uuid) from public;
revoke all on function public.report_board(uuid, uuid) from public;
grant execute on function public.report_post(uuid, uuid) to anon, authenticated;
grant execute on function public.report_board(uuid, uuid) to anon, authenticated;
