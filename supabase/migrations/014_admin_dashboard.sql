-- 管理画面（admin.html）。オンライン人数・科目ごとの利用者・最大同時人数・利用者一覧を、管理者だけに返す。
-- 管理者は Supabase Auth（メールアドレス＋パスワード、メール確認済み）でログインし、admin_users に載ったメールだけが通る。
-- admin_users の行はこのファイルに書かず、SQLで直接入れる（公開リポジトリにメールアドレスを載せないため）：
--   insert into public.admin_users(email) values('<管理者のメールアドレス（小文字）>');
-- 画面のプログラムは公開されているので、ページを見つけられてもサーバーが管理者以外にはデータを返さないことで守る。
--
-- 利用状況：アプリは表示中、1分ごと（と科目を切り替えたとき）に usage_ping を送る。
--   送るのは端末ID・開いている科目ID・前回からの解答数／カード枚数だけ。
--   usage_devices は端末ごとの最終利用と開いている科目、usage_subject_days は端末×科目×日（日本時間）の利用。
-- 最大同時人数：usage_ping のついでに、その1分の人数がまだ記録されていなければ1行だけ記録する。
--   誰も開いていない時間は記録がない（0人として扱う）。60日より前の記録は消す。
create table if not exists public.admin_users (email text primary key check (email=lower(email)));
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon,authenticated;

create table if not exists public.usage_devices (
  device_id uuid primary key,
  owner_id uuid references auth.users(id) on delete set null,
  subject text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists usage_devices_last_seen on public.usage_devices(last_seen desc);
alter table public.usage_devices enable row level security;
revoke all on public.usage_devices from anon,authenticated;

create table if not exists public.usage_subject_days (
  device_id uuid not null references public.usage_devices(device_id) on delete cascade,
  subject text not null,
  day date not null,
  answers int not null default 0,
  cards int not null default 0,
  primary key (device_id,subject,day)
);
create index if not exists usage_subject_days_day on public.usage_subject_days(day,subject);
alter table public.usage_subject_days enable row level security;
revoke all on public.usage_subject_days from anon,authenticated;

create table if not exists public.online_samples (at timestamptz primary key, online int not null);
alter table public.online_samples enable row level security;
revoke all on public.online_samples from anon,authenticated;

-- 科目IDは subjects.js の id の形だけ受け付ける（それ以外は「科目を開いていない」扱い）。
-- 1回の解答数・枚数は0〜500に丸める。失敗してもアプリには影響しない（アプリ側は結果を見ない）。
create or replace function public.usage_ping(p_device_id uuid, p_subject text, p_answers int default 0, p_cards int default 0)
returns void language plpgsql volatile security definer set search_path=public as $$
declare
  v_subject text:=case when p_subject ~ '^[a-z0-9][a-z0-9_-]{0,47}$' then p_subject end;
  v_at timestamptz:=date_trunc('minute',now());
begin
  if p_device_id is null then return; end if;
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
end $$;

create or replace function public._is_admin() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from auth.users u join public.admin_users a on a.email=lower(u.email)
    where u.id=auth.uid() and u.email_confirmed_at is not null)
$$;

-- オンライン＝直近2分にアプリを表示していた端末（1分ごとに送るため）。
-- 名前はアカウントの表示名、なければランキングに出した名前（どちらもなければ null）。
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
    'subjects',(select coalesce(jsonb_agg(jsonb_build_object(
        'subject',d.subject,
        'online',(select count(*) from usage_devices u where u.subject=d.subject and u.last_seen>now()-v_online),
        'today',count(*) filter(where d.day=v_day),
        'd7',count(distinct d.device_id) filter(where d.day>v_day-7),
        'd30',count(distinct d.device_id) filter(where d.day>v_day-30),
        'total',count(distinct d.device_id),
        'answers_today',coalesce(sum(d.answers) filter(where d.day=v_day),0),
        'answers_d7',coalesce(sum(d.answers) filter(where d.day>v_day-7),0),
        'cards_today',coalesce(sum(d.cards) filter(where d.day=v_day),0),
        'cards_d7',coalesce(sum(d.cards) filter(where d.day>v_day-7),0))),'[]'::jsonb)
      from usage_subject_days d group by d.subject),
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

revoke execute on function public._is_admin() from public,anon,authenticated;
revoke execute on function public.get_admin_dashboard() from public,anon;
grant execute on function public.get_admin_dashboard() to authenticated;
revoke execute on function public.usage_ping(uuid,text,int,int) from public;
grant execute on function public.usage_ping(uuid,text,int,int) to anon,authenticated;
notify pgrst,'reload schema';
