-- Automatic replies go out sooner: a job becomes claimable 3 seconds after the message
-- instead of 6. A customer who sends several messages within 3 seconds still gets one reply.
-- Patched in place; fails if the function is not the expected version.
begin;
do $$
declare def text;
begin
 select pg_get_functiondef('public.crm_claim_auto_reply(uuid)'::regprocedure) into def;
 if position('now()-interval ''6 seconds''' in def) = 0 then raise exception 'crm_claim_auto_reply is not the expected version'; end if;
 execute replace(def, 'now()-interval ''6 seconds''', 'now()-interval ''3 seconds''');
end $$;
commit;
