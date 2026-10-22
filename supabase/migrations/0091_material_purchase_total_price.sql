-- Intent: preserve the client's entered purchase Price as an exact line total.
-- unit_price remains for compatibility and reference calculations.
alter table public.material_purchases
  add column if not exists price_amount numeric(14,2);
update public.material_purchases set price_amount=amount where price_amount is null;
alter table public.material_purchases alter column price_amount set not null;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'material_purchases_price_amount_nonnegative'
      and conrelid = 'public.material_purchases'::regclass
  ) then
    alter table public.material_purchases
      add constraint material_purchases_price_amount_nonnegative
      check(price_amount >= 0);
  end if;
end
$$;
