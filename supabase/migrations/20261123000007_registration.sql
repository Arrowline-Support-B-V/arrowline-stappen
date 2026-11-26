-- Alleen een aanmeldformulier: naam, werkmail en team. Geen login nodig.
create table registrations (
  id         bigserial primary key,
  name       text not null,
  email      text not null unique,
  team_id    int  not null references teams(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table registrations enable row level security;   -- geen policies: niemand kan de lijst lezen of aanpassen, alleen via register()

create function register(p_name text, p_email text, p_team int) returns text
language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); em text := lower(trim(coalesce(p_email, ''))); existed boolean;
begin
  if today_nl() >= (select start_date from challenge) then raise exception 'Aanmelden is gesloten: de challenge is gestart'; end if;
  if length(nm) < 2 or length(nm) > 60 then raise exception 'Vul je naam in (2 tot 60 tekens)'; end if;
  if em !~ '^[^@[:space:]]+@arrowline\.nl$' then raise exception 'Gebruik je e-mailadres van Arrowline (eindigt op @arrowline.nl)'; end if;
  if not exists (select 1 from teams where id = p_team) then raise exception 'Kies een team'; end if;
  select exists (select 1 from registrations where email = em) into existed;
  insert into registrations (name, email, team_id) values (nm, em, p_team)
  on conflict (email) do update set name = excluded.name, team_id = excluded.team_id, updated_at = now();
  return case when existed then 'bijgewerkt' else 'aangemeld' end;
end $$;

-- Teams voor het formulier, met het aantal aanmeldingen (geen namen of e-mailadressen)
create function registration_teams() returns table (id int, name text, charity text, members int)
language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.charity, (select count(*)::int from registrations r where r.team_id = t.id) from teams t order by t.id
$$;

revoke all on function register(text, text, int), registration_teams() from public;
grant execute on function register(text, text, int), registration_teams() to anon, authenticated;
