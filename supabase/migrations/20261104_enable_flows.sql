-- The Flow Builder's per-organization switch (enable_flows), read by lib/feature-flags.ts and set
-- from the super admin console. Commerce and the Flow Builder are now on for every organization;
-- this column lets a super admin turn the Flow Builder off for one of them. Safe to apply more
-- than once. Until it is applied the dashboard treats the switch as on, and the super admin
-- console answers "Apply the enable_flows migration first" when the toggle is used.
alter table public.organizations
  add column if not exists enable_flows boolean not null default true;
