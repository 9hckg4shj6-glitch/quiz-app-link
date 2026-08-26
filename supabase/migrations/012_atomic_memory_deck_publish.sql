-- 暗記カードの公開を1トランザクションで完結させる。
-- 旧クライアントの「draft化 → 全カード削除 → 再挿入 → published化」は、
-- 途中で通信や制約エラーが起きると公開デッキが消えたままになるためRPCへ集約する。

create or replace function public.publish_memory_deck(
  p_deck_id text,
  p_subject_id text,
  p_title text,
  p_description text,
  p_cards jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_owner_id uuid;
  v_version integer;
  v_card_count integer;
  v_card jsonb;
begin
  if v_user_id is null then
    raise exception 'デッキを公開するにはログインが必要です';
  end if;
  if coalesce(length(btrim(p_deck_id)), 0) = 0 then
    raise exception 'デッキIDがありません';
  end if;
  if coalesce(length(btrim(p_subject_id)), 0) = 0 then
    raise exception '科目がありません';
  end if;
  if coalesce(length(btrim(p_title)), 0) not between 1 and 80 then
    raise exception 'デッキ名は1〜80文字で入力してください';
  end if;
  if length(coalesce(p_description, '')) > 500 then
    raise exception '説明は500文字以内で入力してください';
  end if;
  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'カードの形式が正しくありません';
  end if;

  v_card_count := jsonb_array_length(p_cards);
  if v_card_count not between 1 and 5000 then
    raise exception '公開するカードは1〜5000枚にしてください';
  end if;

  for v_card in select value from jsonb_array_elements(p_cards)
  loop
    if jsonb_typeof(v_card) <> 'object'
      or coalesce(length(btrim(v_card ->> 'origin_card_id')), 0) = 0
      or coalesce(length(v_card ->> 'front'), 0) not between 1 and 2000
      or coalesce(length(v_card ->> 'back'), 0) not between 1 and 4000
      or length(coalesce(v_card ->> 'explanation', '')) > 4000
      or jsonb_typeof(coalesce(v_card -> 'tags', '[]'::jsonb)) <> 'array'
    then
      raise exception '公開できない形式のカードが含まれています';
    end if;
  end loop;

  select owner_id, version
    into v_owner_id, v_version
  from public.shared_memory_decks
  where id = p_deck_id
  for update;

  if found and v_owner_id <> v_user_id then
    raise exception 'このデッキIDは別のユーザーが使用しています';
  end if;
  v_version := coalesce(v_version, 0) + 1;

  insert into public.shared_memory_decks (
    id, owner_id, subject_id, title, description, status, version,
    card_count, published_at, updated_at, deleted_at
  ) values (
    p_deck_id, v_user_id, p_subject_id, btrim(p_title), coalesce(p_description, ''),
    'draft', v_version, v_card_count, null, now(), null
  )
  on conflict (id) do update set
    subject_id = excluded.subject_id,
    title = excluded.title,
    description = excluded.description,
    status = 'draft',
    version = excluded.version,
    card_count = excluded.card_count,
    updated_at = now(),
    deleted_at = null
  where shared_memory_decks.owner_id = v_user_id
  returning shared_memory_decks.version into v_version;

  -- 同じIDの初回公開が同時実行された場合も、他ユーザーの行を上書きしない。
  if not found then
    raise exception 'このデッキIDは別のユーザーが使用しています';
  end if;

  delete from public.shared_memory_cards
  where shared_deck_id = p_deck_id and owner_id = v_user_id;

  insert into public.shared_memory_cards (
    id, shared_deck_id, owner_id, origin_card_id,
    front, back, explanation, tags, position
  )
  select
    p_deck_id || ':' || (card.value ->> 'origin_card_id'),
    p_deck_id,
    v_user_id,
    card.value ->> 'origin_card_id',
    card.value ->> 'front',
    card.value ->> 'back',
    coalesce(card.value ->> 'explanation', ''),
    coalesce(array(
      select jsonb_array_elements_text(coalesce(card.value -> 'tags', '[]'::jsonb))
    ), '{}'::text[]),
    (card.ordinality - 1)::integer
  from jsonb_array_elements(p_cards) with ordinality as card(value, ordinality);

  update public.shared_memory_decks
  set status = 'published', published_at = now()
  where id = p_deck_id and owner_id = v_user_id;

  return v_version;
end;
$$;

revoke all on function public.publish_memory_deck(text, text, text, text, jsonb) from public;
grant execute on function public.publish_memory_deck(text, text, text, text, jsonb) to authenticated;
