import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let PGlite;
try {
  ({ PGlite } = require("@electric-sql/pglite"));
} catch {
  test("equipment request table rename integration", {
    skip: "Optional @electric-sql/pglite is not installed.",
  }, () => {});
}

const migration = readFileSync(new URL("../supabase/migrations/0099_rename_equipment_request_tables.sql", import.meta.url), "utf8");

if (PGlite) {
  async function fixture() {
    const db = new PGlite();
    await db.exec(`
      create table profiles(id bigint primary key);
      insert into profiles values(77);
      create table projects(id bigint primary key);
      insert into projects values(1),(2);
      create table equipment_requisitions(
        id bigint generated always as identity primary key,
        project_id bigint not null references projects(id),
        er_no text not null,
        requested_by bigint not null references profiles(id),
        status text not null default 'submitted',
        approved_by bigint references profiles(id),
        unique(project_id, er_no)
      );
      create table equipment_requisition_items(
        id bigint generated always as identity primary key,
        equipment_request_id bigint not null references equipment_requisitions(id) on delete cascade,
        equipment_name text not null,
        quantity_needed numeric not null,
        quantity_fulfilled numeric not null default 0
      );
      insert into equipment_requisitions(project_id,er_no,requested_by) values(1,'ER-001',77),(2,'ER-001',77);
      insert into equipment_requisition_items(equipment_request_id,equipment_name,quantity_needed) values(1,'Mixer',2),(2,'Crane',1);
      create function is_project_foreman(p_project_id bigint) returns boolean
        language sql stable as $$select p_project_id = coalesce(nullif(current_setting('test.project_id',true),''),'0')::bigint$$;
      create function is_equipment_requisition_foreman(p_request_id bigint) returns boolean
        language sql stable security definer set search_path=public as $$
        select exists(select 1 from public.equipment_requisitions r
          where r.id=p_request_id and public.is_project_foreman(r.project_id));
      $$;
      create role request_reader;
      grant usage on schema public to request_reader;
      grant select on equipment_requisitions,equipment_requisition_items to request_reader;
      alter table equipment_requisitions enable row level security;
      alter table equipment_requisition_items enable row level security;
      create policy request_access on equipment_requisitions for select to request_reader
        using(is_project_foreman(project_id));
      create policy item_access on equipment_requisition_items for select to request_reader
        using(is_equipment_requisition_foreman(equipment_request_id));
      create function request_trigger() returns trigger language plpgsql as $$begin return new; end;$$;
      create trigger request_notification after insert on equipment_requisitions
        for each row execute function request_trigger();
    `);
    return db;
  }

  test("rename preserves records, IDs, sequences, grants, triggers and project-scoped RLS", async () => {
    const db = await fixture();
    try {
      const before = (await db.query(`select 'equipment_requisitions'::regclass::oid as header_oid,
        'equipment_requisition_items'::regclass::oid as items_oid,
        'is_equipment_requisition_foreman(bigint)'::regprocedure::oid as helper_oid`)).rows[0];
      await db.exec(migration);
      const after = (await db.query(`select 'equipment_requests'::regclass::oid as header_oid,
        'equipment_request_items'::regclass::oid as items_oid,
        'is_equipment_requisition_foreman(bigint)'::regprocedure::oid as helper_oid`)).rows[0];
      assert.deepEqual(after, before);
      assert.equal((await db.query("select count(*)::int n from equipment_requests")).rows[0].n, 2);
      assert.equal((await db.query("select count(*)::int n from equipment_request_items")).rows[0].n, 2);
      assert.equal((await db.query("select count(*)::int n from profiles")).rows[0].n, 1);
      assert.equal((await db.query("select count(*)::int n from pg_trigger where tgrelid='equipment_requests'::regclass and tgname='request_notification'")).rows[0].n, 1);
      await db.exec("set role request_reader;set test.project_id='1';");
      assert.deepEqual((await db.query("select id from equipment_requests order by id")).rows, [{ id: 1 }]);
      assert.deepEqual((await db.query("select equipment_name from equipment_request_items")).rows, [{ equipment_name: "Mixer" }]);
      await db.exec("set test.project_id='2';");
      assert.deepEqual((await db.query("select equipment_name from equipment_request_items")).rows, [{ equipment_name: "Crane" }]);
      await db.exec("reset role;");
      const inserted = await db.query("insert into equipment_requests(project_id,er_no,requested_by)values(1,'ER-002',77)returning id");
      assert.equal(inserted.rows[0].id, 3);
      await db.exec("delete from equipment_requests where id=1;");
      assert.equal((await db.query("select count(*)::int n from equipment_request_items where equipment_request_id=1")).rows[0].n, 0);
      await db.exec(migration);
    } finally {
      await db.close();
    }
  });

  for (const scenario of [
    { name: "a conflicting target table", setup: "create table equipment_requests(id bigint primary key);", error: /both public/ },
    { name: "a missing item table", setup: "drop table equipment_requisition_items;", error: /neither public/ },
    { name: "a missing request number column", setup: "alter table equipment_requisitions drop column er_no cascade;", error: /missing column er_no/ },
    { name: "a missing parent relationship", setup: "alter table equipment_requisition_items drop constraint equipment_requisition_items_equipment_request_id_fkey;", error: /foreign key is missing/ },
    { name: "another function using an old table name", setup: "create function stale_request_reader() returns bigint language plpgsql as $$begin return (select count(*) from equipment_requisitions);end;$$;", error: /another stored function/ },
  ]) {
    test(`rename aborts without partial changes for ${scenario.name}`, async () => {
      const db = await fixture();
      try {
        await db.exec(scenario.setup);
        await assert.rejects(db.exec(migration), scenario.error);
        await db.exec("rollback;");
        assert.equal((await db.query("select count(*)::int n from equipment_requisitions")).rows[0].n, 2);
        assert.equal((await db.query("select count(*)::int n from profiles")).rows[0].n, 1);
      } finally {
        await db.close();
      }
    });
  }
}
