-- PDFの溜まり場。科目をまたいで資料PDFを持ち寄り、各自がダウンロードする。
-- 識別は端末ごとの device_id（Dexie settings の "deviceId"）。ログインは不要。
-- 掲示板（003）と同じく、テーブルは RLS 有効＋ポリシー無しで直接アクセスを全面禁止し、
-- 読み書きはすべて security definer の RPC 経由に限定する。
-- clean_name / app_secrets / is_admin / reports は 003・004 のものを再利用する。

create table if not exists public.pdf_files (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null,
  display_name text not null,
  title text not null,
  description text not null default '',
  subject_id text not null default 'other',
  lecture text not null default '',
  year int,
  tags text[] not null default '{}',
  -- 権利区分。投稿時に必ず申告させる（承認工程を置かないぶん、ここを必須にする）
  license text not null check (license in ('own', 'permitted', 'public_domain')),
  source text not null default '',
  storage_path text not null unique,
  byte_size bigint not null default 0,
  sha256 text,
  download_count int not null default 0,
  -- uploading: 行だけ先に作った状態。Storage への転送が終わると ready になり一覧に出る。
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  flag_count int not null default 0
);

alter table public.pdf_files enable row level security;
-- anon / authenticated 向けポリシーは作らない = 直接アクセス不可。RPC のみ。

create index if not exists pdf_files_public_idx
  on public.pdf_files (created_at desc)
  where deleted_at is null and status = 'ready';
create index if not exists pdf_files_device_created_idx
  on public.pdf_files (device_id, created_at desc);
create index if not exists pdf_files_sha256_idx
  on public.pdf_files (sha256)
  where deleted_at is null;

-- 004 の reports を PDF にも使う（通報は端末ごとに1回）
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'board', 'pdf'));

-- 制御文字を落として長さを詰める。掲示板の本文処理と同じ方針（改行・タブは残す）。
create or replace function public.pdf_clean_text(p_text text, p_len int)
returns text language sql immutable as $$
  select btrim(left(regexp_replace(coalesce(p_text, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'), p_len));
$$;

-- 投稿の受付。サーバー発行IDを返し、クライアントはそのIDでStorageへ上げる。
-- レート制限：1日5件まで。同じ内容のPDFが既にあれば重複として弾く。
create or replace function public.create_pdf_entry(
  p_device_id uuid, p_name text, p_title text, p_description text,
  p_subject_id text, p_lecture text, p_year int, p_tags text[],
  p_license text, p_source text, p_sha256 text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text; v_title text; v_id uuid; v_dup text; v_tags text[];
begin
  v_name  := public.clean_name(p_name);
  v_title := public.pdf_clean_text(p_title, 80);
  if length(v_title) < 1 then raise exception 'タイトルを入力してください'; end if;
  if p_license is null or p_license not in ('own', 'permitted', 'public_domain') then
    raise exception '権利区分を選んでください';
  end if;

  if (select count(*) from public.pdf_files
      where device_id = p_device_id and created_at > now() - interval '1 day') >= 5 then
    raise exception '1日にアップロードできるPDFは5件までです。';
  end if;

  if p_sha256 is not null then
    select f.title into v_dup from public.pdf_files f
    where f.sha256 = p_sha256 and f.deleted_at is null and f.status = 'ready'
    limit 1;
    if v_dup is not null then
      raise exception '同じファイルが「%」として既にアップロードされています。', v_dup;
    end if;
  end if;

  select coalesce(array_agg(t), '{}'::text[]) into v_tags
  from (
    select distinct public.pdf_clean_text(x, 20) as t
    from unnest(coalesce(p_tags, '{}'::text[])) as x
  ) s
  where length(s.t) > 0;
  v_tags := v_tags[1:8];

  v_id := gen_random_uuid();
  insert into public.pdf_files (
    id, device_id, display_name, title, description, subject_id, lecture, year,
    tags, license, source, storage_path, sha256
  )
  values (
    v_id, p_device_id, v_name, v_title,
    public.pdf_clean_text(p_description, 500),
    public.pdf_clean_text(p_subject_id, 40),
    public.pdf_clean_text(p_lecture, 40),
    case when p_year between 1990 and 2100 then p_year else null end,
    coalesce(v_tags, '{}'), p_license,
    public.pdf_clean_text(p_source, 200),
    v_id::text || '.pdf', p_sha256
  );
  return v_id;
end; $$;

-- Storage への転送完了。ここを通った行だけが一覧に出る。
create or replace function public.finish_pdf_upload(p_device_id uuid, p_id uuid, p_byte_size bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.pdf_files
  set status = 'ready', byte_size = greatest(coalesce(p_byte_size, 0), 0)
  where id = p_id and device_id = p_device_id and status = 'uploading' and deleted_at is null;
  if not found then raise exception 'このアップロードは受け付けられませんでした'; end if;
end; $$;

-- 転送前に作った行の始末。Storage へ上げる前に失敗したときだけ呼ぶ。
create or replace function public.cancel_pdf_entry(p_device_id uuid, p_id uuid)
returns void language sql security definer set search_path = public
as $$
  delete from public.pdf_files
  where id = p_id and device_id = p_device_id and status = 'uploading';
$$;

-- 一覧。他人の device_id は返さない。p_subject_id / p_query は null で絞り込みなし。
create or replace function public.list_pdfs(p_device_id uuid, p_subject_id text, p_query text)
returns table(
  id uuid, title text, description text, author text, subject_id text,
  lecture text, year int, tags text[], license text, source text,
  byte_size bigint, download_count int, created_at timestamptz, is_mine boolean
)
language sql security definer set search_path = public
as $$
  select f.id, f.title, f.description, f.display_name, f.subject_id,
         f.lecture, f.year, f.tags, f.license, f.source,
         f.byte_size, f.download_count, f.created_at,
         (f.device_id = p_device_id)
  from public.pdf_files f
  where f.deleted_at is null and f.status = 'ready' and f.flag_count < 3
    and (p_subject_id is null or f.subject_id = p_subject_id)
    and (
      p_query is null or btrim(p_query) = '' or
      f.title ilike '%' || btrim(p_query) || '%' or
      f.description ilike '%' || btrim(p_query) || '%' or
      f.lecture ilike '%' || btrim(p_query) || '%' or
      exists (select 1 from unnest(f.tags) t where t ilike '%' || btrim(p_query) || '%')
    )
  order by f.created_at desc
  limit 200;
$$;

-- ダウンロード。署名URLはクライアントが作るので、ここでは経路を返してカウントだけ進める。
create or replace function public.pdf_download_path(p_device_id uuid, p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_path text;
begin
  update public.pdf_files
  set download_count = download_count + 1
  where id = p_id and deleted_at is null and status = 'ready' and flag_count < 3
  returning storage_path into v_path;
  if v_path is null then raise exception 'このPDFは公開されていません'; end if;
  return v_path;
end; $$;

create or replace function public.delete_my_pdf(p_device_id uuid, p_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.pdf_files set deleted_at = now()
  where id = p_id and device_id = p_device_id and deleted_at is null;
$$;

-- 通報。端末ごとに1回まで。3件で一覧から消える。
create or replace function public.report_pdf(p_device_id uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.reports (target_type, target_id, device_id)
  values ('pdf', p_id, p_device_id)
  on conflict do nothing;

  update public.pdf_files
  set flag_count = (
    select count(*) from public.reports
    where target_type = 'pdf' and target_id = p_id
  )
  where id = p_id;
end; $$;

create or replace function public.admin_delete_pdf(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin(p_token) then raise exception '権限がありません'; end if;
  update public.pdf_files set deleted_at = now() where id = p_id;
end; $$;

-- 残り容量の表示用。無料枠は1GB。
create or replace function public.pdf_shelf_stats()
returns table(file_count int, total_bytes bigint)
language sql security definer set search_path = public
as $$
  select count(*)::int, coalesce(sum(byte_size), 0)::bigint
  from public.pdf_files
  where deleted_at is null and status = 'ready';
$$;

revoke all on function public.pdf_clean_text(text, int) from public;
revoke all on function public.create_pdf_entry(uuid, text, text, text, text, text, int, text[], text, text, text) from public;
revoke all on function public.finish_pdf_upload(uuid, uuid, bigint) from public;
revoke all on function public.cancel_pdf_entry(uuid, uuid) from public;
revoke all on function public.list_pdfs(uuid, text, text) from public;
revoke all on function public.pdf_download_path(uuid, uuid) from public;
revoke all on function public.delete_my_pdf(uuid, uuid) from public;
revoke all on function public.report_pdf(uuid, uuid) from public;
revoke all on function public.admin_delete_pdf(text, uuid) from public;
revoke all on function public.pdf_shelf_stats() from public;

grant execute on function public.create_pdf_entry(uuid, text, text, text, text, text, int, text[], text, text, text) to anon, authenticated;
grant execute on function public.finish_pdf_upload(uuid, uuid, bigint) to anon, authenticated;
grant execute on function public.cancel_pdf_entry(uuid, uuid) to anon, authenticated;
grant execute on function public.list_pdfs(uuid, text, text) to anon, authenticated;
grant execute on function public.pdf_download_path(uuid, uuid) to anon, authenticated;
grant execute on function public.delete_my_pdf(uuid, uuid) to anon, authenticated;
grant execute on function public.report_pdf(uuid, uuid) to anon, authenticated;
grant execute on function public.admin_delete_pdf(text, uuid) to anon, authenticated;
grant execute on function public.pdf_shelf_stats() to anon, authenticated;

-- Storage。非公開バケットで、署名付きURLからのみ取得できる。
-- select を付けないとクライアントが createSignedUrl を呼べない。delete は付けない
--（誤削除・悪意ある削除を防ぐ。削除された行のファイルはダッシュボードから手動で消す）。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdf-shelf', 'pdf-shelf', false, 20971520, array['application/pdf'])
on conflict (id) do update
set public = false, file_size_limit = 20971520, allowed_mime_types = array['application/pdf'];

drop policy if exists "pdf_shelf_select" on storage.objects;
drop policy if exists "pdf_shelf_insert" on storage.objects;
create policy "pdf_shelf_select" on storage.objects
  for select to anon, authenticated using (bucket_id = 'pdf-shelf');
create policy "pdf_shelf_insert" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'pdf-shelf');
