-- 端末ごとに、いま開いているアプリの版（ビルドしたコミットの先頭7文字）を持たせ、管理画面の利用者一覧に出す。
-- 古い版のまま残っている端末を見分けるため。版を送らない旧版のまま開いている端末は空のまま。
alter table public.usage_devices add column if not exists app_version text;

-- usage_ping・set_device_name と同じく anon からも呼べる。版は英数字だけ受け付ける。
create or replace function public.set_device_version(p_device_id uuid, p_version text)
returns void language plpgsql volatile security definer set search_path=public as $$
declare v_version text:=case when p_version ~ '^[0-9a-z]{1,40}$' then p_version end;
begin
  if p_device_id is null or v_version is null then return; end if;
  insert into usage_devices(device_id,owner_id,app_version) values(p_device_id,auth.uid(),v_version)
  on conflict(device_id) do update set app_version=excluded.app_version,
    owner_id=coalesce(excluded.owner_id,usage_devices.owner_id);
end $$;

revoke execute on function public.set_device_version(uuid,text) from public;
grant execute on function public.set_device_version(uuid,text) to anon,authenticated;

-- 利用者一覧に端末の版を足す。それ以外は 017 と同じ。
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
        'name',coalesce(nullif(ap.display_name,''),nullif(u.display_name,''),nullif(lb.display_name,'利用者'),lbo.display_name,lb.display_name),
        'account',o.owner_id is not null,
        'subject',u.subject,
        'online',u.last_seen>now()-v_online,
        'last_seen',u.last_seen,'first_seen',u.first_seen,
        'app_version',u.app_version,
        'answers_today',coalesce(s.answers_today,0),
        'answers',coalesce(s.answers,0),
        'subjects',coalesce(s.subjects,'[]'::jsonb)) u
      from usage_devices u
      left join lateral (select coalesce(u.owner_id,(select ad.owner_id from account_devices ad
        where ad.device_id=u.device_id order by ad.claimed_at desc limit 1)) owner_id) o on true
      left join account_profiles ap on ap.owner_id=o.owner_id
      left join lateral (select l.display_name from leaderboard l where l.device_id=u.device_id
        order by l.updated_at desc limit 1) lb on true
      left join lateral (select l.display_name from leaderboard l
        where o.owner_id is not null and (l.owner_id=o.owner_id
          or l.device_id in (select ad.device_id from account_devices ad where ad.owner_id=o.owner_id)
          or l.device_id in (select ud.device_id from usage_devices ud where ud.owner_id=o.owner_id))
        order by l.display_name='利用者',l.updated_at desc limit 1) lbo on true
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

revoke execute on function public.get_admin_dashboard() from public,anon;
grant execute on function public.get_admin_dashboard() to authenticated;
notify pgrst,'reload schema';
