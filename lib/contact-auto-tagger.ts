import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// The only tags the model may apply; anything else it returns is discarded
const ALLOWED_TAGS = new Set([
    'interested-premium', 'price-sensitive', 'ready-to-buy', 'early-stage',
    'satisfied', 'frustrated', 'at-risk',
    'high-engagement', 'enterprise', 'returning-customer', 'technical-user',
]);

export async function autoTagContact(contactId: string, conversationId: string, orgId: string): Promise<string[]> {
    try {
        const supabase = createClient(supabaseUrl, supabaseKey);

        // 2. Fetch current tags
        const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .select('tags')
            .eq('id', contactId)
            .eq('organization_id', orgId)
            .single();

        if (contactError || !contact) {
            console.error('[Auto-Tagger] Error fetching contact:', contactError);
            return [];
        }

        const existingTags: string[] = contact.tags || [];

        // 3. Fetch last 10 messages
        const { data: messages, error: messagesError } = await supabase
            .from('messages')
            .select('body, sender_type')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (messagesError || !messages || messages.length === 0) {
            console.error('[Auto-Tagger] Error fetching messages or no messages:', messagesError);
            return existingTags;
        }

        const chatHistory = messages.reverse().map(m => `${m.sender_type}: ${m.body}`).join('\n');

        // 4. Fetch org's openai_api_key
        const { data: orgData } = await supabase
            .from('organizations')
            .select('openai_api_key')
            .eq('id', orgId)
            .single();

        const openAiKey = orgData?.openai_api_key;

        // 5. Return early if no key
        if (!openAiKey) {
            return existingTags;
        }

        // 6. Call gpt-4o-mini
        const prompt = `Analyze this conversation and return 1-3 behavioral tags from this predefined taxonomy:

Buying Intent Tags:
- interested-premium: Customer asking about premium/enterprise plans
- price-sensitive: Customer repeatedly asks about pricing/discounts
- ready-to-buy: Customer showing strong purchase signals
- early-stage: Customer is just browsing/exploring

Sentiment Tags:
- satisfied: Customer expressing happiness with service
- frustrated: Customer showing frustration or anger
- at-risk: Customer mentioning cancellation or competitors

Behavior Tags:
- high-engagement: Very active in conversation, multiple messages
- enterprise: Mentions team, company, bulk, multiple licenses
- returning-customer: References past purchases or interactions
- technical-user: Asks technical questions, mentions APIs/integrations

Return a JSON object containing a "tags" array of strings. Only use the exact tags listed above.

Conversation:
${chatHistory}`;

        let newTags: string[] = [];
        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${openAiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    temperature: 0,
                    max_tokens: 100,
                    response_format: { type: "json_object" },
                    messages: [
                        { role: 'user', content: prompt }
                    ]
                })
            });

            if (response.ok) {
                const result = await response.json();
                const content = JSON.parse(result.choices[0].message.content);
                newTags = (Array.isArray(content.tags) ? content.tags : [])
                    .filter((tag: unknown): tag is string => typeof tag === 'string' && ALLOWED_TAGS.has(tag));
            } else {
                console.error('[Auto-Tagger] OpenAI API error:', await response.text());
                return existingTags;
            }
        } catch (e) {
            console.error('[Auto-Tagger] Exception during OpenAI call:', e);
            return existingTags;
        }

        // 7. Parse and merge tags
        const mergedTags = Array.from(new Set([...existingTags, ...newTags]));

        // 8. Update contacts table
        const { error: updateError } = await supabase
            .from('contacts')
            .update({ tags: mergedTags })
            .eq('id', contactId);

        if (updateError) {
            console.error('[Auto-Tagger] Error updating contact tags:', updateError);
            return existingTags;
        }

        console.log(`[Auto-Tagger] Applied tags [${newTags.join(', ')}] to contact ${contactId}`);
        
        return mergedTags;

    } catch (err) {
        console.error('[Auto-Tagger] Fatal error:', err);
        return [];
    }
}

export function autoTagContactInBackground(contactId: string, conversationId: string, orgId: string): void {
    autoTagContact(contactId, conversationId, orgId).catch(err => {
        console.error('[Auto-Tagger] Background execution failed:', err);
    });
}
