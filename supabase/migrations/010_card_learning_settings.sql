-- カード学習 Phase 1: 休止・共有元情報・デッキ別学習設定
-- フロントエンドで新しい列を送信する前に適用する。

alter table public.cards
  add column if not exists suspended_at timestamptz,
  add column if not exists origin_deck_id text,
  add column if not exists origin_version integer,
  add column if not exists origin_card_id text;

alter table public.decks
  add column if not exists new_cards_per_day integer not null default 20,
  add column if not exists reviews_per_day integer not null default 200,
  add column if not exists desired_retention double precision not null default 0.9;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cards_origin_version_check') then
    alter table public.cards
      add constraint cards_origin_version_check
      check (origin_version is null or origin_version > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cards_origin_fields_check') then
    alter table public.cards
      add constraint cards_origin_fields_check
      check (
        (origin_deck_id is null and origin_version is null and origin_card_id is null)
        or
        (origin_deck_id is not null and origin_version is not null and origin_card_id is not null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'decks_new_cards_per_day_check') then
    alter table public.decks
      add constraint decks_new_cards_per_day_check
      check (new_cards_per_day between 0 and 1000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'decks_reviews_per_day_check') then
    alter table public.decks
      add constraint decks_reviews_per_day_check
      check (reviews_per_day between 0 and 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'decks_desired_retention_check') then
    alter table public.decks
      add constraint decks_desired_retention_check
      check (desired_retention between 0.7 and 0.99);
  end if;
end
$$;

create index if not exists cards_owner_origin_idx
  on public.cards (owner_id, origin_deck_id, origin_card_id)
  where origin_deck_id is not null;
