create extension if not exists pg_trgm;

create table if not exists public.theaters (
  id text primary key,
  name text not null,
  location text not null,
  timezone text not null
);

create table if not exists public.users (
  id text primary key,
  name text not null,
  email text not null,
  role text not null check (role in ('admin', 'viewer'))
);

create table if not exists public.user_theaters (
  user_id text not null references public.users (id),
  theater_id text not null references public.theaters (id),
  primary key (user_id, theater_id)
);

create index if not exists user_theaters_theater_id_idx
  on public.user_theaters (theater_id);

create table if not exists public.auditoriums (
  id text primary key,
  theater_id text not null references public.theaters (id),
  name text not null
);

create unique index if not exists auditoriums_theater_name_uidx
  on public.auditoriums (theater_id, name);

create unique index if not exists auditoriums_id_theater_uidx
  on public.auditoriums (id, theater_id);

create table if not exists public.showtimes (
  id text primary key,
  theater_id text not null references public.theaters (id),
  auditorium_id text not null references public.auditoriums (id),
  movie_title text not null,
  canonical_title text not null,
  movie_status text not null check (
    movie_status in ('approved', 'draft', 'flagged', 'needs-review')
  ),
  start_time timestamptz not null,
  end_time timestamptz not null,
  language text not null,
  format text not null,
  rating text not null,
  last_updated timestamptz not null,
  status text not null check (status in ('active', 'inactive', 'archived')),
  foreign key (auditorium_id, theater_id)
    references public.auditoriums (id, theater_id)
);

create unique index if not exists showtimes_live_movie_start_uidx
  on public.showtimes (theater_id, canonical_title, start_time)
  where status <> 'archived';

create index if not exists showtimes_theater_start_idx
  on public.showtimes (theater_id, start_time);

create index if not exists showtimes_theater_status_idx
  on public.showtimes (theater_id, status);

create index if not exists showtimes_movie_title_trgm_idx
  on public.showtimes using gin (movie_title gin_trgm_ops);
