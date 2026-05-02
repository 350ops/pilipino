create extension if not exists "uuid-ossp";
create extension if not exists postgis;
create extension if not exists pg_trgm;

do $$ begin
  create type property_type as enum (
    'house_and_lot','condo','lot_only','townhouse','apartment',
    'commercial','industrial','agricultural','warehouse','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_mode as enum ('negotiated','sealed_bidding','auction');
exception when duplicate_object then null; end $$;

do $$ begin
  create type occupancy_status as enum ('vacant','occupied','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type title_status as enum (
    'clean','with_levy','with_court_case','unconsolidated','annotated','unknown'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_tier as enum ('green','yellow','red','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type listing_status as enum ('active','sold','withdrawn','pending','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type save_status as enum (
    'watching','shortlist','inspecting','offered','won','rejected','archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type scrape_run_status as enum ('running','ok','failed','partial');
exception when duplicate_object then null; end $$;

create table if not exists public.listings (
  id uuid primary key default uuid_generate_v4(),
  source text not null,
  source_listing_id text not null,
  source_url text,
  title text not null,
  property_type property_type not null default 'other',
  address_raw text not null,
  barangay text,
  city text,
  province text,
  region text,
  location geography(Point, 4326),
  lot_area_sqm numeric(12,2),
  floor_area_sqm numeric(12,2),
  bedrooms int,
  bathrooms int,
  price_php numeric(15,2) not null check (price_php >= 0),
  appraised_value_php numeric(15,2) check (appraised_value_php >= 0),
  sale_mode sale_mode not null default 'negotiated',
  bidding_starts_at timestamptz,
  bidding_ends_at timestamptz,
  occupancy occupancy_status not null default 'unknown',
  title_state title_status not null default 'unknown',
  risk_tier risk_tier not null default 'unknown',
  redemption_until date,
  status listing_status not null default 'active',
  raw_metadata jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listings_source_listing_uk unique (source, source_listing_id)
);

alter table public.listings
  add column if not exists price_per_sqm numeric(15,2)
    generated always as (
      case
        when coalesce(floor_area_sqm, lot_area_sqm) > 0
          then price_php / coalesce(floor_area_sqm, lot_area_sqm)
        else null
      end
    ) stored,
  add column if not exists discount_pct numeric(6,2)
    generated always as (
      case
        when appraised_value_php is not null and appraised_value_php > 0
          then 100.0 * (appraised_value_php - price_php) / appraised_value_php
        else null
      end
    ) stored;

create table if not exists public.listing_photos (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  url text not null,
  ordering int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.listing_price_history (
  id bigserial primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  price_php numeric(15,2) not null,
  observed_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_listings_updated_at on public.listings;
create trigger trg_listings_updated_at before update on public.listings
  for each row execute function public.set_updated_at();

create or replace function public.record_price_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.price_php <> old.price_php then
    insert into public.listing_price_history (listing_id, price_php, observed_at)
    values (new.id, new.price_php, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_listings_price_history on public.listings;
create trigger trg_listings_price_history after insert or update of price_php
  on public.listings for each row execute function public.record_price_change();

create index if not exists idx_listings_status_active
  on public.listings (status) where status = 'active';
create index if not exists idx_listings_city_price
  on public.listings (city, price_php) where status = 'active';
create index if not exists idx_listings_property_type
  on public.listings (property_type) where status = 'active';
create index if not exists idx_listings_sale_mode_deadline
  on public.listings (sale_mode, bidding_ends_at) where status = 'active';
create index if not exists idx_listings_risk_tier
  on public.listings (risk_tier) where status = 'active';
create index if not exists idx_listings_location_gist
  on public.listings using gist (location) where status = 'active';
create index if not exists idx_listings_address_trgm
  on public.listings using gin (address_raw gin_trgm_ops);
create index if not exists idx_listings_discount
  on public.listings (discount_pct desc nulls last) where status = 'active';
create index if not exists idx_photos_listing
  on public.listing_photos (listing_id, ordering);
create index if not exists idx_price_history_listing_observed
  on public.listing_price_history (listing_id, observed_at desc);

create table if not exists public.scrape_runs (
  id uuid primary key default uuid_generate_v4(),
  source text not null,
  status scrape_run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  count int not null default 0,
  errors int not null default 0,
  notes text
);

create index if not exists idx_scrape_runs_source_started
  on public.scrape_runs (source, started_at desc);

create table if not exists public.scraping_staging (
  run_id uuid not null references public.scrape_runs(id) on delete cascade,
  source text not null,
  source_listing_id text not null,
  payload jsonb not null,
  parse_warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (run_id, source, source_listing_id)
);

create index if not exists idx_staging_source
  on public.scraping_staging (source);

create table if not exists public.listing_review_queue (
  id uuid primary key default uuid_generate_v4(),
  source text not null,
  source_listing_id text not null,
  payload jsonb not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

create table if not exists public.geocoding_queue (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  address_raw text not null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create or replace function public.enqueue_geocoding()
returns trigger language plpgsql as $$
begin
  if new.location is null and new.address_raw is not null then
    insert into public.geocoding_queue (listing_id, address_raw)
    values (new.id, new.address_raw)
    on conflict (listing_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_listings_enqueue_geocoding on public.listings;
create trigger trg_listings_enqueue_geocoding after insert on public.listings
  for each row execute function public.enqueue_geocoding();

create or replace function public.promote_listings(p_source text, p_run_id uuid)
returns table (inserted int, updated int, retired int, queued int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
  v_updated int := 0;
  v_retired int := 0;
  v_queued int := 0;
begin
  with src as (
    select
      s.source,
      s.source_listing_id,
      nullif(s.payload->>'source_url','') as source_url,
      s.payload->>'title' as title,
      coalesce(nullif(s.payload->>'property_type','')::property_type, 'other') as property_type,
      s.payload->>'address_raw' as address_raw,
      nullif(s.payload->>'barangay','') as barangay,
      nullif(s.payload->>'city','') as city,
      nullif(s.payload->>'province','') as province,
      nullif(s.payload->>'region','') as region,
      nullif(s.payload->>'lot_area_sqm','')::numeric as lot_area_sqm,
      nullif(s.payload->>'floor_area_sqm','')::numeric as floor_area_sqm,
      nullif(s.payload->>'bedrooms','')::int as bedrooms,
      nullif(s.payload->>'bathrooms','')::int as bathrooms,
      (s.payload->>'price_php')::numeric as price_php,
      nullif(s.payload->>'appraised_value_php','')::numeric as appraised_value_php,
      coalesce(nullif(s.payload->>'sale_mode','')::sale_mode, 'negotiated') as sale_mode,
      nullif(s.payload->>'bidding_starts_at','')::timestamptz as bidding_starts_at,
      nullif(s.payload->>'bidding_ends_at','')::timestamptz as bidding_ends_at,
      coalesce(nullif(s.payload->>'occupancy_status','')::occupancy_status, 'unknown') as occupancy,
      coalesce(nullif(s.payload->>'title_status','')::title_status, 'unknown') as title_state,
      coalesce(nullif(s.payload->>'risk_tier','')::risk_tier, 'unknown') as risk_tier,
      nullif(s.payload->>'redemption_until','')::date as redemption_until,
      coalesce(s.payload->'raw_metadata', '{}'::jsonb) as raw_metadata,
      coalesce(s.payload->'photos', '[]'::jsonb) as photos
    from public.scraping_staging s
    where s.source = p_source and s.run_id = p_run_id
  ),
  upserted as (
    insert into public.listings (
      source, source_listing_id, source_url, title, property_type,
      address_raw, barangay, city, province, region,
      lot_area_sqm, floor_area_sqm, bedrooms, bathrooms,
      price_php, appraised_value_php, sale_mode,
      bidding_starts_at, bidding_ends_at, occupancy, title_state,
      risk_tier, redemption_until, raw_metadata, last_verified_at, status
    )
    select
      source, source_listing_id, source_url, title, property_type,
      address_raw, barangay, city, province, region,
      lot_area_sqm, floor_area_sqm, bedrooms, bathrooms,
      price_php, appraised_value_php, sale_mode,
      bidding_starts_at, bidding_ends_at, occupancy, title_state,
      risk_tier, redemption_until, raw_metadata, now(), 'active'
    from src
    on conflict (source, source_listing_id) do update set
      source_url = excluded.source_url,
      title = excluded.title,
      property_type = excluded.property_type,
      address_raw = excluded.address_raw,
      barangay = excluded.barangay,
      city = excluded.city,
      province = excluded.province,
      region = excluded.region,
      lot_area_sqm = excluded.lot_area_sqm,
      floor_area_sqm = excluded.floor_area_sqm,
      bedrooms = excluded.bedrooms,
      bathrooms = excluded.bathrooms,
      price_php = excluded.price_php,
      appraised_value_php = excluded.appraised_value_php,
      sale_mode = excluded.sale_mode,
      bidding_starts_at = excluded.bidding_starts_at,
      bidding_ends_at = excluded.bidding_ends_at,
      occupancy = excluded.occupancy,
      title_state = excluded.title_state,
      risk_tier = excluded.risk_tier,
      redemption_until = excluded.redemption_until,
      raw_metadata = excluded.raw_metadata,
      last_verified_at = now(),
      status = 'active'
    returning id, source, source_listing_id, xmax = 0 as inserted
  ),
  photo_source as (
    select u.id as listing_id, photo.value as photo
    from upserted u
    join src s on s.source = u.source and s.source_listing_id = u.source_listing_id
    cross join lateral jsonb_array_elements(s.photos) as photo(value)
  ),
  deleted_photos as (
    delete from public.listing_photos lp
    using upserted u
    where lp.listing_id = u.id
  ),
  inserted_photos as (
    insert into public.listing_photos (listing_id, url, ordering)
    select
      listing_id,
      photo->>'url',
      coalesce((photo->>'ordering')::int, 0)
    from photo_source
    where nullif(photo->>'url','') is not null
    returning 1
  )
  select
    count(*) filter (where inserted),
    count(*) filter (where not inserted)
  into v_inserted, v_updated
  from upserted;

  update public.listings l
  set status = 'withdrawn', last_verified_at = now()
  where l.source = p_source
    and l.status = 'active'
    and not exists (
      select 1
      from public.scraping_staging s
      where s.run_id = p_run_id
        and s.source = p_source
        and s.source_listing_id = l.source_listing_id
    );
  get diagnostics v_retired = row_count;

  insert into public.geocoding_queue (listing_id, address_raw)
  select l.id, l.address_raw
  from public.listings l
  where l.source = p_source
    and l.location is null
    and l.status = 'active'
  on conflict (listing_id) do nothing;
  get diagnostics v_queued = row_count;

  inserted := v_inserted;
  updated := v_updated;
  retired := v_retired;
  queued := v_queued;
  return next;
end $$;

insert into storage.buckets (id, name, public)
values ('scrape-snapshots', 'scrape-snapshots', false)
on conflict (id) do nothing;
