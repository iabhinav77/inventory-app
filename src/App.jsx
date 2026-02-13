import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const InventoryApp = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterLowStock, setFilterLowStock] = useState(false);
  const [filterOnHold, setFilterOnHold] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [importMode, setImportMode] = useState('add');
  const [importLog, setImportLog] = useState([]);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  
  const [formData, setFormData] = useState({
    product_name: '',
    local_name: '',
    sku: '',
    sellable_stock: 0,
    unusable_stock: 0,
    hold_stock: 0,
    design: '',
    color: '',
    reorder_level: 5,
    supplier: ''
  });

  useEffect(() => {
    fetchProducts();
    checkShopifyConnection();
    loadLastSyncTime();
  }, []);

  const checkShopifyConnection = async () => {
    try {
      const response = await fetch('/api/shopify?action=checkConnection');
      const data = await response.json();
      setShopifyConnected(data.connected || false);
    } catch (error) {
      console.error('Error checking Shopify connection:', error);
      setShopifyConnected(false);
    }
  };

  const loadLastSyncTime = () => {
    const savedTime = localStorage.getItem('lastShopifySync');
    if (savedTime) {
      setLastSyncTime(new Date(savedTime));
    }
  };

  const saveLastSyncTime = () => {
    const now = new Date();
    localStorage.setItem('lastShopifySync', now.toISOString());
    setLastSyncTime(now);
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      alert('Error loading inventory. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  // INITIAL SYNC: Pull all products from Shopify
  const initialSyncFromShopify = async () => {
    if (!shopifyConnected) {
      alert('Shopify not connected.');
      return;
    }

    if (!confirm('This will import ALL products from Shopify. Existing products will be updated. Continue?')) {
      return;
    }

    try {
      setSyncing(true);
      const log = [];
      
      log.push('🔍 Fetching all products from Shopify...');
      
      const response = await fetch('/api/shopify?action=getAllProducts');
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch products');
      }

      const data = await response.json();
      const shopifyProducts = data.products || [];
      
      log.push(`📦 Found ${shopifyProducts.length} products in Shopify`);

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const shopifyProduct of shopifyProducts) {
        const variant = shopifyProduct.variants[0];
        
        const productName = shopifyProduct.title;
        const sku = variant.sku || `SHOPIFY-${shopifyProduct.id}`;
        const quantity = variant.inventory_quantity || 0;

        const { data: existing } = await supabase
          .from('inventory')
          .select('*')
          .eq('sku', sku)
          .single();

        if (existing) {
          await supabase
            .from('inventory')
            .update({ 
              sellable_stock: quantity,
              product_name: productName 
            })
            .eq('sku', sku);
          
          log.push(`✅ Updated: ${productName} (${sku}) - Stock: ${quantity}`);
          updatedCount++;
        } else {
          const newProduct = {
            product_name: productName,
            local_name: productName,
            sku: sku,
            sellable_stock: quantity,
            unusable_stock: 0,
            hold_stock: 0,
            design: shopifyProduct.product_type || 'Saree',
            color: '',
            reorder_level: 5,
            supplier: ''
          };

          const { error } = await supabase
            .from('inventory')
            .insert([newProduct]);

          if (error) {
            log.push(`❌ Failed: ${productName} - ${error.message}`);
            skippedCount++;
          } else {
            log.push(`✅ Created: ${productName} (${sku}) - Stock: ${quantity}`);
            createdCount++;
          }
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      saveLastSyncTime();
      setImportLog(log);
      
      let message = `✅ Initial sync complete!\n\n`;
      message += `📥 Created: ${createdCount} products\n`;
      message += `🔄 Updated: ${updatedCount} products\n`;
      if (skippedCount > 0) {
        message += `⚠️ Skipped: ${skippedCount} products`;
      }
      
      alert(message);
      fetchProducts();
      
    } catch (error) {
      console.error('Error syncing products:', error);
      alert(`Error: ${error.message}`);
      setImportLog([`❌ Error: ${error.message}`]);
    } finally {
      setSyncing(false);
    }
  };

  // REGULAR SYNC: Pull orders and deduct inventory
  const syncOrdersFromShopify = async () => {
    if (!shopifyConnected) {
      alert('Shopify not connected.');
      return;
    }

    try {
      setSyncing(true);
      const log = [];
      
      const sinceDate = lastSyncTime 
        ? lastSyncTime.toISOString() 
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      log.push(`🔍 Fetching orders since ${new Date(sinceDate).toLocaleString()}...`);
      
      const response = await fetch(`/api/shopify?action=getOrders&since=${encodeURIComponent(sinceDate)}`);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch orders');
      }

      const data = await response.json();
      const orders = data.orders || [];
      
      log.push(`📦 Found ${orders.length} orders`);

      let processedCount = 0;
      let notFoundCount = 0;

      for (const order of orders) {
        for (const item of order.line_items) {
          const quantity = item.quantity;
          const sku = item.sku;
          const productName = item.name;

          let product = null;

          if (sku && sku.trim() !== '') {
            const { data: productData } = await supabase
              .from('inventory')
              .select('*')
              .eq('sku', sku)
              .single();
            product = productData;
          }

          if (!product && productName) {
            const { data: productData } = await supabase
              .from('inventory')
              .select('*')
              .ilike('product_name', `%${productName}%`)
              .limit(1)
              .single();
            product = productData;
          }

          if (product) {
            const newStock = Math.max(0, product.sellable_stock - quantity);
            
            await supabase
              .from('inventory')
              .update({ sellable_stock: newStock })
              .eq('id', product.id);
            
            log.push(`✅ ${product.product_name}: Sold ${quantity}, Remaining: ${newStock}`);
            processedCount++;
          } else {
            log.push(`❌ "${productName}" (SKU: ${sku || 'none'}): Not in database`);
            notFoundCount++;
          }
        }
      }

      saveLastSyncTime();
      setImportLog(log);
      
      let message = `✅ Order sync complete!\n\n`;
      message += `📥 Processed ${processedCount} items from ${orders.length} orders\n`;
      if (notFoundCount > 0) {
        message += `⚠️ ${notFoundCount} items not found`;
      }
      
      alert(message);
      fetchProducts();
      
    } catch (error) {
      console.error('Error syncing orders:', error);
      alert(`Error: ${error.message}`);
      setImportLog([`❌ Error: ${error.message}`]);
    } finally {
      setSyncing(false);
    }
  };

  // SIMPLIFIED PUSH TO SHOPIFY
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

  const bulkPushToShopify = async () => {
    if (!shopifyConnected) return;
    if (!confirm('Update ALL products in Shopify? Continue?')) return;

    try {
      setSyncing(true);
      const log = [];
      let successCount = 0;
      let failCount = 0;

      for (const product of products) {
        try {
          await pushToShopify(product);
          log.push(`✅ ${product.product_name}: ${product.sellable_stock} units`);
          successCount++;
        } catch (error) {
          log.push(`❌ ${product.product_name}: ${error.message}`);
          failCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setImportLog(log);
      alert(`✅ Success: ${successCount}\n❌ Failed: ${failCount}`);
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingProduct) {
        const { error } = await supabase.from('inventory').update(formData).eq('id', editingProduct.id);
        if (error) throw error;
        alert('Product updated!');
      } else {
        const { error } = await supabase.from('inventory').insert([formData]);
        if (error) throw error;
        alert('Product added!');
      }
      fetchProducts();
      resetForm();
    } catch (error) {
      alert('Error saving product.');
    }
  };

  const handleBulkImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const rows = text.split('\n').map(row => {
          const matches = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
          return matches ? matches.map(cell => cell.replace(/^"|"$/g, '').trim()) : [];
        });
        
        const dataRows = rows.slice(1).filter(row => row.length > 1 && row.some(cell => cell));
        const log = [];
        const productsToImport = [];
        
        for (const row of dataRows) {
          const product = {
            product_name: row[0] || '',
            local_name: row[1] || '',
            sku: row[2] || '',
            sellable_stock: parseInt(row[3]) || 0,
            unusable_stock: parseInt(row[4]) || 0,
            hold_stock: parseInt(row[5]) || 0,
            design: row[6] || '',
            color: row[7] || '',
            reorder_level: parseInt(row[8]) || 5,
            supplier: row[9] || ''
          };
          
          if (product.sku) {
            const { data: existing } = await supabase.from('inventory').select('*').eq('sku', product.sku).single();
            
            if (existing && importMode === 'add') {
              await supabase.from('inventory').update({
                sellable_stock: existing.sellable_stock + product.sellable_stock
              }).eq('sku', product.sku);
              log.push(`✅ Updated ${product.sku}`);
            } else if (!existing) {
              productsToImport.push(product);
              log.push(`✅ New: ${product.sku}`);
            }
          }
        }
        
        if (productsToImport.length > 0) {
          await supabase.from('inventory').insert(productsToImport);
        }
        
        setImportLog(log);
        alert(`Imported ${dataRows.length} products!`);
        fetchProducts();
        setShowBulkImport(false);
      } catch (error) {
        alert('Error importing CSV.');
      }
    };
    reader.readAsText(file);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this product?')) return;
    try {
      await supabase.from('inventory').delete().eq('id', id);
      fetchProducts();
      alert('Deleted!');
    } catch (error) {
      alert('Error deleting.');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProducts.size === 0) return;
    if (!confirm(`Delete ${selectedProducts.size} products?`)) return;
    try {
      await supabase.from('inventory').delete().in('id', Array.from(selectedProducts));
      setSelectedProducts(new Set());
      fetchProducts();
      alert('Deleted!');
    } catch (error) {
      alert('Error deleting.');
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setFormData(product);
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
      product_name: '', local_name: '', sku: '', sellable_stock: 0,
      unusable_stock: 0, hold_stock: 0, design: '', color: '',
      reorder_level: 5, supplier: ''
    });
    setEditingProduct(null);
    setShowForm(false);
  };

  const exportToCSV = () => {
    const headers = ['Product Name', 'Local Name', 'SKU', 'Sellable Stock', 'Unusable Stock', 'Hold Stock', 'Total', 'Design', 'Color', 'Reorder Level', 'Status', 'Supplier'];
    const csvRows = [headers.join(',')];
    
    filteredProducts.forEach(p => {
      const total = p.sellable_stock + p.unusable_stock + p.hold_stock;
      const status = getStatus(p);
      csvRows.push([
        `"${p.product_name}"`, `"${p.local_name}"`, p.sku,
        p.sellable_stock, p.unusable_stock, p.hold_stock, total,
        `"${p.design}"`, `"${p.color}"`, p.reorder_level, status, `"${p.supplier || ''}"`
      ].join(','));
    });
    
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const getStatus = (product) => {
    if (product.hold_stock > 0) return '🔵 ON HOLD';
    if (product.sellable_stock <= product.reorder_level) return '🔴 CRITICAL';
    if (product.sellable_stock <= product.reorder_level * 1.25) return '🟡 WARNING';
    return '🟢 GOOD';
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = 
      p.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.local_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLowStock = !filterLowStock || (p.sellable_stock <= p.reorder_level * 1.25);
    const matchesOnHold = !filterOnHold || p.hold_stock > 0;
    return matchesSearch && matchesLowStock && matchesOnHold;
  });

  const stats = {
    total: products.length,
    critical: products.filter(p => p.hold_stock === 0 && p.sellable_stock <= p.reorder_level).length,
    warning: products.filter(p => p.hold_stock === 0 && p.sellable_stock > p.reorder_level && p.sellable_stock <= p.reorder_level * 1.25).length,
    onHold: products.filter(p => p.hold_stock > 0).length,
    sellableUnits: products.reduce((sum, p) => sum + p.sellable_stock, 0)
  };

  const formatTimeSince = (date) => {
    if (!date) return 'Never';
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 5px 0', fontSize: '28px' }}>Authority of Fashion - Inventory Management</h1>
        <p style={{ margin: 0, color: '#666' }}>Track saree inventory with multi-category stock management</p>
        {shopifyConnected && (
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '15px', fontSize: '14px' }}>
            <span style={{ color: '#059669', fontWeight: '500' }}>✓ Shopify Connected</span>
            <span style={{ color: '#666' }}>Last synced: {formatTimeSince(lastSyncTime)}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '15px', marginBottom: '25px' }}>
        <div style={{ padding: '20px', background: '#EFF6FF', borderRadius: '8px' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#1E40AF' }}>{stats.total}</div>
          <div style={{ color: '#1E40AF', marginTop: '5px' }}>Total Products</div>
        </div>
        <div style={{ padding: '20px', background: '#FEF2F2', borderRadius: '8px' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#DC2626' }}>{stats.critical}</div>
          <div style={{ color: '#DC2626', marginTop: '5px' }}>🔴 Critical Stock</div>
        </div>
        <div style={{ padding: '20px', background: '#FFFBEB', borderRadius: '8px' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#D97706' }}>{stats.warning}</div>
          <div style={{ color: '#D97706', marginTop: '5px' }}>🟡 Warning Level</div>
        </div>
        <div style={{ padding: '20px', background: '#EFF6FF', borderRadius: '8px' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#2563EB' }}>{stats.onHold}</div>
          <div style={{ color: '#2563EB', marginTop: '5px' }}>🔵 On Hold</div>
        </div>
        <div style={{ padding: '20px', background: '#F3E8FF', borderRadius: '8px' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#7C3AED' }}>{stats.sellableUnits}</div>
          <div style={{ color: '#7C3AED', marginTop: '5px' }}>Sellable Units</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {showForm ? (
          <button onClick={resetForm} style={{ padding: '10px 20px', background: '#6B7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
            ✕ Cancel
          </button>
        ) : (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: '#7C3AED', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
            + Add Product
          </button>
        )}
        
        <button onClick={() => setShowBulkImport(!showBulkImport)} style={{ padding: '10px 20px', background: '#0891B2', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
          📦 Bulk Import
        </button>

        {shopifyConnected && (
          <>
            {products.length === 0 ? (
              <button 
                onClick={initialSyncFromShopify} 
                disabled={syncing}
                style={{ padding: '10px 20px', background: syncing ? '#9CA3AF' : '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: syncing ? 'not-allowed' : 'pointer', fontWeight: '500' }}
              >
                {syncing ? '⏳ Syncing...' : '⬇️ Initial Sync (Import All Products)'}
              </button>
            ) : (
              <>
                <button 
                  onClick={syncOrdersFromShopify} 
                  disabled={syncing}
                  style={{ padding: '10px 20px', background: syncing ? '#9CA3AF' : '#2563EB', color: 'white', border: 'none', borderRadius: '6px', cursor: syncing ? 'not-allowed' : 'pointer', fontWeight: '500' }}
                >
                  {syncing ? '⏳ Syncing...' : '🔄 Sync Orders'}
                </button>
                
                <button 
                  onClick={bulkPushToShopify} 
                  disabled={syncing}
                  style={{ padding: '10px 20px', background: syncing ? '#9CA3AF' : '#7C3AED', color: 'white', border: 'none', borderRadius: '6px', cursor: syncing ? 'not-allowed' : 'pointer', fontWeight: '500' }}
                >
                  {syncing ? '⏳ Pushing...' : '↗️ Push to Shopify'}
                </button>
              </>
            )}
          </>
        )}
        
        <button onClick={exportToCSV} style={{ padding: '10px 20px', background: 'white', color: '#374151', border: '2px solid #E5E7EB', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
          ↓ Export CSV
        </button>
        
        <button onClick={fetchProducts} style={{ padding: '10px 20px', background: 'white', color: '#374151', border: '2px solid #E5E7EB', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
          🔄 Refresh
        </button>

        {selectedProducts.size > 0 && (
          <button onClick={handleBulkDelete} style={{ padding: '10px 20px', background: '#DC2626', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}>
            🗑️ Delete ({selectedProducts.size})
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search products..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ flex: 1, minWidth: '200px', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
        />
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={filterLowStock} onChange={(e) => setFilterLowStock(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
          <span>Low Stock Only</span>
        </label>
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={filterOnHold} onChange={(e) => setFilterOnHold(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
          <span>On Hold Only</span>
        </label>
      </div>

      {showForm && (
        <div style={{ background: '#F9FAFB', padding: '25px', borderRadius: '8px', marginBottom: '25px', border: '2px solid #E5E7EB' }}>
          <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '20px' }}>{editingProduct ? 'Edit Product' : 'Add New Product'}</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px' }}>
              {['product_name', 'local_name', 'sku'].map(field => (
                <div key={field}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>
                    {field.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData[field]}
                    onChange={(e) => setFormData({...formData, [field]: e.target.value})}
                    style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                  />
                </div>
              ))}
              
              {['sellable_stock', 'unusable_stock', 'hold_stock', 'reorder_level'].map(field => (
                <div key={field}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>
                    {field.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} *
                  </label>
                  <input
                    type="number"
                    required={field === 'sellable_stock' || field === 'reorder_level'}
                    min="0"
                    value={formData[field]}
                    onChange={(e) => setFormData({...formData, [field]: parseInt(e.target.value) || 0})}
                    style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                  />
                </div>
              ))}
              
              {['design', 'color', 'supplier'].map(field => (
                <div key={field}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>
                    {field.charAt(0).toUpperCase() + field.slice(1)} {field !== 'supplier' && '*'}
                  </label>
                  <input
                    type="text"
                    required={field !== 'supplier'}
                    value={formData[field]}
                    onChange={(e) => setFormData({...formData, [field]: e.target.value})}
                    style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                  />
                </div>
              ))}
            </div>
            
            <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
              <button type="submit" style={{ padding: '12px 30px', background: '#7C3AED', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                {editingProduct ? 'Update Product' : 'Add Product'}
              </button>
              <button type="button" onClick={resetForm} style={{ padding: '12px 30px', background: 'white', color: '#374151', border: '2px solid #E5E7EB', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {showBulkImport && (
        <div style={{ background: '#EFF6FF', padding: '25px', borderRadius: '8px', marginBottom: '25px', border: '2px solid #BFDBFE' }}>
          <h2 style={{ marginTop: 0, marginBottom: '15px', fontSize: '20px', color: '#1E40AF' }}>📦 Bulk Import from CSV</h2>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontWeight: '500', marginBottom: '10px', display: 'block' }}>Import Mode:</label>
            <div style={{ display: 'flex', gap: '15px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="importMode" value="add" checked={importMode === 'add'} onChange={(e) => setImportMode(e.target.value)} />
                <span><strong>ADD</strong> - Add to existing</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="importMode" value="replace" checked={importMode === 'replace'} onChange={(e) => setImportMode(e.target.value)} />
                <span><strong>REPLACE</strong> - Overwrite</span>
              </label>
            </div>
          </div>
          <input type="file" accept=".csv" onChange={handleBulkImport} style={{ padding: '10px', border: '2px solid #BFDBFE', borderRadius: '6px', background: 'white', width: '100%' }} />
          {importLog.length > 0 && (
            <div style={{ marginTop: '20px', background: 'white', padding: '15px', borderRadius: '6px', maxHeight: '200px', overflowY: 'auto', fontSize: '13px', fontFamily: 'monospace' }}>
              {importLog.map((log, i) => <div key={i} style={{ marginBottom: '5px' }}>{log}</div>)}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#6B7280' }}>Loading...</div>
      ) : filteredProducts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#6B7280' }}>
          <p style={{ fontSize: '18px' }}>No products yet. {products.length === 0 ? 'Click "Initial Sync" to import from Shopify!' : 'Try adjusting your filters.'}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: '#F3F4F6' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>
                  <input type="checkbox" onChange={(e) => e.target.checked ? setSelectedProducts(new Set(filteredProducts.map(p => p.id))) : setSelectedProducts(new Set())} checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0} />
                </th>
                {['Product Name', 'Local Name', 'SKU', 'Sellable', 'Unusable', 'Hold', 'Total', 'Design', 'Color', 'Reorder', 'Status', 'Supplier', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px', textAlign: h.includes('Sellable') || h.includes('Total') ? 'center' : 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const total = product.sellable_stock + product.unusable_stock + product.hold_stock;
                const status = getStatus(product);
                
                return (
                  <tr key={product.id} style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <td style={{ padding: '12px' }}>
                      <input
                        type="checkbox"
                        checked={selectedProducts.has(product.id)}
                        onChange={(e) => {
                          const newSelected = new Set(selectedProducts);
                          e.target.checked ? newSelected.add(product.id) : newSelected.delete(product.id);
                          setSelectedProducts(newSelected);
                        }}
                      />
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{product.product_name}</td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{product.local_name}</td>
                    <td style={{ padding: '12px', fontSize: '14px', fontFamily: 'monospace' }}>{product.sku}</td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', fontWeight: '600' }}>{product.sellable_stock}</td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#6B7280' }}>{product.unusable_stock}</td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: '#2563EB' }}>{product.hold_stock}</td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', fontWeight: '600' }}>{total}</td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{product.design}</td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>{product.color}</td>
                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>{product.reorder_level}</td>
                    <td style={{ padding: '12px', fontSize: '13px', fontWeight: '600' }}>{status}</td>
                    <td style={{ padding: '12px', fontSize: '14px', color: '#6B7280' }}>{product.supplier || '-'}</td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button onClick={() => handleEdit(product)} style={{ padding: '6px 12px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Edit</button>
                        <button onClick={() => handleDelete(product.id)} style={{ padding: '6px 12px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default InventoryApp;
