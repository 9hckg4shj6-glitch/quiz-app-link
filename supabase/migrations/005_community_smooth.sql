-- コミュニティを円滑に使えるようにする修正。
--
-- 1) レート制限が厳しすぎて、掲示板やコメントを続けて作れなかった
--    （板は5分に1件・1日5件、投稿は1分3件・1時間20件）。
--    荒らし対策としての意味は保ちつつ、実利用で当たらない値まで緩める。
--
-- 2) list_posts が「古い順に500件」だったため、投稿が500件を超えた掲示板では
--    新しい書き込みが表示されなくなっていた（＝増えると止まる）。
--    常に最新200件を取得し、表示は時系列（古い→新しい）に戻す。

-- 掲示板作成：1分5件・1日30件まで
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
      where device_id = p_device_id and created_at > now() - interval '1 minute') >= 5 then
    raise exception '掲示板の作成が続いています。少し待ってからお試しください。';
  end if;
  if (select count(*) from public.boards
      where device_id = p_device_id and created_at > now() - interval '1 day') >= 30 then
    raise exception '1日に作成できる掲示板の上限に達しました。';
  end if;

  insert into public.boards (device_id, display_name, title, description)
  values (p_device_id, v_name, v_title, v_desc)
  returning id into v_id;
  return v_id;
end; $$;

-- 書き込み：1分10件・1時間200件まで
create or replace function public.create_post(p_device_id uuid, p_name text, p_board_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text; v_body text; v_id uuid;
begin
  v_name := public.clean_name(p_name);
  -- 改行・タブは残し、それ以外の制御文字だけを除去する。
  v_body := regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  v_body := btrim(left(v_body, 1000));
  if length(v_body) < 1 then raise exception '本文を入力してください'; end if;

  if not exists (select 1 from public.boards where id = p_board_id and deleted_at is null) then
    raise exception 'この掲示板は削除されています';
  end if;

  if (select count(*) from public.posts
      where device_id = p_device_id and created_at > now() - interval '1 minute') >= 10 then
    raise exception '投稿が速すぎます。少し待ってからお試しください。';
  end if;
  if (select count(*) from public.posts
      where device_id = p_device_id and created_at > now() - interval '1 hour') >= 200 then
    raise exception '1時間あたりの投稿上限に達しました。';
  end if;

  insert into public.posts (board_id, device_id, display_name, body)
  values (p_board_id, p_device_id, v_name, v_body)
  returning id into v_id;
  return v_id;
end; $$;

-- 常に「最新200件」を取り、表示順は時系列（古い→新しい）に戻す。
-- これで投稿が増えても新しい書き込みが必ず見える。
create or replace function public.list_posts(p_device_id uuid, p_board_id uuid)
returns table(id uuid, author text, body text, created_at timestamptz, is_mine boolean)
language sql security definer set search_path = public
as $$
  select t.id, t.author, t.body, t.created_at, t.is_mine
  from (
    select p.id as id,
           p.display_name as author,
           p.body as body,
           p.created_at as created_at,
           (p.device_id = p_device_id) as is_mine
    from public.posts p
    where p.board_id = p_board_id and p.deleted_at is null and p.flag_count < 3
    order by p.created_at desc
    limit 200
  ) t
  order by t.created_at asc;
$$;
