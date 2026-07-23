-- ランキングを科目別にする。
-- アプリが複数科目（代謝・薬理・生理…）を扱うようになったため、
-- 「どの科目を何問やったか」で順位を出せるようにする。
--
-- 既存行は subject = 'metabolism' として扱われるので、
-- 今までのランキングはそのまま代謝のランキングとして残る（消えない）。
--
-- 旧シグネチャの関数（引数に p_subject が無いもの）は最後に drop する。
-- アプリ側は新シグネチャで呼ぶため、このマイグレーション適用まではランキングが
-- エラーになるが、アプリはその場合ランキングを非表示にフォールバックする。

alter table public.leaderboard
  add column if not exists subject text not null default 'metabolism';

-- 主キーを (device_id) から (device_id, subject) へ。
-- 同じ端末が科目ごとに1行ずつ持てるようにする。
alter table public.leaderboard drop constraint if exists leaderboard_pkey;
alter table public.leaderboard add primary key (device_id, subject);

drop index if exists leaderboard_solved_idx;
create index if not exists leaderboard_subject_solved_idx
  on public.leaderboard (subject, solved_count desc, updated_at asc);

-- 科目名の正規化（空なら metabolism 扱い、48文字まで、制御文字除去）
create or replace function public.norm_subject(p_subject text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(left(btrim(regexp_replace(coalesce(p_subject, ''), '[[:cntrl:]]', '', 'g')), 48), ''), 'metabolism');
$$;

create or replace function public.publish_score(p_device_id uuid, p_name text, p_solved int, p_subject text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_subject text;
begin
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  v_name := left(v_name, 24);
  if length(v_name) < 1 then
    raise exception '名前を入力してください';
  end if;
  v_subject := public.norm_subject(p_subject);
  insert into public.leaderboard as l (device_id, subject, display_name, solved_count, updated_at)
  values (p_device_id, v_subject, v_name, greatest(0, least(coalesce(p_solved, 0), 100000)), now())
  on conflict (device_id, subject) do update
    set display_name = excluded.display_name,
        solved_count = greatest(l.solved_count, excluded.solved_count),
        updated_at   = now();
end;
$$;

create or replace function public.get_leaderboard(p_device_id uuid, p_subject text)
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
  where subject = public.norm_subject(p_subject)
  order by solved_count desc, updated_at asc
  limit 100;
$$;

create or replace function public.get_my_rank(p_device_id uuid, p_subject text)
returns table(rank int, solved_count int)
language sql
security definer
set search_path = public
as $$
  select (1 + (
            select count(*) from public.leaderboard b
            where b.subject = a.subject
              and (b.solved_count > a.solved_count
               or (b.solved_count = a.solved_count and b.updated_at < a.updated_at))
          ))::int as rank,
         a.solved_count
  from public.leaderboard a
  where a.device_id = p_device_id
    and a.subject = public.norm_subject(p_subject);
$$;

-- 退会は全科目まとめて削除（アプリの「ランキングから抜ける」は全体オプトアウトのため）
create or replace function public.remove_score(p_device_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.leaderboard where device_id = p_device_id;
$$;

-- 旧シグネチャを撤去（同名オーバーロードが残ると呼び分けが曖昧になるため）
drop function if exists public.publish_score(uuid, text, int);
drop function if exists public.get_leaderboard(uuid);
drop function if exists public.get_my_rank(uuid);

revoke all on function public.publish_score(uuid, text, int, text) from public;
revoke all on function public.get_leaderboard(uuid, text) from public;
revoke all on function public.get_my_rank(uuid, text) from public;
revoke all on function public.norm_subject(text) from public;

grant execute on function public.publish_score(uuid, text, int, text) to anon, authenticated;
grant execute on function public.get_leaderboard(uuid, text) to anon, authenticated;
grant execute on function public.get_my_rank(uuid, text) to anon, authenticated;
grant execute on function public.norm_subject(text) to anon, authenticated;
