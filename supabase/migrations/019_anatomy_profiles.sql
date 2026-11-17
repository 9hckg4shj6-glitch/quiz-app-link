-- からだ見聞録（解剖学アプリ。別のリポジトリ anatomy-app）の利用者の名前と所属を集め、管理画面に出す。
-- アプリはサーバーを持たないので、この Supabase を借りる。スタート画面で入れた名前・大学・学部学科・学年を端末ごとに1行。
-- 学習の記録は送らない。端末IDは推測できない乱数なので、set_device_name と同じく anon からも呼べる。
create table if not exists public.anatomy_profiles(
  device_id uuid primary key,
  display_name text not null,
  university text not null,
  faculty text not null,
  grade text not null,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
alter table public.anatomy_profiles enable row level security;
revoke all on public.anatomy_profiles from anon, authenticated;

-- 名前と所属を入れる・直す。制御文字を除き、名前24・大学60・学部学科40・学年20文字まで。どれかが空なら何もしない
create or replace function public.anatomy_profile_set(p_device_id uuid, p_name text, p_university text, p_faculty text, p_grade text)
returns void language plpgsql volatile security definer set search_path=public as $$
declare
  v_name text:=left(btrim(regexp_replace(coalesce(p_name,''),'[[:cntrl:]]','','g')),24);
  v_university text:=left(btrim(regexp_replace(coalesce(p_university,''),'[[:cntrl:]]','','g')),60);
  v_faculty text:=left(btrim(regexp_replace(coalesce(p_faculty,''),'[[:cntrl:]]','','g')),40);
  v_grade text:=left(btrim(regexp_replace(coalesce(p_grade,''),'[[:cntrl:]]','','g')),20);
begin
  if p_device_id is null or v_name='' or v_university='' or v_faculty='' or v_grade='' then return; end if;
  insert into anatomy_profiles(device_id,display_name,university,faculty,grade)
  values(p_device_id,v_name,v_university,v_faculty,v_grade)
  on conflict(device_id) do update set display_name=excluded.display_name, university=excluded.university,
    faculty=excluded.faculty, grade=excluded.grade, updated_at=now(), last_seen=now();
end $$;
revoke execute on function public.anatomy_profile_set(uuid,text,text,text,text) from public;
grant execute on function public.anatomy_profile_set(uuid,text,text,text,text) to anon,authenticated;

-- アプリを開いた日を残す（1日1回）。まだ所属を送っていない端末は何もしない
create or replace function public.anatomy_seen(p_device_id uuid)
returns void language sql volatile security definer set search_path=public as $$
  update anatomy_profiles set last_seen=now() where device_id=p_device_id;
$$;
revoke execute on function public.anatomy_seen(uuid) from public;
grant execute on function public.anatomy_seen(uuid) to anon,authenticated;

-- 管理画面の「からだ見聞録の利用者」。管理者だけ（014 の _is_admin）
create or replace function public.get_admin_anatomy() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_today timestamptz:=((now() at time zone 'Asia/Tokyo')::date)::timestamp at time zone 'Asia/Tokyo';
begin
  if not _is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return jsonb_build_object(
    'total',(select count(*) from anatomy_profiles),
    'today',(select count(*) from anatomy_profiles where last_seen>=v_today),
    'd7',(select count(*) from anatomy_profiles where last_seen>now()-interval '7 days'),
    'new_d7',(select count(*) from anatomy_profiles where first_seen>now()-interval '7 days'),
    'universities',(select coalesce(jsonb_agg(jsonb_build_object('label',university,'users',n) order by n desc,university),'[]'::jsonb)
      from (select university,count(*) n from anatomy_profiles group by 1) x),
    'faculties',(select coalesce(jsonb_agg(jsonb_build_object('label',faculty,'users',n) order by n desc,faculty),'[]'::jsonb)
      from (select faculty,count(*) n from anatomy_profiles group by 1) x),
    'grades',(select coalesce(jsonb_agg(jsonb_build_object('label',grade,'users',n) order by grade),'[]'::jsonb)
      from (select grade,count(*) n from anatomy_profiles group by 1) x),
    'users',(select coalesce(jsonb_agg(jsonb_build_object('id',left(device_id::text,8),'name',display_name,'university',university,
      'faculty',faculty,'grade',grade,'first_seen',first_seen,'last_seen',last_seen) order by last_seen desc),'[]'::jsonb) from anatomy_profiles));
end $$;
revoke execute on function public.get_admin_anatomy() from public,anon;
grant execute on function public.get_admin_anatomy() to authenticated;
