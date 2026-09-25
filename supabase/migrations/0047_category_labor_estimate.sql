-- Gives a category (phase) its own direct labor cost — same reasoning
-- as 0042_category_direct_cost.sql (its own material line) one level
-- up: a category with no tasks yet (a standalone lump-sum item, e.g.
-- "MOBILIZATION") is a real row in the Labor Breakdown modal just like
-- a task is, and needs somewhere of its own to hold a labor cost once
-- it has one.
--
-- Same asymmetric rule Material Breakdown already established: typable
-- only while the category has no tasks; once it has any, the Labor
-- Breakdown modal shows their rolled-up total instead and this column
-- is left alone (see LaborBreakdownModalContent's own doc comment).
--
-- Run this AFTER 0046_category_priority.sql.

alter table public.estimate_categories
  add column if not exists category_labor_estimate numeric not null default 0;
