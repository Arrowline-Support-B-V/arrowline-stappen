-- Deelnemers kiezen geen team en geen rol. De organisatie deelt later in.
alter table registrations alter column team_id drop not null;
alter table registrations alter column kind drop not null;
alter table registrations alter column kind drop default;

drop function register(text, text, int, text, text, boolean);
create function register(p_name text, p_email text, p_consent boolean) returns text
language plpgsql security definer set search_path = public as $$
declare nm text := trim(coalesce(p_name, '')); em text := lower(trim(coalesce(p_email, ''))); existed boolean;
begin
  if today_nl() >= (select start_date from challenge) then raise exception 'Aanmelden is gesloten: de challenge is gestart'; end if;
  if length(nm) < 2 or length(nm) > 60 then raise exception 'Vul je naam in (2 tot 60 tekens)'; end if;
  if em !~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' or length(em) > 120 then raise exception 'Vul een geldig e-mailadres in'; end if;
  if coalesce(p_consent, false) is not true then raise exception 'Geef toestemming voor het gebruik van je gegevens'; end if;
  select exists (select 1 from registrations where email = em) into existed;
  insert into registrations (name, email, consent_at)
  values (nm, em, now())
  on conflict (email) do update set name = excluded.name, consent_at = now(), updated_at = now();
  return case when existed then 'bijgewerkt' else 'aangemeld' end;
end $$;
revoke all on function register(text, text, boolean) from public;
grant execute on function register(text, text, boolean) to anon, authenticated;
