# WhatsApp flows: findings and integration changes

Reviewed 24 September 2026. Competitor findings are based on public product documentation, not access to their private implementations.

## Competitor benchmark

| Public workflow pattern | Source | Implementation in this change |
| --- | --- | --- |
| Native forms capture structured customer answers inside WhatsApp | [Interakt forms](https://www.interakt.shop/resource-center/whatsapp-form/) | Compile real Meta components and navigation; carry answers between screens; persist completion against its conversation, session and CRM lead. |
| Explicit triggers and fallback behavior keep unexpected replies from breaking the conversation | [WATI troubleshooting](https://support.wati.io/en/articles/11463044-troubleshooting-chatbots-that-don-t-trigger-or-stop-unexpectedly) | Match reply IDs precisely; reprompt for unknown choices; support cancellation and expire inactive sessions; validate every output before activation. |
| Route customer conversations to people | [WATI assignment](https://support.wati.io/en/articles/14270796-how-to-use-round-robin-assignment-for-chats-in-wati) | Shared team queue handoff pauses automation. Specific-agent assignment is supported by the runtime. Round-robin assignment is not implemented. |
| Create, upload, validate and publish before sending a native form | [Meta's official tools and API collection](https://github.com/WhatsApp/WhatsApp-Flows-Tools), [Meta publishing API](https://www.postman.com/meta/whatsapp-business-platform/request/wcidrlg/publish-flow) | Save drafts, upload JSON assets, expose Meta validation errors, persist the actual Flow ID, and publish through Meta. Published definitions cannot be edited locally. |

The practical improvement is a consistent path from designer to simulator to WhatsApp to CRM, with observable errors at each boundary. This review does not establish that the product as a whole exceeds either competitor.

## Confirmed failures in this installation

- Meta returned zero flows although one local form was marked PUBLISHED. The configured account credentials were valid.
- The compiler emitted designer fields directly, without Meta Form containers, navigation or completion payloads. Meta's live API also rejected the old JSON version 3.1; the compiler now emits 7.3.
- The webhook put bare flow parameters in `interactive` instead of `interactive.action.parameters` and could use a local UUID as the Meta Flow ID.
- Ordinary message nodes waited for another incoming message instead of continuing to the next action. Terminal sessions remained IN_PROGRESS.
- Unknown button replies could follow the first branch. List replies and condition nodes were not executed.
- Form submissions were parsed but ignored; a normal chat message could advance past a form.
- CRM inserts omitted required contact IDs and included nonexistent columns. Submission/session reports queried nonexistent columns and the wrong status.
- Send failures appeared as outgoing messages without a failed status, and action-only workflows could fall through into a second chatbot response.

## Behavior and operation

1. Create or edit a draft form. **Validate with Meta** creates/reuses a remote draft and reports field-level errors. **Publish to WhatsApp** validates and publishes it. Publication is immutable on Meta; use a new form for a changed definition.
2. Connect the form to a workflow. Use `{{contact.name}}`, `{{form.full_name}}`, `{{form.budget}}`, `{{last_choice}}`, `{{deal_id}}` or `{{ticket_id}}` in later steps. Form answers are stored under `form` and `submission`; they cannot overwrite internal session fields.
3. Test the graph with the simulator. Messages and actions advance automatically. Buttons, lists and forms wait for input. Sample form answers are explicitly simulated; AI output is never fabricated as a successful test.
4. Activate after readiness checks pass. New workflows are drafts. Conditions and list menus have individual output ports. Agent handoff ends the graph and disables automatic replies for the conversation.
5. Inspect recent failures in the workflow editor, failed message delivery in the inbox, and form responses in the native form designer. CRM leads retain the submitted answers in their notes.

The Facebook webhook handles every message/status in a batch and scopes provider delivery status updates to the organization. Successful recent flow messages are deduplicated via saved session state. A database lease serializes flow execution for each organization/customer. Sessions retain the graph they started with so later edits do not change an ongoing path.

Apply `scripts/db-migration-v32-flow-reliability.sql` before deploying this code. The migration adds submission correlation fields, a unique submission-token index, and service-role-only database functions for contact leases and atomic execution counters. It was applied to the configured database during this work. The JS wrapper uses the PostgreSQL connection settings from the environment; configure the database CA where needed.

## Verification

- The 26 regression tests passed. Run `npm run test:flows` for compiler, routing, transitions, delivery failure, session expiry, form-token correlation, CRM writes, tenant boundaries, replay and handoff regression tests.
- `npx tsc --noEmit`, `npm run build`, and `git diff --check` passed. Anonymous HTTP requests to the form, workflow and simulator endpoints returned 401.
- All three starter templates were uploaded to Meta as draft assets and accepted with no validation errors. The selected lead form was restored and revalidated after these checks.
- After explicit user approval, the repaired lead form was published with Meta Flow ID `1977534556249564`. Meta returned PUBLISHED with no validation errors, and the existing active automation passed every readiness check. The two legacy sessions stuck at the native-form and CRM steps were expired without deleting their records. The application changes have not been deployed.
- No customer messages were sent during validation. A real inbound message and native-form completion must still be checked on WhatsApp after the updated webhook is deployed.

## Remaining work beyond this repair

- A durable outbound job queue with explicit operator retries and recovery for the ambiguous case where Meta accepts a send but the process dies before recording it. Current failures stop the graph and remain visible; automatic replay of a failed flow message is suppressed to avoid repeating side effects.
- Persistent event receipts for deduplication beyond the recent session history, and transactional CRM action receipts for process-crash recovery.
- Dynamic appointment availability, payments and inventory need a separate encrypted Meta data-exchange endpoint and real business integrations. The appointment template collects a requested time; it does not reserve a slot.
- Delayed jobs, external webhook actions, semantic/intent triggers, round-robin routing and campaign-reply triggers need their own workers/integrations. Activation rejects unsupported types instead of pretending to execute them.
- Flow-level conversion/drop-off dashboards and richer lead qualification rules can build on the now-linked sessions, submissions and CRM records.
- The existing webhook lacks mandatory Meta signature verification. Add a securely configured app secret and verify the raw request signature before enabling a broader public rollout; this change does not claim webhook-source authentication.
