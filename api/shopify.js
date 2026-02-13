// api/shopify.js - CORRECTED VERSION

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, since, title, sku } = req.query;

  const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

  if (action === 'checkConnection') {
    const connected = !!(SHOPIFY_STORE_URL && SHOPIFY_ACCESS_TOKEN);
    return res.status(200).json({ connected });
  }

  if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Shopify credentials not configured' });
  }

  try {
    // Get all products from Shopify
    if (action === 'getAllProducts') {
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
      
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
    
    // Get orders
    if (action === 'getOrders') {
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
    
    // Get single product by SKU (for push)
    else if (action === 'getProductBySKU') {
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=1`;
      
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
      
      // Find product with matching SKU
      if (sku && data.products) {
        for (const product of data.products) {
          for (const variant of product.variants) {
            if (variant.sku === sku) {
              return res.status(200).json({ 
                product: product,
                variant: variant,
                inventory_item_id: variant.inventory_item_id
              });
            }
          }
        }
      }
      
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Update inventory
    else if (action === 'updateInventory') {
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
    
    // Get product by title (legacy - for backwards compatibility)
    else if (action === 'getProducts') {
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
    
    // Get locations - FIXED TYPO HERE
    else if (action === 'getLocations') {
      const url = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/locations.json`;
      
      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,  // FIXED: was 'Access-TOKEN'
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
      return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error) {
    console.error('Shopify API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
