-- Toegang: deelnemers lezen hun eigen stappen. Schrijven gaat ALLEEN via de edge function (service role).
alter table participants enable row level security;
alter table daily_steps  enable row level security;
alter table teams        enable row level security;
alter table challenge    enable row level security;

create policy "teams zichtbaar"       on teams        for select to authenticated using (true);
create policy "challenge zichtbaar"   on challenge    for select to authenticated using (true);
create policy "eigen profiel"         on participants for select to authenticated using (auth_user_id = auth.uid());
create policy "eigen stappen"         on daily_steps  for select to authenticated
  using (participant_id in (select id from participants where auth_user_id = auth.uid()));
-- Geen insert/update/delete policies voor 'authenticated': de app kan nooit zelf een score schrijven.

-- Ranglijsten voor iedereen (zonder rijen van anderen bloot te geven): security definer functies
create function public_team_scores() returns table (rank int, team_id int, name text, charity text, members int, score numeric, avg_points numeric, bonus_days int)
  language sql security definer stable set search_path = public as $$ select * from team_scores() $$;
create function public_person_scores() returns table (rank int, participant_id uuid, name text, team_id int, points int, days_hit int, days_total int)
  language sql security definer stable set search_path = public as $$ select * from person_scores() $$;
revoke all on function public_team_scores(), public_person_scores() from public;
grant execute on function public_team_scores(), public_person_scores() to authenticated;
