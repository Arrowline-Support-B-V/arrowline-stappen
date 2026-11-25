-- Aanmelden: een ingelogde collega maakt zijn eigen deelnemer-rij aan en kiest een team.
-- Alleen vóór de start; daarna staat de keuze vast (zie spelregels).
create function join_challenge(p_name text, p_team int) returns participants
language plpgsql security definer set search_path = public as $$
declare me participants; nm text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  if today_nl() >= (select start_date from challenge) then raise exception 'Inschrijven is gesloten: de challenge is gestart'; end if;
  if length(nm) < 2 or length(nm) > 60 then raise exception 'Vul je naam in (2 tot 60 tekens)'; end if;
  if not exists (select 1 from teams where id = p_team) then raise exception 'Onbekend team'; end if;
  insert into participants (auth_user_id, name, team_id, source) values (auth.uid(), nm, p_team, 'screenshot')
  on conflict (auth_user_id) do update set name = excluded.name, team_id = excluded.team_id
  returning * into me;
  return me;
end $$;

-- Teams kiezen bij het aanmelden: naam, goed doel en aantal aanmeldingen (geen namen van anderen)
create function public_teams() returns table (id int, name text, charity text, members int)
language sql security definer stable set search_path = public as $$
  select t.id, t.name, t.charity, (select count(*)::int from participants p where p.team_id = t.id) from teams t order by t.id
$$;

revoke all on function join_challenge(text, int), public_teams() from public;
grant execute on function join_challenge(text, int), public_teams() to authenticated;
