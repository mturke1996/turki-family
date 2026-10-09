-- Shared guest book for Afrah Turki. No login or changes to existing security settings.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.normalize_guest_name(p_value text)
returns text language sql immutable
as $$
  select regexp_replace(
    lower(translate(btrim(coalesce(p_value, '')), 'أإآٱىـ', 'ااااي')),
    '[[:space:][:punct:]ًٌٍَُِّْٰ]+', '', 'g'
  );
$$;

create or replace function public.normalize_guest_phone(p_value text)
returns text language plpgsql immutable
as $$
declare v_digits text;
begin
  v_digits := regexp_replace(
    translate(coalesce(p_value, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[^0-9]', '', 'g'
  );
  if left(v_digits, 5) = '00218' then
    v_digits := substring(v_digits from 6);
  elsif left(v_digits, 3) = '218' and length(v_digits) = 12 then
    v_digits := substring(v_digits from 4);
  end if;
  if length(v_digits) = 10 and left(v_digits, 1) = '0' then
    v_digits := substring(v_digits from 2);
  end if;
  return v_digits;
end;
$$;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 100),
  access_hash text not null unique,
  realtime_topic text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  last_name text not null default '' check (length(btrim(last_name)) <= 100),
  full_name_key text generated always as (public.normalize_guest_name(first_name || ' ' || last_name)) stored,
  phone text not null default '',
  phone_key text generated always as (public.normalize_guest_phone(phone)) stored,
  family_count integer not null default 1 check (family_count between 1 and 500),
  invited_by text not null default '' check (invited_by in ('', 'شهاب', 'هاشم', 'صلاح', 'إسماعيل', 'محمد')),
  status text not null default 'not_contacted' check (status in ('not_contacted', 'invited', 'no_answer')),
  latest_note text not null default '' check (length(latest_note) <= 1200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, id)
);

create unique index if not exists guests_unique_name_per_family
  on public.guests (family_id, full_name_key);
create unique index if not exists guests_unique_phone_per_family
  on public.guests (family_id, phone_key) where phone_key <> '';

create table if not exists public.guest_activities (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  guest_id uuid not null,
  outcome text not null check (outcome in ('added', 'invited', 'no_answer', 'note')),
  note text not null default '' check (length(note) <= 1200),
  actor_name text not null default 'العائلة',
  created_at timestamptz not null default now(),
  foreign key (family_id, guest_id) references public.guests(family_id, id) on delete cascade
);

create or replace function public.create_family(p_name text)
returns table (id uuid, name text, access_code text, realtime_topic text)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_code text := lower(encode(extensions.gen_random_bytes(32), 'hex'));
  v_topic text := lower(encode(extensions.gen_random_bytes(24), 'hex'));
  v_name text := btrim(coalesce(p_name, ''));
begin
  if length(v_name) not between 2 and 100 then raise exception 'INVALID_FAMILY_NAME'; end if;
  insert into public.families (id, name, access_hash, realtime_topic)
    values (v_id, v_name, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_topic);
  return query select v_id, v_name, v_code, 'family-' || v_topic;
end;
$$;

create or replace function public.get_family(p_access_code text)
returns table (id uuid, name text, realtime_topic text)
language sql security definer
set search_path = public, extensions
as $$
  select f.id, f.name, 'family-' || f.realtime_topic
  from public.families f
  where f.access_hash = encode(extensions.digest(lower(btrim(coalesce(p_access_code, ''))), 'sha256'), 'hex')
  limit 1;
$$;

-- One shared book for this family; phones open it without an account or setup.
create or replace function public.open_turki_book()
returns table (id uuid, name text, realtime_topic text)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_hash text := encode(extensions.digest('turki-family-shared-book-2026', 'sha256'), 'hex');
begin
  perform pg_advisory_xact_lock(hashtextextended('turki-family-shared-book-2026', 0));
  insert into public.families (name, access_hash, realtime_topic)
    values ('أفراح عائلة التركي', v_hash, encode(extensions.gen_random_bytes(24), 'hex'))
    on conflict (access_hash) do nothing;
  return query select f.id, f.name, 'family-' || f.realtime_topic
    from public.families f where f.access_hash = v_hash;
end;
$$;

create or replace function public.list_guests(p_access_code text)
returns setof public.guests
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_family_id uuid;
begin
  select f.id into v_family_id from public.families f
    where f.access_hash = encode(extensions.digest(lower(btrim(coalesce(p_access_code, ''))), 'sha256'), 'hex');
  if v_family_id is null then raise exception 'INVALID_ACCESS_CODE'; end if;
  return query select g.* from public.guests g where g.family_id = v_family_id order by g.updated_at desc;
end;
$$;

create or replace function public.list_guest_activities(p_access_code text)
returns setof public.guest_activities
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_family_id uuid;
begin
  select f.id into v_family_id from public.families f
    where f.access_hash = encode(extensions.digest(lower(btrim(coalesce(p_access_code, ''))), 'sha256'), 'hex');
  if v_family_id is null then raise exception 'INVALID_ACCESS_CODE'; end if;
  return query select a.* from public.guest_activities a where a.family_id = v_family_id order by a.created_at desc;
end;
$$;

-- Return one JSON snapshot so the Data API row limit never truncates the guest totals.
create or replace function public.get_turki_snapshot(p_access_code text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_family_id uuid;
begin
  select f.id into v_family_id from public.families f
    where f.access_hash = encode(extensions.digest(lower(btrim(coalesce(p_access_code, ''))), 'sha256'), 'hex');
  if v_family_id is null then raise exception 'INVALID_ACCESS_CODE'; end if;
  return jsonb_build_object(
    'guests', coalesce((select jsonb_agg(g order by g.updated_at desc, g.id) from public.guests g where g.family_id = v_family_id), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(a order by a.created_at desc, a.id) from public.guest_activities a where a.family_id = v_family_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_guest(
  p_access_code text,
  p_guest_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_family_count integer,
  p_invited_by text
)
returns table (guest_id uuid, was_duplicate boolean, duplicate_by text)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_family_id uuid;
  v_name_key text := public.normalize_guest_name(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''));
  v_phone_key text := public.normalize_guest_phone(p_phone);
  v_duplicate_id uuid;
  v_duplicate_reason text;
  v_guest_id uuid;
  v_inviter text := btrim(coalesce(p_invited_by, ''));
begin
  select f.id into v_family_id from public.families f
    where f.access_hash = encode(extensions.digest(lower(btrim(coalesce(p_access_code, ''))), 'sha256'), 'hex');
  if v_family_id is null then raise exception 'INVALID_ACCESS_CODE'; end if;
  if length(btrim(coalesce(p_first_name, ''))) not between 1 and 80 or v_name_key = '' then raise exception 'INVALID_GUEST_NAME'; end if;
  if length(btrim(coalesce(p_last_name, ''))) > 100 then raise exception 'INVALID_GUEST_NAME'; end if;
  if btrim(coalesce(p_phone, '')) <> '' and length(v_phone_key) < 6 then raise exception 'INVALID_PHONE'; end if;
  if p_family_count not between 1 and 500 then raise exception 'INVALID_FAMILY_COUNT'; end if;
  if v_inviter not in ('', 'شهاب', 'هاشم', 'صلاح', 'إسماعيل', 'محمد') then raise exception 'INVALID_INVITER'; end if;

  -- Serialize each family's writes to prevent two devices from adding one person at once.
  perform pg_advisory_xact_lock(hashtextextended(v_family_id::text, 0));
  select g.id,
    case when v_phone_key <> '' and g.phone_key = v_phone_key then 'phone' else 'name' end
    into v_duplicate_id, v_duplicate_reason
    from public.guests g
    where g.family_id = v_family_id and g.id is distinct from p_guest_id
      and (g.full_name_key = v_name_key or (v_phone_key <> '' and g.phone_key = v_phone_key))
    order by case when v_phone_key <> '' and g.phone_key = v_phone_key then 0 else 1 end
    limit 1;
  if v_duplicate_id is not null then
    if p_guest_id is not null then raise exception 'GUEST_DUPLICATE'; end if;
    return query select v_duplicate_id, true, v_duplicate_reason;
    return;
  end if;

  if p_guest_id is null then
    insert into public.guests (family_id, first_name, last_name, phone, family_count, invited_by)
      values (v_family_id, btrim(p_first_name), btrim(coalesce(p_last_name, '')), btrim(coalesce(p_phone, '')), p_family_count, v_inviter)
      returning id into v_guest_id;
    insert into public.guest_activities (family_id, guest_id, outcome, note, actor_name)
      values (v_family_id, v_guest_id, 'added', 'أُضيف إلى دفتر العائلة', 'العائلة');
  else
    update public.guests g set first_name = btrim(p_first_name), last_name = btrim(coalesce(p_last_name, '')),
      phone = btrim(coalesce(p_phone, '')), family_count = p_family_count, invited_by = v_inviter, updated_at = now()
      where g.id = p_guest_id and g.family_id = v_family_id returning g.id into v_guest_id;
    if v_guest_id is null then raise exception 'GUEST_NOT_FOUND'; end if;
  end if;
  return query select v_guest_id, false, null::text;
end;
$$;

create or replace function public.record_guest_activity(
  p_access_code text,
  p_guest_id uuid,
  p_outcome text,
  p_note text
)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_family_id uuid;
  v_activity_id uuid;
begin
  select f.id into v_family_id from public.families f
    where f.access_hash = encode(extensions.digest(lower(btrim(coalesce(p_access_code, ''))), 'sha256'), 'hex');
  if v_family_id is null then raise exception 'INVALID_ACCESS_CODE'; end if;
  if p_outcome not in ('invited', 'no_answer', 'note') then raise exception 'INVALID_OUTCOME'; end if;
  if length(coalesce(p_note, '')) > 1200 then raise exception 'NOTE_TOO_LONG'; end if;
  if not exists (select 1 from public.guests where id = p_guest_id and family_id = v_family_id) then raise exception 'GUEST_NOT_FOUND'; end if;

  insert into public.guest_activities (family_id, guest_id, outcome, note, actor_name)
    values (v_family_id, p_guest_id, p_outcome, btrim(coalesce(p_note, '')), 'العائلة')
    returning id into v_activity_id;
  update public.guests set latest_note = case when btrim(coalesce(p_note, '')) = '' then latest_note else btrim(p_note) end, updated_at = now(),
    status = case when p_outcome = 'note' then status else p_outcome end
    where id = p_guest_id and family_id = v_family_id;
  return v_activity_id;
end;
$$;

-- Broadcast a refresh event after a change; the event contains no guest details.
create or replace function public.broadcast_family_change()
returns trigger language plpgsql security definer
set search_path = public, extensions, realtime
as $$
declare
  v_family_id uuid := coalesce(new.family_id, old.family_id);
  v_topic text;
begin
  select 'family-' || f.realtime_topic into v_topic from public.families f where f.id = v_family_id;
  if v_topic is not null then
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'family-change', v_topic, false);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guest_updates_broadcast on public.guests;
create trigger guest_updates_broadcast after insert or update or delete on public.guests
  for each row execute function public.broadcast_family_change();
drop trigger if exists guest_activity_broadcast on public.guest_activities;
create trigger guest_activity_broadcast after insert or update or delete on public.guest_activities
  for each row execute function public.broadcast_family_change();
