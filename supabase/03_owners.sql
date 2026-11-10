-- Mark who the owners are. Run once after creating the logins in Authentication → Users.
-- Owners sign in without approval and can approve everyone else.
-- Every other login (the counter tablet, staff) needs an owner's approval each time it signs in.
--
-- Change the emails and names below to your own, then Run.
insert into app_roles (user_id, role, name)
select id, 'owner', v.name
from auth.users u
join (values
  ('krishna@habibsfuljhore.in', 'Krishna')
  -- , ('raj@habibsfuljhore.in',  'Raj')
  -- , ('bikash@habibsfuljhore.in', 'Bikash')
) as v(email, name) on lower(u.email) = lower(v.email)
on conflict (user_id) do update set role = 'owner', name = excluded.name;

-- Check: should list your owners
select r.name, u.email, r.role from app_roles r join auth.users u on u.id = r.user_id;
