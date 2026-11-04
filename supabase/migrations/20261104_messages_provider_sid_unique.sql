-- Meta delivers a webhook again when the reply was slow or failed, and the inbound message used to be
-- stored again each time, with a second bot reply. The message is now stored once per workspace and
-- provider message id (twilio_message_sid: "FB_<wamid>" for Meta, the SID for Twilio), so a redelivery
-- is told apart from a first delivery by the upsert returning nothing. Until this index exists the
-- webhook route falls back to reading before inserting.

-- An empty id says nothing about the message and must neither collide nor count as a duplicate.
update public.messages set twilio_message_sid = null where twilio_message_sid = '';

-- Rows stored twice before this index are removed first, keeping the earliest row of each pair
-- (ties broken by id): it is the one the first reply and the conversation refer to.
delete from public.messages
where id in (
  select id from (
    select id, row_number() over (partition by organization_id, twilio_message_sid order by created_at asc, id asc) as duplicate_rank
    from public.messages
    where twilio_message_sid is not null
  ) ranked
  where ranked.duplicate_rank > 1
);

-- Not a partial index: PostgREST's upsert (on_conflict=organization_id,twilio_message_sid) cannot name
-- a partial index's WHERE predicate, and Postgres only infers a partial unique index with it. Rows
-- without a provider id never conflict anyway, since NULLs are distinct in a unique index.
create unique index if not exists messages_org_provider_sid_key
  on public.messages (organization_id, twilio_message_sid);
