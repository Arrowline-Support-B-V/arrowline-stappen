-- Aanmelden ook voor klanten en externen: type, bedrijf en toestemming (AVG).
alter table registrations
  add column kind text not null default 'collega' check (kind in ('collega', 'klant', 'extern')),
  add column company text,
  add column consent_at timestamptz;

drop function register(text, text, int);
create function register(p_name text, p_email text, p_team int, p_kind text, p_company text, p_consent boolean) returns text
language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); em text := lower(trim(coalesce(p_email, ''))); co text := nullif(trim(coalesce(p_company, '')), ''); existed boolean;
begin
  if today_nl() >= (select start_date from challenge) then raise exception 'Aanmelden is gesloten: de challenge is gestart'; end if;
  if p_kind is null or p_kind not in ('collega', 'klant', 'extern') then raise exception 'Kies of je collega, klant of extern bent'; end if;
  if length(nm) < 2 or length(nm) > 60 then raise exception 'Vul je naam in (2 tot 60 tekens)'; end if;
  if em !~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' or length(em) > 120 then raise exception 'Vul een geldig e-mailadres in'; end if;
  if p_kind = 'collega' and em !~* '@arrowline\.nl$' then raise exception 'Collega’s gebruiken hun e-mailadres van Arrowline (@arrowline.nl)'; end if;
  if p_kind <> 'collega' and (co is null or length(co) < 2 or length(co) > 80) then raise exception 'Vul de naam van je bedrijf in'; end if;
  if coalesce(p_consent, false) is not true then raise exception 'Geef toestemming voor het gebruik van je gegevens'; end if;
  if not exists (select 1 from teams where id = p_team) then raise exception 'Kies een team'; end if;
  select exists (select 1 from registrations where email = em) into existed;
  insert into registrations (name, email, team_id, kind, company, consent_at)
  values (nm, em, p_team, p_kind, case when p_kind = 'collega' then null else co end, now())
  on conflict (email) do update set name = excluded.name, team_id = excluded.team_id, kind = excluded.kind, company = excluded.company, consent_at = now(), updated_at = now();
  return case when existed then 'bijgewerkt' else 'aangemeld' end;
end $$;
revoke all on function register(text, text, int, text, text, boolean) from public;
grant execute on function register(text, text, int, text, text, boolean) to anon, authenticated;
