// ONLY REPLACE THE pushToShopify FUNCTION
// Find this function in your App.jsx (around line 310) and replace it with this:

  const pushToShopify = async (product) => {
    if (!shopifyConnected) {
      alert('Shopify not connected.');
      return;
    }

    try {
      const updateResponse = await fetch('/api/shopify?action=updateInventoryBySKU', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sku: product.sku,
          product_name: product.product_name,  // Send product name for matching
          quantity: product.sellable_stock,
        }),
      });

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json();
        throw new Error(errorData.error || 'Failed to update');
      }

      return true;
    } catch (error) {
      console.error('Error pushing to Shopify:', error);
      throw error;
    }
  };
