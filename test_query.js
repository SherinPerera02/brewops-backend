const mysql = require('mysql2/promise');

const config = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'softora_app'
};

async function testQuery() {
  const connection = await mysql.createConnection(config);
  
  const sql = `
    SELECT * FROM (
      SELECT 
        i.id,
        i.tea_type,
        i.grade,
        i.quantity_kg,
        i.supplier_id,
        i.price_per_kg,
        i.manager_id,
        i.created_at,
        i.updated_at,
        u.name as supplier_name,
        m.name as manager_name,
        'inventory' as source
      FROM inventory i 
      LEFT JOIN users u ON i.supplier_id = u.id 
      LEFT JOIN users m ON i.manager_id = m.id
      
      UNION ALL
      
      SELECT 
        so.id,
        so.tea_type,
        so.grade,
        so.quantity_kg,
        so.supplier_id,
        so.price_per_kg,
        1 as manager_id,
        so.created_at,
        so.updated_at,
        u.name as supplier_name,
        'Manager' as manager_name,
        'delivered_order' as source
      FROM supplier_orders so
      LEFT JOIN users u ON so.supplier_id = u.id
      WHERE so.status = 'delivered'
    ) as combined_inventory
    ORDER BY created_at DESC
  `;
  
  const [rows] = await connection.execute(sql);
  console.log('Total rows:', rows.length);
  console.log('Results:', JSON.stringify(rows, null, 2));
  
  await connection.end();
}

testQuery().catch(console.error);