create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade unique,
  name text not null check (char_length(name) <= 60),
  background text not null default '',
  domain text not null check (char_length(domain) <= 100),
  level text not null check (level in ('Beginner', 'Basic', 'Intermediate', 'Advanced')),
  goal text not null check (char_length(goal) <= 500),
  style text not null default 'Mixed',
  hours numeric not null check (hours >= 0.5 and hours <= 12),
  weeks integer not null check (weeks between 1 and 24),
  start_date date not null default current_date,
  study_days integer[] not null check (cardinality(study_days) between 1 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roadmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  summary text not null default '',
  content jsonb not null,
  progress jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists roadmaps_user_created_idx on public.roadmaps (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.roadmaps enable row level security;
create policy "Users manage their own profile" on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own roadmaps" on public.roadmaps for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
