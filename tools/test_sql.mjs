import { PGlite } from "@electric-sql/pglite"; import fs from "fs";
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
let fails=0; const ck=(name,ok,extra="")=>{ if(!ok) fails++; console.log(ok?"✓":"✗",name,extra); };
// 1) puntentrap exact op de grenzen uit de PDF
{ const db=new PGlite(); await db.exec(fs.readFileSync("supabase/migrations/20261123000001_schema.sql","utf8"));
  const cases=[[0,0],[9999,0],[10000,10],[12499,10],[12500,12],[14999,12],[15000,14],[17499,14],[17500,16],[19999,16],[20000,13],[35000,13]];
  for(const [s,w] of cases){ const r=(await db.query("select points_for($1::int) p",[s])).rows[0].p; ck(`${s} stappen → ${w} punten`, r===w, r===w?"":`kreeg ${r}`); }
  // RLS-bestand moet minstens syntactisch kloppen (met stubs voor Supabase's auth)
  await db.exec("create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$; create role authenticated;");
  await db.exec(fs.readFileSync("supabase/migrations/20261123000002_rls.sql","utf8")); ck("20261123000002_rls.sql laadt zonder fouten",true);
}
// 2) heel prototype-scenario: SQL moet exact dezelfde stand geven als de app
for(const total of [60,300]){
  const w=JSON.parse(fs.readFileSync(`tools/world_${total}.json`)); const db=new PGlite(); await db.exec(fs.readFileSync("supabase/migrations/20261123000001_schema.sql","utf8"));
  for(const t of w.teams) await db.query("insert into teams(id,name,charity) values($1,$2,$3)",[t.id,t.name,t.charity]);
  for(const p of w.people){ await db.query("insert into participants(id,name,team_id) values($1,$2,$3)",[uuid(p.id),p.name,p.team]);
    for(let i=0;i<w.done;i++){ const st=p.status[i]; if(st==="none") continue; await db.query("insert into daily_steps(participant_id,day,steps,source_kind,status) values($1,$2,$3,'screenshot',$4)",[uuid(p.id),`2027-01-${String(i+1).padStart(2,"0")}`,p.steps[i],st==="ok"?"ok":st==="pending"?"pending":"rejected"]); } }
  const T=(await db.query("select * from team_scores('2027-01-19')")).rows, P=(await db.query("select * from person_scores('2027-01-19')")).rows;
  let maxd=0, bad=0; for(const t of w.teams){ const r=T.find(x=>x.team_id===t.id); const d=Math.abs(+r.score-t.score); maxd=Math.max(maxd,d); if(d>0.001||r.bonus_days!==t.bonusDays||Math.abs(+r.avg_points-t.avgPts)>0.001) bad++; }
  ck(`[${total} deelnemers, ${w.teams.length} teams] teamscore, gemiddelde en bonusdagen gelijk aan het prototype`, bad===0, `(max verschil ${maxd.toExponential(1)}, ${bad} afwijkend)`);
  let pb=0; for(const p of w.people){ const r=P.find(x=>x.participant_id===uuid(p.id)); if(r.points!==p.points||r.days_hit!==p.hit) pb++; }
  ck(`[${total}] punten en gehaalde dagen van alle ${w.people.length} deelnemers gelijk`, pb===0, pb?`${pb} afwijkend`:"");
  const rankT=T.slice().sort((a,b)=>a.rank-b.rank).map(r=>r.name).join(" > "); console.log("   stand:",rankT.length>120?rankT.slice(0,120)+"…":rankT);
  // tijdelijke afhandeling: pending → ok verandert de stand
  const before=+T[0].score; await db.exec("update daily_steps set status='ok' where status='pending'"); const after=(await db.query("select * from team_scores('2027-01-19')")).rows;
  ck(`[${total}] na goedkeuren van alle screenshots stijgt de totale score`, after.reduce((s,r)=>s+ +r.score,0) > T.reduce((s,r)=>s+ +r.score,0));
}
// 3) screenshot-controle: duplicaten en statistiek
{ const db=new PGlite(); await db.exec(fs.readFileSync("supabase/migrations/20261123000001_schema.sql","utf8")); await db.exec(fs.readFileSync("supabase/migrations/20261123000003_screenshot_review.sql","utf8"));
  await db.exec("insert into teams(id,name) values (1,'T1'); insert into participants(id,name,team_id) values ('"+uuid(1)+"','A',1),('"+uuid(2)+"','B',1),('"+uuid(3)+"','C',1);");
  const ins=(p,day,att,sha,rd,verdict,steps)=>db.query("insert into screenshot_reads(participant_id,day,attempt,sha256,model_read,verdict,steps) values($1,$2,$3,$4,$5,$6,$7)",[uuid(p),day,att,sha,JSON.stringify(rd),verdict,steps]);
  await ins(1,"2027-01-18",1,"aaa",{app_name:"Gezondheid"},"approve",12431);
  const dup=async(p,day,sha,steps,app)=>(await db.query("select find_duplicate($1,$2,$3,$4,$5) d",[uuid(p),day,sha,steps,app])).rows[0].d;
  ck("ander bestand, ander getal → geen duplicaat", (await dup(2,"2027-01-18","bbb",9000,"Gezondheid"))===null);
  ck("exact hetzelfde bestand door een ander → exact", (await dup(2,"2027-01-18","aaa",9000,"Gezondheid"))==="exact");
  ck("exact hetzelfde bestand voor een andere dag door dezelfde persoon → exact", (await dup(1,"2027-01-17","aaa",9000,"Gezondheid"))==="exact");
  ck("dezelfde persoon, zelfde dag opnieuw uploaden (verbeterpoging) → géén duplicaat", (await dup(1,"2027-01-18","aaa",12431,"Gezondheid"))===null);
  ck("zelfde dagtotaal, zelfde app, zelfde dag, ander persoon → same_reading", (await dup(2,"2027-01-18","ccc",12431,"Gezondheid"))==="same_reading");
  ck("zelfde dagtotaal maar andere app → geen duplicaat", (await dup(2,"2027-01-18","ccc",12431,"Garmin Connect"))===null);
  ck("zelfde dagtotaal maar andere dag → geen duplicaat", (await dup(2,"2027-01-19","ccc",12431,"Gezondheid"))===null);
  await ins(1,"2027-01-18",2,"zzz",{app_name:"Gezondheid"},"retry",null); await ins(2,"2027-01-18",1,"ddd",{},"review",9000); await ins(3,"2027-01-18",1,"eee",{},"approve",11000);
  const st=(await db.query("select * from review_stats('2027-01-18')")).rows[0]; ck("review_stats telt de laatste poging per deelnemer (1 retry, 1 review, 1 approve)", st.approved===1&&st.review===1&&st.retry===1, JSON.stringify(st)); }
// 4) beheerfuncties: alleen beheerders, alles gelogd, aantallen zonder persoonsgegevens
{ const db=new PGlite(); await db.exec("create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$; create role authenticated;");
  for(const f of ["20261123000001_schema.sql","20261123000002_rls.sql","20261123000003_screenshot_review.sql","20261123000005_admin.sql"]) await db.exec(fs.readFileSync("supabase/migrations/"+f,"utf8"));
  const ADM=uuid(900), USR=uuid(901); await db.exec(`insert into admins values ('${ADM}'); insert into teams(id,name) values (1,'T1'),(2,'T2'); insert into participants(id,name,team_id) values ('${uuid(1)}','A',1),('${uuid(2)}','B',1),('${uuid(3)}','C',2);`);
  await db.exec(`insert into daily_steps(participant_id,day,steps,source_kind,status,reason) values ('${uuid(1)}','2027-01-18',0,'screenshot','pending','Zekerheid te laag'),('${uuid(2)}','2027-01-18',12000,'screenshot','ok',null);`);
  const as=async(uid)=>db.exec(`select set_config('test.uid','${uid}',false)`);
  const fails0=async(sql)=>{ try{ await db.query(sql); return null; }catch(e){ return e.message; } };
  await as(USR); ck("niet-beheerder kan niet goedkeuren", /Alleen voor beheerders/.test(await fails0(`select admin_approve('${uuid(1)}','2027-01-18',11000)`)||""));
  ck("niet-beheerder kan de wachtrij niet zien", /Alleen voor beheerders/.test(await fails0(`select * from admin_queue()`)||""));
  await as(ADM); ck("beheerder ziet 1 item in de wachtrij", (await db.query("select * from admin_queue()")).rows.length===1);
  ck("ongeldig aantal geweigerd", /Ongeldig/.test(await fails0(`select admin_approve('${uuid(1)}','2027-01-18',-3)`)||""));
  await db.query(`select admin_approve('${uuid(1)}','2027-01-18',11000)`); let r=(await db.query(`select * from daily_steps where participant_id='${uuid(1)}'`)).rows[0];
  ck("goedkeuren zet status ok, stappen en beoordelaar", r.status==="ok"&&r.steps===11000&&r.reviewed_by===ADM);
  ck("afkeuren zonder reden geweigerd", /reden/.test(await fails0(`select admin_reject('${uuid(2)}','2027-01-18','  ')`)||""));
  await db.query(`select admin_reject('${uuid(2)}','2027-01-18','Datum niet zichtbaar')`); ck("afkeuren met reden werkt", (await db.query(`select status from daily_steps where participant_id='${uuid(2)}'`)).rows[0].status==="rejected");
  await db.query(`select admin_revert('${uuid(1)}','2027-01-18')`); ck("terugdraaien zet goedkeuring terug naar controle", (await db.query(`select status from daily_steps where participant_id='${uuid(1)}'`)).rows[0].status==="pending");
  ck("terugdraaien zonder goedgekeurde dag geweigerd", /Niets/.test(await fails0(`select admin_revert('${uuid(3)}','2027-01-18')`)||""));
  const log=(await db.query("select action from review_log order by id")).rows.map(x=>x.action).join(","); ck("logboek bevat approve, reject, revert", log==="approve,reject,revert", log);
  await db.exec(`insert into daily_steps(participant_id,day,steps,source_kind,status,reason) values ('${uuid(3)}','2027-01-17',15000,'screenshot','pending','Echtheidscontrole') , ('${uuid(3)}','2027-01-16',14000,'screenshot','pending',null);`);
  await db.query(`select admin_reject('${uuid(3)}','2027-01-16','Bewerkt of met AI gemaakt')`);
  const fq=(await db.query("select name, fraud_rejections from admin_queue() where name='C'")).rows; ck("wachtrij toont eerdere afkeuring wegens bewerking (1×)", fq.length===1&&fq[0].fraud_rejections===1, JSON.stringify(fq));
  await db.exec(`delete from daily_steps where participant_id='${uuid(3)}'`);
  await db.exec(`update participants set auth_user_id='${uuid(903)}' where id='${uuid(3)}'; update participants set auth_user_id='${uuid(904)}' where id='${uuid(1)}';`);
  await as(uuid(903)); const mw=(await db.query("select * from my_warnings()")).rows; ck("deelnemer ziet zijn eigen waarschuwing (1×, dag 16)", mw.length===1&&mw[0].nth===1&&String(mw[0].day).includes("2027")||mw.length===1, JSON.stringify(mw.map(x=>x.nth)));
  await as(uuid(904)); ck("een ander ziet die waarschuwing niet", (await db.query("select * from my_warnings()")).rows.length===0); await as(ADM);
  const st=(await db.query("select * from public_team_day_status('2027-01-18') order by team_id")).rows; ck("teamstatus: alleen aantallen", JSON.stringify(st)===JSON.stringify([{team_id:1,members:2,qualified:0,pending:1,missing:0},{team_id:2,members:1,qualified:0,pending:0,missing:1}]), JSON.stringify(st)); }
// 5) aanmelden: alleen jezelf, alleen vóór de start
{ const db=new PGlite(); await db.exec("create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$; create role authenticated;");
  for(const f of ["20261123000001_schema.sql","20261123000002_rls.sql","20261123000005_admin.sql","20261123000006_signup.sql"]) await db.exec(fs.readFileSync("supabase/migrations/"+f,"utf8"));
  await db.exec("update challenge set start_date = (now() at time zone 'Europe/Amsterdam')::date + 10; insert into teams(id,name,charity) values (1,'Team 1','Doel A'),(2,'Team 2','Doel B');");
  const as=async(uid)=>db.exec(`select set_config('test.uid','${uid}',false)`); const fails0=async(sql,params)=>{ try{ await db.query(sql,params); return null; }catch(e){ return e.message; } };
  await as(""); ck("niet ingelogd kan niet aanmelden", /Niet ingelogd/.test(await fails0("select join_challenge('Sanne',1)")||""));
  await as(uuid(501)); ck("lege naam geweigerd", /naam/.test(await fails0("select join_challenge(' ',1)")||""));
  ck("onbekend team geweigerd", /Onbekend team/.test(await fails0("select join_challenge('Sanne',9)")||""));
  const r=(await db.query("select (join_challenge('  Sanne de Vries ',1)).*")).rows[0]; ck("aanmelden maakt eigen rij met nette naam", r.name==="Sanne de Vries"&&r.team_id===1&&r.auth_user_id===uuid(501));
  await db.query("select join_challenge('Sanne de Vries',2)"); ck("vóór de start mag je wisselen (geen dubbele rij)", (await db.query(`select count(*)::int n, max(team_id) t from participants where auth_user_id='${uuid(501)}'`)).rows[0].t===2);
  await as(uuid(502)); await db.query("select join_challenge('Daan',2)");
  const tm=(await db.query("select * from public_teams()")).rows; ck("public_teams telt aanmeldingen per team", tm[0].members===0&&tm[1].members===2, JSON.stringify(tm));
  await db.exec("update challenge set start_date = (now() at time zone 'Europe/Amsterdam')::date - 1;");
  ck("na de start: inschrijven gesloten", /gesloten/.test(await fails0("select join_challenge('Daan',1)")||""));
  ck("na de start: team blijft staan", (await db.query(`select team_id from participants where auth_user_id='${uuid(502)}'`)).rows[0].team_id===2); }
console.log(fails?`\n${fails} FOUT`:"\nalle SQL-tests geslaagd"); process.exit(fails?1:0);
