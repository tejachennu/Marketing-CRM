import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const orgId = searchParams.get('organizationId')

    if (!orgId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ articles: data || [] })
  } catch (error: any) {
    console.error('[Knowledge GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase
      .from('knowledge_base')
      .delete()
      .eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Knowledge DELETE] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient()
    const body = await request.json()
    const { organizationId, type, title, content, url } = body

    if (!organizationId) {
      return NextResponse.json({ error: 'Missing organizationId' }, { status: 400 })
    }

    if (type === 'parse_sitemap') {
      if (!url) {
        return NextResponse.json({ error: 'Missing sitemap URL' }, { status: 400 })
      }

      let targetUrl = url.trim()
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl
      }

      console.log(`[Sitemap] Fetching sitemap: ${targetUrl}`)
      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })

      if (!fetchRes.ok) {
        throw new Error(`Failed to fetch sitemap. Status code: ${fetchRes.status}`)
      }

      const xml = await fetchRes.text()
      const matches = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
      const urls = matches
        .map(m => m[1].trim())
        .filter(u => {
          if (/\.(png|jpg|jpeg|gif|pdf|xml|svg|css|js)$/i.test(u)) return false
          if (u.includes('/feed/')) return false
          return true
        })

      const uniqueUrls = Array.from(new Set(urls))
      return NextResponse.json({ urls: uniqueUrls })
    }

    if (type === 'scrape') {
      if (!url) {
        return NextResponse.json({ error: 'Missing URL' }, { status: 400 })
      }

      // Format URL to ensure it has a protocol scheme
      let targetUrl = url.trim()
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl
      }

      // Scraping web page
      console.log(`[Scraper] Fetching URL: ${targetUrl}`)
      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })

      if (!fetchRes.ok) {
        throw new Error(`Failed to fetch web page. Status code: ${fetchRes.status}`)
      }

      const html = await fetchRes.text()

      // Extract Title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
      let parsedTitle = titleMatch ? titleMatch[1].trim() : 'Scraped Article'
      // Clean up common suffix
      parsedTitle = parsedTitle.replace(/\s*-\s*Consular\s*Helpdesk.*/i, '').trim()

      // Extract body text content and clean it
      let bodyText = html
      bodyText = bodyText.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '') // Remove scripts
      bodyText = bodyText.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')   // Remove styles
      bodyText = bodyText.replace(/<header[^>]*>([\s\S]*?)<\/header>/gi, '') // Remove header
      bodyText = bodyText.replace(/<footer[^>]*>([\s\S]*?)<\/footer>/gi, '') // Remove footer
      bodyText = bodyText.replace(/<[^>]+>/g, ' ')                          // Strip HTML tags

      // Decode entities & collapse spaces
      const cleanContent = bodyText
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, ' ')
        .trim()

      if (!cleanContent || cleanContent.length < 50) {
        return NextResponse.json({ error: 'Failed to extract useful text content from page' }, { status: 400 })
      }

      // Generate AI description
      let generatedDescription = null
      const openAiKey = process.env.OPENAI_API_KEY
      if (openAiKey) {
        try {
          const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${openAiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                {
                  role: 'system',
                  content: 'You are an AI that writes short, concise, 1-2 sentence descriptions summarizing web page content for search indexes. Return ONLY the description, nothing else.'
                },
                {
                  role: 'user',
                  content: `Summarize this web page content in 1-2 sentences:\nTitle: ${parsedTitle}\nContent Preview: ${cleanContent.substring(0, 3000)}`
                }
              ],
              temperature: 0.3,
              max_tokens: 100
            })
          })
          if (aiRes.ok) {
            const aiData = await aiRes.json()
            generatedDescription = aiData.choices?.[0]?.message?.content?.trim() || null
          } else {
            console.error('[Scraper AI] OpenAI call failed with status:', aiRes.status)
          }
        } catch (aiErr) {
          console.error('[Scraper AI] Error calling OpenAI:', aiErr)
        }
      }

      // Insert article
      const { data, error } = await supabase
        .from('knowledge_base')
        .insert([{
          organization_id: organizationId,
          title: parsedTitle || targetUrl,
          content: cleanContent,
          source_url: targetUrl,
          description: generatedDescription
        }])
        .select()

      if (error) throw error
      return NextResponse.json({ article: data[0] })

    } else if (type === 'manual') {
      if (!title || !content) {
        return NextResponse.json({ error: 'Missing title or content' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('knowledge_base')
        .insert([{
          organization_id: organizationId,
          title,
          content,
          source_url: null
        }])
        .select()

      if (error) throw error
      return NextResponse.json({ article: data[0] })
    }

    return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 })
  } catch (error: any) {
    console.error('[Knowledge POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 })
  }
}
