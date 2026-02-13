// api/shopify.js - SIMPLIFIED VERSION

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action, since } = req.query;

  const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
  const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-01';

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
        return res.status(response.status).json({ error: `Shopify error: ${errorText}` });
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
        return res.status(response.status).json({ error: `Shopify error: ${errorText}` });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }
    
    // SIMPLIFIED: Update inventory by SKU (all in one call)
    else if (action === 'updateInventoryBySKU') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { sku, quantity } = body;

      // Step 1: Get ALL products and find the one with matching SKU
      const productsUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/products.json?limit=250`;
      
      const productsResponse = await fetch(productsUrl, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!productsResponse.ok) {
        const errorText = await productsResponse.text();
        return res.status(productsResponse.status).json({ error: `Failed to get products: ${errorText}` });
      }

      const productsData = await productsResponse.json();
      
      // Find product with matching SKU
      let inventoryItemId = null;
      for (const product of productsData.products || []) {
        for (const variant of product.variants || []) {
          if (variant.sku === sku) {
            inventoryItemId = variant.inventory_item_id;
            break;
          }
        }
        if (inventoryItemId) break;
      }

      if (!inventoryItemId) {
        return res.status(404).json({ error: `Product with SKU ${sku} not found in Shopify` });
      }

      // Step 2: Get location
      const locationsUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/locations.json`;
      
      const locationsResponse = await fetch(locationsUrl, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!locationsResponse.ok) {
        const errorText = await locationsResponse.text();
        return res.status(locationsResponse.status).json({ error: `Failed to get locations: ${errorText}` });
      }

      const locationsData = await locationsResponse.json();
      const locationId = locationsData.locations?.[0]?.id;

      if (!locationId) {
        return res.status(404).json({ error: 'No location found in Shopify' });
      }

      // Step 3: Update inventory
      const updateUrl = `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`;
      
      const updateResponse = await fetch(updateUrl, {
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

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        return res.status(updateResponse.status).json({ error: `Failed to update inventory: ${errorText}` });
      }

      const updateData = await updateResponse.json();
      return res.status(200).json({ 
        success: true, 
        sku: sku, 
        quantity: quantity,
        data: updateData 
      });
    }
    else {
      return res.status(400).json({ error: 'Invalid action. Valid: getAllProducts, getOrders, updateInventoryBySKU, checkConnection' });
    }
  } catch (error) {
    console.error('Shopify API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
