create extension if not exists pgcrypto;

-- Current AHLink Express OS persistence.
-- The application keeps the full operating state in JSONB first, so we can move
-- safely to Neon/PostgreSQL without rewriting the workflow routes. The normalized
-- tables below remain the production target as the platform matures.
create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table offices (
  office_id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('BUE','LIM','DLA')),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table bookings (
  booking_id uuid primary key default gen_random_uuid(),
  booking_code text not null unique,
  sender_name text not null,
  sender_phone text not null,
  recipient_name text not null,
  recipient_phone text not null,
  origin_code text not null references offices(code),
  destination_code text not null references offices(code),
  receiving_method text not null check (receiving_method in ('DROPOFF','PICKUP')),
  pickup_address text,
  service text not null check (service in ('STANDARD','EXPRESS')),
  item_description text not null,
  approximate_weight_kg numeric(10,2) not null,
  declared_value_cfa integer not null default 0,
  estimated_price_cfa integer not null,
  status text not null check (status in ('AWAITING_DROPOFF','PICKUP_REQUESTED','ACCEPTED','CANCELLED','EXPIRED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin_code <> destination_code)
);

create table packages (
  package_id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings(booking_id),
  tracking_number text not null unique,
  verified_weight_kg numeric(10,2) not null,
  length_cm numeric(10,2) not null,
  width_cm numeric(10,2) not null,
  height_cm numeric(10,2) not null,
  final_price_cfa integer not null,
  condition text not null,
  seal_number text,
  payment_arrangement text not null,
  payment_status text not null,
  status text not null,
  current_office_code text references offices(code),
  storage_location text,
  accepted_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table package_events (
  event_id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(package_id),
  event_type text not null,
  previous_status text,
  new_status text not null,
  actor_id uuid,
  actor_name_snapshot text not null,
  office_code text references offices(code),
  trip_id uuid,
  note text,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table vehicles (
  vehicle_id uuid primary key default gen_random_uuid(),
  registration_number text not null unique,
  vehicle_type text not null,
  driver_name text,
  driver_phone text,
  capacity_packages integer not null default 0,
  capacity_kg numeric(10,2) not null default 0,
  status text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table trips (
  trip_id uuid primary key default gen_random_uuid(),
  trip_code text not null unique,
  trip_date date not null,
  route_name text not null,
  origin_code text not null references offices(code),
  destination_code text not null references offices(code),
  vehicle_id uuid references vehicles(vehicle_id),
  driver_name text,
  driver_phone text,
  scheduled_departure timestamptz,
  status text not null,
  departed_at timestamptz,
  arrived_at timestamptz,
  received_by text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin_code <> destination_code)
);

create table trip_manifest_items (
  manifest_item_id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(trip_id),
  package_id uuid not null references packages(package_id),
  tracking_number text not null,
  sender_name text,
  recipient_name text,
  package_description text,
  weight_kg numeric(10,2),
  status text not null,
  loaded_at timestamptz,
  loaded_by text,
  offloaded_at timestamptz,
  offloaded_by text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id, package_id)
);

create table package_collections (
  collection_id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(package_id),
  tracking_number text not null,
  receiver_name text not null,
  receiver_phone text not null,
  id_note text,
  signature_placeholder text,
  photo_placeholder text,
  released_by text not null,
  collected_at timestamptz not null default now()
);

create table package_exceptions (
  exception_id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(package_id),
  exception_type text not null,
  actor text not null,
  office_code text references offices(code),
  note text not null,
  created_at timestamptz not null default now()
);

create table package_payments (
  payment_id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(package_id),
  tracking_number text not null,
  amount_cfa integer not null,
  mode text not null,
  payer_type text not null,
  received_by text not null,
  note text,
  paid_at timestamptz not null default now()
);

create index idx_bookings_status_created on bookings(status, created_at desc);
create index idx_packages_status_office on packages(status, current_office_code);
create index idx_package_events_package_time on package_events(package_id, occurred_at);
create index idx_trips_status_date on trips(status, trip_date desc);
create index idx_manifest_trip_status on trip_manifest_items(trip_id, status);
create index idx_exceptions_package_time on package_exceptions(package_id, created_at desc);
create index idx_payments_paid_at on package_payments(paid_at desc);

insert into offices (code, name) values ('BUE','Buea'),('LIM','Limbe'),('DLA','Douala')
on conflict (code) do nothing;
