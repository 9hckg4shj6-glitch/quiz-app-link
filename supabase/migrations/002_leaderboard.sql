-- 公開ランキング（グローバル1本）。
-- 端末ごとに発行される device_id（Dexie settings の "deviceId"）で行を識別する。
-- device_id は不特定多数へ公開したくないため、テーブルへの直接アクセスは全面禁止し、
-- 読み書きはすべて security definer の RPC 経由に限定する（他人の device_id を知り得ない）。

create table if not exists public.leaderboard (
  device_id uuid primary key,
  display_name text not null,
  solved_count int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;
-- anon / authenticated 向けのポリシーは作らない = 直接の select/insert/update/delete は不可。
-- アクセスは下の security definer 関数のみを通す。

create index if not exists leaderboard_solved_idx
  on public.leaderboard (solved_count desc, updated_at asc);

-- スコア登録・更新。名前を検証（制御文字除去・24文字まで・空不可）、
-- 解答数は 0〜100000 にクランプ。solved_count は単調増加（下がらない）。
create or replace function public.publish_score(p_device_id uuid, p_name text, p_solved int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  v_name := left(v_name, 24);
  if length(v_name) < 1 then
    raise exception '名前を入力してください';
  end if;
  insert into public.leaderboard as l (device_id, display_name, solved_count, updated_at)
  values (p_device_id, v_name, greatest(0, least(coalesce(p_solved, 0), 100000)), now())
  on conflict (device_id) do update
    set display_name = excluded.display_name,
        solved_count = greatest(l.solved_count, excluded.solved_count),
        updated_at   = now();
end;
$$;

-- 上位100件を返す。呼び出し元の device_id と一致する行に is_you=true を付ける
-- （他人の device_id は返さない）。
create or replace function public.get_leaderboard(p_device_id uuid)
returns table(rank int, display_name text, solved_count int, is_you boolean)
language sql
security definer
set search_path = public
as $$
  select (row_number() over (order by solved_count desc, updated_at asc))::int as rank,
         display_name,
         solved_count,
         (device_id = p_device_id) as is_you
  from public.leaderboard
  order by solved_count desc, updated_at asc
  limit 100;
$$;

-- 圏外（上位100件外）のときの自分の順位・解答数。
create or replace function public.get_my_rank(p_device_id uuid)
returns table(rank int, solved_count int)
language sql
security definer
set search_path = public
as $$
  select (1 + (
            select count(*) from public.leaderboard b
            where b.solved_count > a.solved_count
               or (b.solved_count = a.solved_count and b.updated_at < a.updated_at)
          ))::int as rank,
         a.solved_count
  from public.leaderboard a
  where a.device_id = p_device_id;
$$;

-- ランキングから自分を削除（オプトアウト）。
create or replace function public.remove_score(p_device_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.leaderboard where device_id = p_device_id;
$$;

revoke all on function public.publish_score(uuid, text, int) from public;
revoke all on function public.get_leaderboard(uuid) from public;
revoke all on function public.get_my_rank(uuid) from public;
revoke all on function public.remove_score(uuid) from public;

grant execute on function public.publish_score(uuid, text, int) to anon, authenticated;
grant execute on function public.get_leaderboard(uuid) to anon, authenticated;
grant execute on function public.get_my_rank(uuid) to anon, authenticated;
grant execute on function public.remove_score(uuid) to anon, authenticated;
