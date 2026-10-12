import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables')
  }
  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Configure WhatsApp Commerce settings on the phone number
 * Enables/disables the native in-chat Cart and Catalog icon.
 */
export async function configureWhatsAppCommerceSettings(
  phoneNumberId: string,
  accessToken: string,
  settings: { isCartEnabled: boolean; isCatalogVisible: boolean }
) {
  const url = `https://graph.facebook.com/v25.0/${phoneNumberId}/whatsapp_commerce_settings`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      is_cart_enabled: settings.isCartEnabled,
      is_catalog_visible: settings.isCatalogVisible,
    }),
  })

  if (!res.ok) {
    const errorData = await res.json().catch(() => null)
    throw new Error(
      errorData?.error?.message || `Failed to update commerce settings: HTTP ${res.status}`
    )
  }

  return await res.json()
}

const MAX_CATALOG_PAGES = 50 // 5,000 products

/**
 * Fetch products from Meta Commerce Manager Catalog
 */
export async function fetchMetaCatalogProducts(
  catalogId: string,
  accessToken: string,
  graphVersion: string = 'v25.0'
) {
  const products: any[] = []
  let url: string | null = `https://graph.facebook.com/${graphVersion}/${catalogId}/products?fields=id,retailer_id,name,description,price,currency,image_url,url,availability,inventory&limit=100`

  // Follow Graph API paging so catalogs with more than 100 products sync completely
  for (let page = 0; url && page < MAX_CATALOG_PAGES; page++) {
    const res: Response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!res.ok) {
      const errorData = await res.json().catch(() => null)
      throw new Error(
        errorData?.error?.message || `Failed to fetch Meta Catalog products: HTTP ${res.status}`
      )
    }

    const data = await res.json()
    products.push(...(data.data || []))
    url = data.paging?.next || null
  }

  return products
}

/**
 * Sync Meta Catalog products to Supabase `commerce_products` table
 */
export async function syncMetaCatalogToDatabase(
  organizationId: string,
  catalogId: string,
  accessToken: string,
  graphVersion: string = 'v25.0'
) {
  const products = await fetchMetaCatalogProducts(catalogId, accessToken, graphVersion)
  const supabase = getSupabase()

  let syncedCount = 0
  for (const p of products) {
    // Parse price if string like "INR 500" or raw number
    let rawPrice = 0
    if (typeof p.price === 'string') {
      const match = p.price.match(/[\d.,]+/)
      if (match) rawPrice = parseFloat(match[0].replace(/,/g, ''))
    } else if (typeof p.price === 'number') {
      rawPrice = p.price
    }

    const { error } = await supabase.from('commerce_products').upsert(
      {
        organization_id: organizationId,
        retailer_id: p.retailer_id || p.id,
        title: p.name || 'Untitled Product',
        description: p.description || '',
        price: rawPrice,
        currency: p.currency || 'INR',
        image_url: p.image_url || null,
        website_url: p.url || null,
        is_available: p.availability === 'in stock',
        inventory_count: typeof p.inventory === 'number' ? p.inventory : 100,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'organization_id,retailer_id' }
    )

    if (!error) syncedCount++
  }

  return { total: products.length, synced: syncedCount }
}

/**
 * Calculates order subtotal, shipping fee, and grand total based on org rules
 */
export function calculateOrderTotals(
  items: Array<{ unit_price: number; quantity: number }>,
  rules?: {
    shippingFee?: number
    freeShippingThreshold?: number
    taxRate?: number // e.g. 0.05 for 5%
  }
) {
  const subtotal = items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)
  const threshold = rules?.freeShippingThreshold || 0
  let shippingFee = rules?.shippingFee || 0

  if (threshold > 0 && subtotal >= threshold) {
    shippingFee = 0
  }

  const taxRate = rules?.taxRate || 0
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100
  const grandTotal = Math.round((subtotal + shippingFee + taxAmount) * 100) / 100

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    shippingFee: Math.round(shippingFee * 100) / 100,
    taxAmount,
    grandTotal,
  }
}
