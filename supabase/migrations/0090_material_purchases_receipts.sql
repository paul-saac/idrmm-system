-- Migration 0090: Add receipt attachment columns, storage bucket, and delete policy for material purchases D
begin;

-- Add receipt attachment tracking to material purchases
alter table public.material_purchases
  add column if not exists receipt_url text default '',
  add column if not exists receipt_path text default '';

-- Relax constraints on legacy unit/quantity columns
alter table public.material_purchases
  alter column unit set default 'lot',
  alter column quantity set default 1,
  alter column received_quantity set default 1;

-- Allow project members to delete purchases
grant update, delete on public.material_purchases to authenticated;

drop policy if exists "Project members delete purchases" on public.material_purchases;
create policy "Project members delete purchases" on public.material_purchases for delete to authenticated
  using (
    public.invitation_setup_complete()
    and public.get_my_role() is not null
    and exists (select 1 from public.projects p where p.id = project_id)                                
  );

-- Create storage bucket for invoice / receipt attachments
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-receipts', 'purchase-receipts', true, 10485760, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "Public view purchase receipts" on storage.objects;
create policy "Public view purchase receipts" on storage.objects for select to public
  using (bucket_id = 'purchase-receipts');

drop policy if exists "Authenticated upload purchase receipts" on storage.objects;
create policy "Authenticated upload purchase receipts" on storage.objects for insert to authenticated
  with check (bucket_id = 'purchase-receipts');

drop policy if exists "Authenticated delete purchase receipts" on storage.objects;
create policy "Authenticated delete purchase receipts" on storage.objects for delete to authenticated
  using (bucket_id = 'purchase-receipts');

commit;

