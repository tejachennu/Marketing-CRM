-- Meta delivers a webhook again when the reply was slow or failed, and the inbound message used to be
-- stored again each time, with a second bot reply. The message is now stored once per workspace and
-- provider message id (twilio_message_sid: "FB_<wamid>" for Meta, the SID for Twilio), so a redelivery
-- is told apart from a first delivery by the upsert returning nothing. Until this index exists the
-- webhook route falls back to reading before inserting. Safe to apply more than once: each step only
-- changes rows that still collide.

-- An empty id says nothing about the message and must neither collide nor count as a duplicate.
update public.messages set twilio_message_sid = null where twilio_message_sid = '';

-- 1. Real redeliveries are removed: the same inbound message (from the customer, same id, same
--    conversation, same text) stored more than once. The earliest row is kept (ties broken by id):
--    it is the one the first reply and the conversation refer to.
delete from public.messages
where id in (
  select id from (
    select id, row_number() over (
      partition by organization_id, twilio_message_sid, conversation_id, body
      order by created_at asc, id asc
    ) as duplicate_rank
    from public.messages
    where twilio_message_sid is not null
      and sender_type = 'contact'
  ) ranked
  where ranked.duplicate_rank > 1
);

-- 2. Every other collision is a different message that was given a shared id, for instance campaign
--    sends in one batch that got a timestamp ("SG_<ms>", "FB_<ms>") as their id. They are kept, and
--    all but the earliest get an id of their own (the old one with the row's id appended), so the
--    unique index below can be built without losing a chat line.
update public.messages m
set twilio_message_sid = m.twilio_message_sid || '_dup_' || m.id::text
from (
  select id, row_number() over (
    partition by organization_id, twilio_message_sid
    order by created_at asc, id asc
  ) as duplicate_rank
  from public.messages
  where twilio_message_sid is not null
    and organization_id is not null
) ranked
where m.id = ranked.id
  and ranked.duplicate_rank > 1;

-- Not a partial index: PostgREST's upsert (on_conflict=organization_id,twilio_message_sid) cannot name
-- a partial index's WHERE predicate, and Postgres only infers a partial unique index with it. Rows
-- without a provider id never conflict anyway, since NULLs are distinct in a unique index (which is
-- also why step 2 leaves rows without an organization alone).
create unique index if not exists messages_org_provider_sid_key
  on public.messages (organization_id, twilio_message_sid);
