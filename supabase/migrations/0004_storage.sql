-- Privé-opslag voor screenshots (Supabase Storage). NIET getest: draait alleen in een Supabase-project.
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false) on conflict do nothing;
-- Een deelnemer mag alleen in zijn eigen map schrijven en lezen: pad = <participant_id>/<dag>-<n>.jpg
create policy "eigen screenshots uploaden" on storage.objects for insert to authenticated
  with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] in (select id::text from participants where auth_user_id = auth.uid()));
create policy "eigen screenshots lezen" on storage.objects for select to authenticated
  using (bucket_id = 'screenshots' and (storage.foldername(name))[1] in (select id::text from participants where auth_user_id = auth.uid()));
-- Beheerders lezen via een signed URL vanuit de beheerpagina (service role), nooit via een publieke link.
