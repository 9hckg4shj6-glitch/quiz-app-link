-- 全科目共通「暗記カード」
-- 既存の代謝教材カード（card_system = legacy）とは保存上も表示上も分離する。

alter table public.decks
  add column if not exists card_system text not null default 'legacy',
  add column if not exists subject_id text,
  add column if not exists origin_shared_deck_id text,
  add column if not exists origin_version integer;

update public.decks
set subject_id = 'metabolism'
where subject_id is null and card_system = 'legacy';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'decks_card_system_check') then
    alter table public.decks add constraint decks_card_system_check
      check (card_system in ('legacy', 'memory'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'decks_memory_subject_check') then
    alter table public.decks add constraint decks_memory_subject_check
      check (card_system <> 'memory' or subject_id is not null);
  end if;
end
$$;

create index if not exists decks_owner_system_subject_idx
  on public.decks (owner_id, card_system, subject_id)
  where deleted_at is null;

create table if not exists public.shared_memory_decks (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  subject_id text not null,
  title text not null check (char_length(title) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft', 'published', 'removed')),
  version integer not null default 1 check (version > 0),
  card_count integer not null default 0 check (card_count between 0 and 5000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.shared_memory_cards (
  id text primary key,
  shared_deck_id text not null references public.shared_memory_decks(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  origin_card_id text not null,
  front text not null check (char_length(front) between 1 and 2000),
  back text not null check (char_length(back) between 1 and 4000),
  explanation text not null default '' check (char_length(explanation) <= 4000),
  tags text[] not null default '{}',
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (shared_deck_id, origin_card_id)
);

create index if not exists shared_memory_decks_subject_published_idx
  on public.shared_memory_decks (subject_id, published_at desc)
  where status = 'published' and deleted_at is null;
create index if not exists shared_memory_cards_deck_position_idx
  on public.shared_memory_cards (shared_deck_id, position);

drop trigger if exists shared_memory_decks_set_updated_at on public.shared_memory_decks;
create trigger shared_memory_decks_set_updated_at
before update on public.shared_memory_decks
for each row execute function public.set_updated_at();

alter table public.shared_memory_decks enable row level security;
alter table public.shared_memory_cards enable row level security;

drop policy if exists "shared_memory_decks_public_read" on public.shared_memory_decks;
create policy "shared_memory_decks_public_read"
on public.shared_memory_decks for select to anon, authenticated
using (status = 'published' and deleted_at is null);

drop policy if exists "shared_memory_decks_owner_read" on public.shared_memory_decks;
create policy "shared_memory_decks_owner_read"
on public.shared_memory_decks for select to authenticated
using (auth.uid() = owner_id);

drop policy if exists "shared_memory_decks_owner_insert" on public.shared_memory_decks;
create policy "shared_memory_decks_owner_insert"
on public.shared_memory_decks for insert to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "shared_memory_decks_owner_update" on public.shared_memory_decks;
create policy "shared_memory_decks_owner_update"
on public.shared_memory_decks for update to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "shared_memory_decks_owner_delete" on public.shared_memory_decks;
create policy "shared_memory_decks_owner_delete"
on public.shared_memory_decks for delete to authenticated
using (auth.uid() = owner_id);

drop policy if exists "shared_memory_cards_public_read" on public.shared_memory_cards;
create policy "shared_memory_cards_public_read"
on public.shared_memory_cards for select to anon, authenticated
using (exists (
  select 1 from public.shared_memory_decks deck
  where deck.id = shared_deck_id
    and deck.status = 'published'
    and deck.deleted_at is null
));

drop policy if exists "shared_memory_cards_owner_read" on public.shared_memory_cards;
create policy "shared_memory_cards_owner_read"
on public.shared_memory_cards for select to authenticated
using (auth.uid() = owner_id);

drop policy if exists "shared_memory_cards_owner_insert" on public.shared_memory_cards;
create policy "shared_memory_cards_owner_insert"
on public.shared_memory_cards for insert to authenticated
with check (
  auth.uid() = owner_id
  and exists (
    select 1 from public.shared_memory_decks deck
    where deck.id = shared_deck_id and deck.owner_id = auth.uid()
  )
);

drop policy if exists "shared_memory_cards_owner_update" on public.shared_memory_cards;
create policy "shared_memory_cards_owner_update"
on public.shared_memory_cards for update to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "shared_memory_cards_owner_delete" on public.shared_memory_cards;
create policy "shared_memory_cards_owner_delete"
on public.shared_memory_cards for delete to authenticated
using (auth.uid() = owner_id);
