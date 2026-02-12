// api/shopify.js - Vercel Serverless Function for Shopify API

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, since, title } = req.query;

  const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

  // Check connection endpoint
  if (action === 'checkConnection') {
    const connected = !!(SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN);
    return res.status(200).json({ connected });
  }

  if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) {
    return res.status(500).json({ 
      error: 'Shopify credentials not configured. Add SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN, and SHOPIFY_API_VERSION to Vercel environment variables.'
    });
  }

  try {
    if (action === 'getOrders') {
      // Fetch orders from Shopify
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/orders.json?status=any&created_at_min=${since}&limit=250`;
      
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return res.status(200).json(data);
    } 
    else if (action === 'updateInventory') {
      // Update inventory in Shopify
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { locationId, inventoryItemId, quantity } = body;

      const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          location_id: locationId,
          inventory_item_id: inventoryItemId,
          available: quantity,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return res.status(200).json(data);
    }
    else if (action === 'getProducts') {
      // Get products from Shopify
      let url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?fields=id,variants&limit=1`;
      
      if (title) {
        url += `&title=${encodeURIComponent(title)}`;
      }

      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return res.status(200).json(data);
    }
    else if (action === 'getLocations') {
      // Get Shopify locations
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/locations.json`;
      
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      return res.status(200).json(data);
    }
    else {
      return res.status(400).json({ 
        error: 'Invalid action. Valid actions: getOrders, getProducts, getLocations, updateInventory, checkConnection' 
      });
    }
  } catch (error) {
    console.error('Shopify API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
