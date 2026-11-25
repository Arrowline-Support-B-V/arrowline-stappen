-- Arrowline Stappenchallenge januari 2027 · datamodel + puntentelling
-- Alle scores worden HIER berekend (nooit in de app). De app levert alleen dagtotalen aan.

create table challenge (
  id            int primary key default 1 check (id = 1),           -- één rij
  start_date    date    not null default '2027-01-01',
  days          int     not null default 31,
  min_steps     int     not null default 10000,                      -- onder dit aantal: 0 punten
  team_bonus    numeric not null default 5,                          -- +5 als alle teamleden min_steps halen
  max_plausible int     not null default 60000,                      -- erboven: handmatig controleren
  backfill_days int     not null default 3,                          -- hoeveel dagen terug de app mag aanvullen
  tz            text    not null default 'Europe/Amsterdam'
);
insert into challenge default values;

create table teams (
  id      serial primary key,
  name    text not null,
  charity text
);

create table participants (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,                                           -- Supabase auth.users.id
  name         text not null,
  team_id      int references teams(id),
  source       text not null default 'screenshot'
               check (source in ('healthkit','health_connect','garmin','fitbit','withings','polar','screenshot')),
  created_at   timestamptz not null default now()
);

create table daily_steps (
  participant_id  uuid not null references participants(id) on delete cascade,
  day             date not null,
  steps           int  not null check (steps >= 0),
  source_kind     text not null,                                      -- healthkit | health_connect | garmin | fitbit | ... | screenshot | admin
  is_manual       boolean not null default false,                     -- door de deelnemer zelf ingevoerd in de gezondheidsapp
  status          text not null check (status in ('ok','pending','rejected')),
  reason          text,
  screenshot_path text,
  reviewed_by     uuid,
  synced_at       timestamptz not null default now(),
  primary key (participant_id, day)
);
create index on daily_steps (day, status);

-- ───────────── puntentelling (zie spelregels) ─────────────
create function points_for(steps int) returns int language sql immutable as $$
  select case when steps < 10000 then 0
              when steps < 12500 then 10
              when steps < 15000 then 12
              when steps < 17500 then 14
              when steps < 20000 then 16
              else 13 end                                              -- 20.000+ = 13 (minpunten)
$$;

create function today_nl() returns date language sql stable as $$
  select (now() at time zone (select tz from challenge))::date
$$;

-- Eén rij per deelnemer per afgeronde dag. Alleen status 'ok' levert punten op.
create function person_days(as_of date default today_nl())
returns table (participant_id uuid, team_id int, day date, steps int, status text, points int, qualifies boolean)
language sql stable as $$
  with c as (select * from challenge),
       d as (select g::date as day from c, generate_series(c.start_date, least(as_of - 1, c.start_date + c.days - 1), interval '1 day') g)
  select p.id, p.team_id, d.day,
         coalesce(s.steps, 0),
         coalesce(s.status, 'none'),
         case when s.status = 'ok' then points_for(s.steps) else 0 end,
         coalesce(s.status = 'ok' and s.steps >= (select min_steps from c), false)
  from participants p
  cross join d
  left join daily_steps s on s.participant_id = p.id and s.day = d.day
  where p.team_id is not null
$$;

-- Teamscore per dag = gemiddelde punten per teamlid (+ bonus als iedereen minimaal 10.000 had)
create function team_days(as_of date default today_nl())
returns table (team_id int, day date, members int, avg_points numeric, all_in boolean, day_score numeric)
language sql stable as $$
  with pd as (select * from person_days(as_of))
  select team_id, day, count(*)::int,
         sum(points)::numeric / count(*),
         bool_and(qualifies),
         sum(points)::numeric / count(*) + case when bool_and(qualifies) then (select team_bonus from challenge) else 0 end
  from pd group by team_id, day
$$;

create function team_scores(as_of date default today_nl())
returns table (rank int, team_id int, name text, charity text, members int, score numeric, avg_points numeric, bonus_days int)
language sql stable as $$
  with td as (select * from team_days(as_of)),
       agg as (select team_id, sum(day_score) score, avg(avg_points) avg_points, count(*) filter (where all_in)::int bonus_days, max(members) members from td group by team_id)
  select (rank() over (order by a.score desc, a.bonus_days desc))::int, t.id, t.name, t.charity, a.members, round(a.score, 4), round(a.avg_points, 4), a.bonus_days
  from agg a join teams t on t.id = a.team_id
  order by 1, t.name
$$;

create function person_scores(as_of date default today_nl())
returns table (rank int, participant_id uuid, name text, team_id int, points int, days_hit int, days_total int)
language sql stable as $$
  with pd as (select * from person_days(as_of)),
       agg as (select participant_id, sum(points)::int points, count(*) filter (where qualifies)::int days_hit, count(*)::int days_total from pd group by participant_id)
  select (rank() over (order by a.points desc, a.days_hit desc))::int, p.id, p.name, p.team_id, a.points, a.days_hit, a.days_total
  from agg a join participants p on p.id = a.participant_id
  order by 1, p.name
$$;
