begin;

revoke all on function public.get_my_profile() from anon;
revoke all on function public.get_my_account_access() from anon;
revoke all on function public.get_public_profiles(uuid[]) from anon;
revoke all on function public.admin_get_profile_access(uuid) from anon;

commit;
