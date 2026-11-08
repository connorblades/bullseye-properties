-- Forward-only repair for the initial membership policies. Apply in staging
-- and inspect live policies/grants before production rollout.
begin;

-- Qualify every object and pin search_path in the security-definer helper.
create or replace function public.auth_user_tenants()
returns setof text
language sql stable security definer
set search_path = ''
as $$
  select m.tenant_id from public.memberships m
  where m.user_id = auth.uid()
    and m.deleted_at is null
    and m.role <> 'suspended'
$$;

-- The original membership SELECT policy queried memberships recursively.
-- Evaluate the admin predicate as the function owner, without accepting any
-- caller-selected user id. Only the current verified session is considered.
create or replace function public.auth_is_platform_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid()
      and m.role = 'platform_admin'
      and m.deleted_at is null
  )
$$;

revoke all on function public.auth_user_tenants() from public, anon;
revoke all on function public.auth_is_platform_admin() from public, anon;
grant execute on function public.auth_user_tenants() to authenticated, service_role;
grant execute on function public.auth_is_platform_admin() to authenticated, service_role;

drop policy if exists tenant_read_memberships on public.memberships;
create policy tenant_read_memberships on public.memberships
for select to authenticated
using (
  tenant_id in (select public.auth_user_tenants())
  or (select public.auth_is_platform_admin())
);

-- A tenant member must not be able to promote themselves to platform_admin
-- or create memberships for other users through the Data API. Membership
-- administration remains a trusted backend/service-role operation.
drop policy if exists tenant_write_memberships on public.memberships;
drop policy if exists tenant_update_memberships on public.memberships;
revoke insert, update, delete, truncate, references, trigger
  on public.memberships from public, anon, authenticated;

commit;
