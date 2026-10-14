-- 管理画面から、指定した端末のアプリ利用を停止する（014 の続き）。
-- 停止した端末は usage_ping の返り値 blocked=true を受け取り、アプリが全面の「停止中」画面を出して操作できなくする。
-- 停止時にその端末がアカウントへログインしていれば、そのアカウントも停止する（別の端末でログインしても止まる）。
-- 限界：アプリは静的サイトなので、端末のサイトデータを消して端末IDを作り直したゲストは止められない。
create table if not exists public.blocked_devices (
  device_id uuid primary key,
  owner_id uuid,
  blocked_at timestamptz not null default now()
);
create index if not exists blocked_devices_owner on public.blocked_devices(owner_id) where owner_id is not null;
alter table public.blocked_devices enable row level security;
revoke all on public.blocked_devices from anon,authenticated;

-- 返り値を void から jsonb（停止中かどうか）に変えるため作り直す。
drop function if exists public.usage_ping(uuid,text,int,int);
create function public.usage_ping(p_device_id uuid, p_subject text, p_answers int default 0, p_cards int default 0)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  v_subject text:=case when p_subject ~ '^[a-z0-9][a-z0-9_-]{0,47}$' then p_subject end;
  v_at timestamptz:=date_trunc('minute',now());
begin
  if p_device_id is null then return jsonb_build_object('blocked',false); end if;
  insert into usage_devices(device_id,owner_id,subject) values(p_device_id,auth.uid(),v_subject)
  on conflict(device_id) do update set last_seen=now(),subject=excluded.subject,
    owner_id=coalesce(excluded.owner_id,usage_devices.owner_id);
  if v_subject is not null then
    insert into usage_subject_days(device_id,subject,day,answers,cards)
    values(p_device_id,v_subject,(now() at time zone 'Asia/Tokyo')::date,
      least(greatest(coalesce(p_answers,0),0),500),least(greatest(coalesce(p_cards,0),0),500))
    on conflict(device_id,subject,day) do update set
      answers=usage_subject_days.answers+excluded.answers,cards=usage_subject_days.cards+excluded.cards;
  end if;
  if not exists(select 1 from online_samples where at=v_at) then
    begin
      insert into online_samples(at,online)
      select v_at,count(*) from usage_devices where last_seen>now()-interval '2 minutes'
      on conflict do nothing;
      delete from online_samples where at<now()-interval '60 days';
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('blocked',exists(select 1 from blocked_devices b
    where b.device_id=p_device_id or (auth.uid() is not null and b.owner_id=auth.uid())));
end $$;

-- 停止・解除。解除は、その端末と、その端末のアカウントに結びついた停止をまとめて外す。
create or replace function public.admin_set_device_blocked(p_device_id uuid, p_blocked boolean)
returns void language plpgsql volatile security definer set search_path=public as $$
declare v_owner uuid:=(select owner_id from usage_devices where device_id=p_device_id);
begin
  if not _is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if p_blocked then
    insert into blocked_devices(device_id,owner_id) values(p_device_id,v_owner)
    on conflict(device_id) do update set owner_id=coalesce(excluded.owner_id,blocked_devices.owner_id);
  else
    delete from blocked_devices where device_id=p_device_id or (v_owner is not null and owner_id=v_owner);
  end if;
end $$;

-- 利用者一覧に端末ID（全体）と停止中かどうかを足す。それ以外は 014 と同じ。
create or replace function public.get_admin_dashboard() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_day date:=(now() at time zone 'Asia/Tokyo')::date;
  v_today timestamptz:=v_day::timestamp at time zone 'Asia/Tokyo';
  v_online interval:=interval '2 minutes';
begin
  if not _is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return jsonb_build_object(
    'online',(select count(*) from usage_devices where last_seen>now()-v_online),
    'active',(select jsonb_build_object(
      'h1',count(*) filter(where last_seen>now()-interval '1 hour'),
      'today',count(*) filter(where last_seen>=v_today),
      'd7',count(*) filter(where last_seen>now()-interval '7 days'),
      'total',count(*),
      'new_today',count(*) filter(where first_seen>=v_today),
      'new_d7',count(*) filter(where first_seen>now()-interval '7 days')) from usage_devices),
    'subjects',(select coalesce(jsonb_agg(x.subject_row),'[]'::jsonb) from (
      select jsonb_build_object(
        'subject',d.subject,
        'online',(select count(*) from usage_devices u where u.subject=d.subject and u.last_seen>now()-v_online),
        'today',count(*) filter(where d.day=v_day),
        'd7',count(distinct d.device_id) filter(where d.day>v_day-7),
        'd30',count(distinct d.device_id) filter(where d.day>v_day-30),
        'total',count(distinct d.device_id),
        'answers_today',coalesce(sum(d.answers) filter(where d.day=v_day),0),
        'answers_d7',coalesce(sum(d.answers) filter(where d.day>v_day-7),0),
        'cards_today',coalesce(sum(d.cards) filter(where d.day=v_day),0),
        'cards_d7',coalesce(sum(d.cards) filter(where d.day>v_day-7),0)) subject_row
      from usage_subject_days d group by d.subject) x),
    'daily',(select coalesce(jsonb_agg(jsonb_build_object('day',day,'subject',subject,'users',n)),'[]'::jsonb) from (
      select day,subject,count(*) n from usage_subject_days where day>v_day-14 group by 1,2) x),
    'daily_total',(select coalesce(jsonb_agg(jsonb_build_object('day',day,'users',n)),'[]'::jsonb) from (
      select day,count(distinct device_id) n from usage_subject_days where day>v_day-14 group by 1) x),
    'hourly',(select coalesce(jsonb_agg(jsonb_build_object('at',h,'online',o) order by h),'[]'::jsonb) from (
      select date_trunc('hour',at) h,max(online) o
      from online_samples where at>date_trunc('hour',now())-interval '23 hours' group by 1) x),
    'peak_daily',(select coalesce(jsonb_agg(jsonb_build_object('day',d,'online',o) order by d),'[]'::jsonb) from (
      select (at at time zone 'Asia/Tokyo')::date d,max(online) o
      from online_samples where at>=v_today-interval '13 days' group by 1) x),
    'peak',(select jsonb_build_object('online',online,'at',at) from online_samples order by online desc,at desc limit 1),
    'sampled_since',(select min(at) from online_samples),
    'users',(select coalesce(jsonb_agg(x.u order by x.last_seen desc),'[]'::jsonb) from (
      select u.last_seen,jsonb_build_object(
        'id',left(u.device_id::text,8),
        'device_id',u.device_id,
        'blocked',exists(select 1 from blocked_devices b where b.device_id=u.device_id or b.owner_id=u.owner_id),
        'name',coalesce(nullif(ap.display_name,''),lb.display_name),
        'account',u.owner_id is not null,
        'subject',u.subject,
        'online',u.last_seen>now()-v_online,
        'last_seen',u.last_seen,'first_seen',u.first_seen,
        'answers_today',coalesce(s.answers_today,0),
        'answers',coalesce(s.answers,0),
        'subjects',coalesce(s.subjects,'[]'::jsonb)) u
      from usage_devices u
      left join account_profiles ap on ap.owner_id=u.owner_id
      left join lateral (select l.display_name from leaderboard l where l.device_id=u.device_id
        order by l.updated_at desc limit 1) lb on true
      left join lateral (
        select sum(answers_today) answers_today,sum(answers) answers,
          jsonb_agg(jsonb_build_object('subject',subject,'last_day',last_day,'answers',answers,'cards',cards)
            order by last_day desc,answers desc) subjects
        from (select subject,max(day) last_day,sum(answers) answers,sum(cards) cards,
            sum(answers) filter(where day=v_day) answers_today
          from usage_subject_days where device_id=u.device_id group by subject) y) s on true
      order by u.last_seen desc limit 2000) x),
    'server_now',now());
end $$;

revoke execute on function public.usage_ping(uuid,text,int,int) from public;
grant execute on function public.usage_ping(uuid,text,int,int) to anon,authenticated;
revoke execute on function public.admin_set_device_blocked(uuid,boolean) from public,anon;
grant execute on function public.admin_set_device_blocked(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
