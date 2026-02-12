import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
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
  }, []);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      if (editingProduct) {
        const { error } = await supabase
          .from('inventory')
          .update(formData)
          .eq('id', editingProduct.id);
        
        if (error) throw error;
        alert('Product updated successfully!');
      } else {
        const { error } = await supabase
          .from('inventory')
          .insert([formData]);
        
        if (error) throw error;
        alert('Product added successfully!');
      }
      
      fetchProducts();
      resetForm();
    } catch (error) {
      console.error('Error saving product:', error);
      alert('Error saving product. Check console for details.');
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
        
        const headers = rows[0];
        const dataRows = rows.slice(1).filter(row => row.length > 1 && row.some(cell => cell));
        
        if (dataRows.length === 0) {
          alert('No data found in CSV file.');
          return;
        }
        
        const log = [];
        const productsToImport = [];
        
        for (const row of dataRows) {
          if (row.length < headers.length) continue;
          
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
          
          if (product.sku || product.product_name) {
            const { data: existing } = await supabase
              .from('inventory')
              .select('*')
              .eq('sku', product.sku)
              .single();
            
            if (existing && importMode === 'add') {
              const updated = {
                sellable_stock: existing.sellable_stock + product.sellable_stock,
                unusable_stock: existing.unusable_stock + product.unusable_stock,
                hold_stock: existing.hold_stock + product.hold_stock
              };
              
              await supabase
                .from('inventory')
                .update(updated)
                .eq('sku', product.sku);
              
              log.push(`✅ Updated ${product.sku}: Added stocks`);
            } else if (existing && importMode === 'replace') {
              await supabase
                .from('inventory')
                .update(product)
                .eq('sku', product.sku);
              
              log.push(`✅ Replaced ${product.sku}`);
            } else {
              productsToImport.push(product);
              log.push(`✅ New product: ${product.sku || product.product_name}`);
            }
          }
        }
        
        if (productsToImport.length > 0) {
          const { error } = await supabase
            .from('inventory')
            .insert(productsToImport);
          
          if (error) throw error;
        }
        
        setImportLog(log);
        alert(`Successfully imported ${dataRows.length} products!`);
        fetchProducts();
        setShowBulkImport(false);
      } catch (error) {
        console.error('Error importing:', error);
        alert('Error importing CSV. Check console for details.');
      }
    };
    
    reader.readAsText(file);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this product?')) return;
    
    try {
      const { error } = await supabase
        .from('inventory')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      fetchProducts();
      alert('Product deleted successfully!');
    } catch (error) {
      console.error('Error deleting:', error);
      alert('Error deleting product.');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedProducts.size === 0) {
      alert('No products selected');
      return;
    }
    
    if (!confirm(`Delete ${selectedProducts.size} selected products?`)) return;
    
    try {
      const ids = Array.from(selectedProducts);
      const { error } = await supabase
        .from('inventory')
        .delete()
        .in('id', ids);
      
      if (error) throw error;
      setSelectedProducts(new Set());
      fetchProducts();
      alert('Products deleted successfully!');
    } catch (error) {
      console.error('Error bulk deleting:', error);
      alert('Error deleting products.');
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setFormData(product);
    setShowForm(true);
  };

  const resetForm = () => {
    setFormData({
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
    setEditingProduct(null);
    setShowForm(false);
  };

  const exportToCSV = () => {
    const headers = ['Product Name', 'Local Name', 'SKU', 'Sellable Stock', 'Unusable Stock', 'Hold Stock', 'Total', 'Design', 'Color', 'Reorder Level', 'Status', 'Supplier'];
    const csvRows = [headers.join(',')];
    
    filteredProducts.forEach(p => {
      const total = p.sellable_stock + p.unusable_stock + p.hold_stock;
      const status = getStatus(p);
      const row = [
        `"${p.product_name}"`,
        `"${p.local_name}"`,
        p.sku,
        p.sellable_stock,
        p.unusable_stock,
        p.hold_stock,
        total,
        `"${p.design}"`,
        `"${p.color}"`,
        p.reorder_level,
        status,
        `"${p.supplier || ''}"`
      ];
      csvRows.push(row.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
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
      p.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.design.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.color.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesLowStock = !filterLowStock || 
      (p.sellable_stock <= p.reorder_level * 1.25);
    
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

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ margin: '0 0 5px 0', fontSize: '28px' }}>Authority of Fashion - Inventory Management</h1>
        <p style={{ margin: 0, color: '#666' }}>Track saree inventory with multi-category stock management</p>
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
          <input
            type="checkbox"
            checked={filterLowStock}
            onChange={(e) => setFilterLowStock(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <span>Low Stock Only</span>
        </label>
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={filterOnHold}
            onChange={(e) => setFilterOnHold(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <span>On Hold Only</span>
        </label>
      </div>

      {showForm && (
        <div style={{ background: '#F9FAFB', padding: '25px', borderRadius: '8px', marginBottom: '25px', border: '2px solid #E5E7EB' }}>
          <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '20px' }}>{editingProduct ? 'Edit Product' : 'Add New Product'}</h2>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Product Name *</label>
                <input
                  type="text"
                  required
                  value={formData.product_name}
                  onChange={(e) => setFormData({...formData, product_name: e.target.value})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Product Local Name *</label>
                <input
                  type="text"
                  required
                  value={formData.local_name}
                  onChange={(e) => setFormData({...formData, local_name: e.target.value})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>SKU *</label>
                <input
                  type="text"
                  required
                  value={formData.sku}
                  onChange={(e) => setFormData({...formData, sku: e.target.value})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Sellable Stock *</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={formData.sellable_stock}
                  onChange={(e) => setFormData({...formData, sellable_stock: parseInt(e.target.value) || 0})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Unusable Stock</label>
                <input
                  type="number"
                  min="0"
                  value={formData.unusable_stock}
                  onChange={(e) => setFormData({...formData, unusable_stock: parseInt(e.target.value) || 0})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Hold Stock</label>
                <input
                  type="number"
                  min="0"
                  value={formData.hold_stock}
                  onChange={(e) => setFormData({...formData, hold_stock: parseInt(e.target.value) || 0})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Design *</label>
                <input
                  type="text"
                  required
                  value={formData.design}
                  onChange={(e) => setFormData({...formData, design: e.target.value})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Color *</label>
                <input
                  type="text"
                  required
                  value={formData.color}
                  onChange={(e) => setFormData({...formData, color: e.target.value})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Reorder Level *</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={formData.reorder_level}
                  onChange={(e) => setFormData({...formData, reorder_level: parseInt(e.target.value) || 5})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '14px' }}>Supplier</label>
                <input
                  type="text"
                  value={formData.supplier}
                  onChange={(e) => setFormData({...formData, supplier: e.target.value})}
                  style={{ width: '100%', padding: '10px', border: '2px solid #E5E7EB', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>
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
                <input
                  type="radio"
                  name="importMode"
                  value="add"
                  checked={importMode === 'add'}
                  onChange={(e) => setImportMode(e.target.value)}
                  style={{ cursor: 'pointer' }}
                />
                <span><strong>ADD</strong> - Add quantities to existing stock</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={(e) => setImportMode(e.target.value)}
                  style={{ cursor: 'pointer' }}
                />
                <span><strong>REPLACE</strong> - Overwrite existing quantities</span>
              </label>
            </div>
          </div>
          
          <div>
            <label style={{ display: 'block', marginBottom: '10px', fontWeight: '500' }}>
              Upload CSV file (Product Name, Local Name, SKU, Sellable Stock, Unusable Stock, Hold Stock, Design, Color, Reorder Level, Supplier)
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleBulkImport}
              style={{ padding: '10px', border: '2px solid #BFDBFE', borderRadius: '6px', background: 'white', width: '100%' }}
            />
          </div>
          
          {importLog.length > 0 && (
            <div style={{ marginTop: '20px', background: 'white', padding: '15px', borderRadius: '6px', maxHeight: '200px', overflowY: 'auto', fontSize: '13px', fontFamily: 'monospace' }}>
              {importLog.map((log, i) => (
                <div key={i} style={{ marginBottom: '5px' }}>{log}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#6B7280' }}>Loading inventory...</div>
      ) : filteredProducts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px', color: '#6B7280' }}>
          <p style={{ fontSize: '18px', marginBottom: '10px' }}>No products yet. Click "+ Add Product" or "📦 Bulk Import" to get started!</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: '#F3F4F6' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedProducts(new Set(filteredProducts.map(p => p.id)));
                      } else {
                        setSelectedProducts(new Set());
                      }
                    }}
                    checked={selectedProducts.size === filteredProducts.length && filteredProducts.length > 0}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Product Name</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Local Name</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>SKU</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Sellable</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Unusable</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Hold</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Total</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Design</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Color</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Reorder</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Status</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Supplier</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', fontSize: '13px', color: '#374151', borderBottom: '2px solid #E5E7EB' }}>Actions</th>
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
                          if (e.target.checked) {
                            newSelected.add(product.id);
                          } else {
                            newSelected.delete(product.id);
                          }
                          setSelectedProducts(newSelected);
                        }}
                        style={{ cursor: 'pointer' }}
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
                        <button
                          onClick={() => handleEdit(product)}
                          style={{ padding: '6px 12px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(product.id)}
                          style={{ padding: '6px 12px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                        >
                          Delete
                        </button>
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
