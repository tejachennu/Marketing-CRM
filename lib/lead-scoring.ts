import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export async function scoreLeadWithAI(leadId: string, orgId: string) {
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 2. Fetch lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('organization_id', orgId)
      .single();
      
    if (leadError || !lead) {
      console.error('[Lead Scoring] Error fetching lead:', leadError);
      return null;
    }

    // 3. Fetch contact
    let contact = null;
    if (lead.contact_id) {
      const { data: contactData } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', lead.contact_id)
        .single();
      contact = contactData;
    }

    // 4. Find conversation
    // A lead or contact can have several conversations; score against the most recent one
    const { data: convData } = await supabase
      .from('conversations')
      .select('id')
      .eq('lead_id', leadId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
      
    let conversationId = convData?.id;
    if (!conversationId && lead.contact_id) {
      const { data: contactConvData } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', lead.contact_id)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      conversationId = contactConvData?.id;
    }

    let message_count = 0;
    let customer_message_count = 0;
    let avg_response_hours = 0;
    let last_message_age_hours = 0;
    let has_media = false;
    let has_open_tickets = false;

    if (conversationId) {
      const { data: messages } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (messages && messages.length > 0) {
        message_count = messages.length;
        customer_message_count = messages.filter(m => m.sender_type === 'contact').length;
        has_media = messages.some(m => !!m.media_url);
        
        const lastMsg = messages[messages.length - 1];
        last_message_age_hours = (Date.now() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60);

        // rough proxy for engagement
        if (customer_message_count > 1) {
           const contactMsgs = messages.filter(m => m.sender_type === 'contact');
           let totalGap = 0;
           for (let i = 1; i < contactMsgs.length; i++) {
             totalGap += (new Date(contactMsgs[i].created_at).getTime() - new Date(contactMsgs[i-1].created_at).getTime());
           }
           avg_response_hours = (totalGap / (contactMsgs.length - 1)) / (1000 * 60 * 60);
        }
      }

      // Check open tickets
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id')
        .eq('conversation_id', conversationId)
        .neq('status', 'closed');
        
      if (tickets && tickets.length > 0) {
        has_open_tickets = true;
      }
    }

    // 7. Fetch org openai key
    const { data: orgData } = await supabase
      .from('organizations')
      .select('openai_api_key')
      .eq('id', orgId)
      .single();
      
    const openAiKey = orgData?.openai_api_key;
    
    let score = 50;
    let reasons: string[] = [];
    let recommended_priority = lead.priority || 'medium';

    const signals = {
        message_count,
        customer_message_count,
        avg_response_hours,
        last_message_age_hours,
        has_media,
        has_open_tickets,
        value: lead.value || 0,
        source: lead.source,
        priority: lead.priority,
        status: lead.status
    };

    if (!openAiKey) {
      // 8. Rule-based scoring
      if (message_count > 10) { score += 15; reasons.push("High message frequency indicates strong engagement"); }
      else if (message_count > 5) { score += 10; reasons.push("Moderate message frequency"); }
      
      if (signals.value > 10000) { score += 15; reasons.push("Deal value above average"); }
      else if (signals.value > 0) { score += 10; reasons.push("Deal has value"); }
      
      if (last_message_age_hours > 336) { score -= 20; reasons.push("Stale > 2 weeks"); }
      else if (last_message_age_hours > 168) { score -= 10; reasons.push("Stale > 1 week"); }
      
      if (signals.source === 'referral') { score += 10; reasons.push("Referral source typically converts well"); }
      if (signals.source === 'website') { score += 5; reasons.push("Website source"); }
      
      if (has_open_tickets) { score -= 5; reasons.push("Has open support issues"); }
      if (signals.priority === 'high') { score += 10; reasons.push("High priority"); }
      
      score = Math.max(0, Math.min(100, score));
    } else {
      // 9. OpenAI scoring
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
                max_tokens: 200,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: 'system',
                        content: `You are an AI lead scorer. Analyze the given signals and return a JSON object containing: "score" (integer 0-100), "reasons" (array of 2-4 short string reasons), and "recommended_priority" (string: 'low', 'medium', or 'high').`
                    },
                    {
                        role: 'user',
                        content: `Signals: ${JSON.stringify(signals)}`
                    }
                ]
            })
        });

        if (response.ok) {
            const result = await response.json();
            const content = JSON.parse(result.choices[0].message.content);
            // Never trust the model's shape: keep the defaults for anything malformed
            const aiScore = Number(content.score);
            if (Number.isFinite(aiScore)) score = Math.max(0, Math.min(100, Math.round(aiScore)));
            if (Array.isArray(content.reasons)) reasons = content.reasons.filter((r: unknown) => typeof r === 'string').slice(0, 4);
            if (['low', 'medium', 'high'].includes(content.recommended_priority)) recommended_priority = content.recommended_priority;
        } else {
            console.error('[Lead Scoring] OpenAI API error:', await response.text());
        }
      } catch (e) {
          console.error('[Lead Scoring] Exception during OpenAI call:', e);
      }
    }

    // 10. Update leads table
    const { error: updateError } = await supabase
      .from('leads')
      .update({
          ai_score: score,
          ai_score_updated_at: new Date().toISOString(),
          ai_score_reasons: reasons
      })
      .eq('id', leadId);
      
    if (updateError) {
        console.error('[Lead Scoring] Error updating lead:', updateError);
    }
    
    console.log(`[Lead Scoring] Scored lead ${leadId} with score ${score}`);

    return { score, reasons, recommended_priority };

  } catch (err) {
    console.error('[Lead Scoring] Fatal error:', err);
    return null;
  }
}

export function scoreLeadInBackground(leadId: string, orgId: string): void {
    scoreLeadWithAI(leadId, orgId).catch(err => {
        console.error('[Lead Scoring] Background execution failed:', err);
    });
}
