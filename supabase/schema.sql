-- ============================================================
--  Bali Villas CRM — схема общей базы для Supabase
--  Выполните целиком в Supabase → SQL Editor → New query → Run
-- ============================================================

-- ---------- Таблицы ----------
-- Записи хранятся как JSON: приложение и база не расходятся при доработках,
-- а объём данных (виллы, брони, клиенты) для Postgres ничтожный.
create table if not exists public.villas (
  id          text primary key,
  doc         jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) default auth.uid()
);

create table if not exists public.clients (
  id          text primary key,
  doc         jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) default auth.uid()
);

create table if not exists public.bookings (
  id          text primary key,
  doc         jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) default auth.uid()
);

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz not null default now()
);

-- Метаданные файлов; сами файлы лежат в Storage
create table if not exists public.files (
  id          text primary key,
  owner_type  text not null,          -- villa | client | booking
  owner_id    text not null,
  kind        text not null,          -- photo | doc
  name        text,
  mime        text,
  size        bigint,
  caption     text default '',
  w           int,
  h           int,
  sort        double precision,
  path        text not null,          -- путь оригинала в Storage
  thumb_path  text,                   -- путь превью
  optimized   boolean default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) default auth.uid()
);

create index if not exists files_owner_idx on public.files (owner_type, owner_id, kind, sort);
create index if not exists bookings_villa_idx on public.bookings ((doc->>'villaId'));
create index if not exists bookings_from_idx on public.bookings ((doc->>'dateFrom'));

-- ---------- Доступ ----------
-- Полный доступ для всех, кто вошёл в систему. Анонимные запросы отклоняются.
-- Регистрацию новых пользователей отключите в панели:
--   Authentication → Sign In / Providers → Email → Allow new users to sign up: OFF
-- Сотрудников заводите вручную: Authentication → Users → Add user.
alter table public.villas       enable row level security;
alter table public.clients      enable row level security;
alter table public.bookings     enable row level security;
alter table public.app_settings enable row level security;
alter table public.files        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['villas','clients','bookings','app_settings','files'] loop
    execute format('drop policy if exists "team full access" on public.%I', t);
    execute format(
      'create policy "team full access" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Отметка времени последнего изменения
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['villas','clients','bookings','app_settings'] loop
    execute format('drop trigger if exists touch_%I on public.%I', t, t);
    execute format(
      'create trigger touch_%I before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------- Хранилище файлов ----------
-- Приватный бакет: фото и паспорта доступны только по временной ссылке
-- и только вошедшим в систему.
insert into storage.buckets (id, name, public)
values ('villa-files', 'villa-files', false)
on conflict (id) do nothing;

drop policy if exists "team read files"   on storage.objects;
drop policy if exists "team upload files" on storage.objects;
drop policy if exists "team update files" on storage.objects;
drop policy if exists "team delete files" on storage.objects;

create policy "team read files" on storage.objects
  for select to authenticated using (bucket_id = 'villa-files');
create policy "team upload files" on storage.objects
  for insert to authenticated with check (bucket_id = 'villa-files');
create policy "team update files" on storage.objects
  for update to authenticated using (bucket_id = 'villa-files');
create policy "team delete files" on storage.objects
  for delete to authenticated using (bucket_id = 'villa-files');

-- ---------- Живое обновление у второго сотрудника ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.villas;
alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.files;
