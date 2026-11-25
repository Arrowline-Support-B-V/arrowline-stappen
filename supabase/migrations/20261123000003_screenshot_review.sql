-- Automatische screenshot-controle: wat het systeem las en besliste, plus duplicaatdetectie.
create table screenshot_reads (
  id             bigserial primary key,
  participant_id uuid not null references participants(id) on delete cascade,
  day            date not null,
  attempt        int  not null default 1,
  sha256         text not null,                 -- exacte kopie
  model_read     jsonb,                         -- ruwe, gevalideerde uitlezing
  auth_signals   jsonb,                         -- echtheidssignalen uit de bestandsgegevens (forensics.ts)
  verdict        text not null check (verdict in ('approve','review','retry')),
  steps          int,
  reason         text,
  created_at     timestamptz not null default now()
);
create index on screenshot_reads (sha256);
create index on screenshot_reads (participant_id, day);

-- Hergebruik herkennen. Bewust GEEN beeldhash: gemeten (zie README) dat een screenshot van dezelfde app met een ander getal
-- niet te scheiden is van een kopie. Wel betrouwbaar:
--  'exact'        = exact hetzelfde bestand eerder ingediend (door iemand anders, of voor een andere dag)
--  'same_reading' = een ander persoon had op dezelfde dag precies hetzelfde dagtotaal uit dezelfde app (kan toeval zijn)
create function find_duplicate(p_participant uuid, p_day date, p_sha text, p_steps int, p_app text)
returns text language sql stable as $$
  select case
    when bool_or(sha256 = p_sha) then 'exact'
    when bool_or(participant_id <> p_participant and day = p_day and steps = p_steps and coalesce(model_read->>'app_name','') = coalesce(p_app,'') and verdict <> 'retry') then 'same_reading'
  end
  from screenshot_reads
  where not (participant_id = p_participant and day = p_day)
$$;

-- Hoeveel is automatisch afgehandeld? (voor het beheerscherm)
create function review_stats(p_day date)
returns table (approved int, review int, retry int) language sql stable as $$
  select count(*) filter (where verdict = 'approve')::int, count(*) filter (where verdict = 'review')::int, count(*) filter (where verdict = 'retry')::int
  from (select distinct on (participant_id, day) * from screenshot_reads where day = p_day order by participant_id, day, created_at desc) x
$$;
