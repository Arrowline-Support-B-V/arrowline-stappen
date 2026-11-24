-- Beheer: goedkeuren/afkeuren/terugdraaien via beveiligde functies, met een volledig logboek.
create table admins (user_id uuid primary key);
create table review_log (
  id bigserial primary key, at timestamptz not null default now(), admin_id uuid not null,
  participant_id uuid not null, day date not null, action text not null check (action in ('approve','reject','revert')),
  steps int, reason text
);

create function is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

create function admin_approve(p_participant uuid, p_day date, p_steps int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  if p_steps is null or p_steps < 0 or p_steps > 200000 then raise exception 'Ongeldig aantal stappen'; end if;
  insert into daily_steps (participant_id, day, steps, source_kind, status, reason, reviewed_by)
  values (p_participant, p_day, p_steps, 'admin', 'ok', null, auth.uid())
  on conflict (participant_id, day) do update set steps = excluded.steps, status = 'ok', reason = null, reviewed_by = auth.uid(), synced_at = now();
  insert into review_log (admin_id, participant_id, day, action, steps) values (auth.uid(), p_participant, p_day, 'approve', p_steps);
end $$;

create function admin_reject(p_participant uuid, p_day date, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Geef een reden op'; end if;
  update daily_steps set status = 'rejected', reason = left(p_reason, 200), reviewed_by = auth.uid(), synced_at = now()
  where participant_id = p_participant and day = p_day;
  if not found then raise exception 'Geen inzending voor deze dag'; end if;
  insert into review_log (admin_id, participant_id, day, action, reason) values (auth.uid(), p_participant, p_day, 'reject', left(p_reason, 200));
end $$;

-- Een automatische goedkeuring terugzetten naar handmatige controle
create function admin_revert(p_participant uuid, p_day date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  update daily_steps set status = 'pending', reason = 'Teruggedraaid door een beheerder', reviewed_by = null, synced_at = now()
  where participant_id = p_participant and day = p_day and status = 'ok';
  if not found then raise exception 'Niets om terug te draaien'; end if;
  insert into review_log (admin_id, participant_id, day, action) values (auth.uid(), p_participant, p_day, 'revert');
end $$;

-- Wachtrij voor de beheerpagina (alleen beheerders)
create function admin_queue() returns table (participant_id uuid, name text, team_id int, day date, steps int, source_kind text, reason text, screenshot_path text, fraud_rejections int)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_admin() then raise exception 'Alleen voor beheerders'; end if;
  -- fraud_rejections: hoe vaak deze deelnemer al is afgekeurd wegens een bewerkte of met AI gemaakte screenshot
  return query select s.participant_id, p.name, p.team_id, s.day, s.steps, s.source_kind, s.reason, s.screenshot_path,
      (select count(*)::int from review_log l where l.participant_id = s.participant_id and l.action = 'reject' and l.reason ilike 'Bewerkt%')
    from daily_steps s join participants p on p.id = s.participant_id where s.status = 'pending' order by s.day desc, p.name;
end $$;

-- Teamstatus voor het dashboard ("18 van 32 op 10.000+, 13 in behandeling"): alleen aantallen, geen namen of stappen van anderen
create function public_team_day_status(p_day date) returns table (team_id int, members int, qualified int, pending int, missing int)
language sql security definer stable set search_path = public as $$
  select p.team_id, count(*)::int,
         count(*) filter (where s.status = 'ok' and s.steps >= (select min_steps from challenge))::int,
         count(*) filter (where s.status = 'pending')::int,
         count(*) filter (where s.status is null)::int
  from participants p left join daily_steps s on s.participant_id = p.id and s.day = p_day
  where p.team_id is not null group by p.team_id
$$;

-- Betrapt: de deelnemer ziet zijn EIGEN waarschuwingen (voor de sarcastische melding in de app). Nooit die van anderen.
create function my_warnings() returns table (day date, nth int, at timestamptz)
language sql security definer stable set search_path = public as $$
  select l.day, (row_number() over (order by l.at))::int, l.at
  from review_log l join participants p on p.id = l.participant_id
  where p.auth_user_id = auth.uid() and l.action = 'reject' and l.reason ilike 'Bewerkt%'
  order by l.at
$$;
revoke all on function my_warnings() from public; grant execute on function my_warnings() to authenticated;

revoke all on function admin_approve(uuid, date, int), admin_reject(uuid, date, text), admin_revert(uuid, date), admin_queue(), public_team_day_status(date), is_admin() from public;
grant execute on function admin_approve(uuid, date, int), admin_reject(uuid, date, text), admin_revert(uuid, date), admin_queue(), public_team_day_status(date), is_admin() to authenticated;
alter table admins enable row level security;
alter table review_log enable row level security;
create policy "beheerders lezen logboek" on review_log for select to authenticated using (is_admin());
