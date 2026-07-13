create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.decks (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.cards (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('basic', 'multiple-choice', 'term')),
  deck_id text references public.decks(id) on delete set null,
  front text not null,
  back text not null default '',
  choices jsonb not null default '[]'::jsonb,
  correct_choice_index integer,
  explanation text not null default '',
  field text not null default '',
  source text not null default '',
  tags text[] not null default '{}',
  image text,
  image_alt text not null default '',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.review_events (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  device_id uuid not null,
  rating smallint not null check (rating between 1 and 4),
  reviewed_at timestamptz not null,
  duration_ms integer,
  server_created_at timestamptz not null default now()
);

create table if not exists public.settings (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

create index if not exists cards_owner_updated_idx on public.cards(owner_id, updated_at);
create index if not exists review_events_owner_reviewed_idx on public.review_events(owner_id, reviewed_at);

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at before update on public.cards for each row execute function public.set_updated_at();
drop trigger if exists decks_set_updated_at on public.decks;
create trigger decks_set_updated_at before update on public.decks for each row execute function public.set_updated_at();

alter table public.cards enable row level security;
alter table public.decks enable row level security;
alter table public.review_events enable row level security;
alter table public.settings enable row level security;

create policy "cards_owner_all" on public.cards for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "decks_owner_all" on public.decks for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "reviews_owner_all" on public.review_events for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "settings_owner_all" on public.settings for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into storage.buckets (id, name, public)
values ('card-media', 'card-media', false)
on conflict (id) do update set public = false;

create policy "card_media_select" on storage.objects for select to authenticated using (bucket_id = 'card-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card_media_insert" on storage.objects for insert to authenticated with check (bucket_id = 'card-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card_media_update" on storage.objects for update to authenticated using (bucket_id = 'card-media' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'card-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "card_media_delete" on storage.objects for delete to authenticated using (bucket_id = 'card-media' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from storage.objects where bucket_id = 'card-media' and (storage.foldername(name))[1] = auth.uid()::text;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
