const mysql = require('mysql2/promise');

const config = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'softora_app'
};

async function debugQuery() {
  const connection = await mysql.createConnection(config);
  
  // Simulate the exact parameters from the API
  const search = '';
  const grade = '';
  const sortField = 'created_at';
  const sortOrder = 'DESC';
  const limitNum = 50;
  const offset = 0;
  
  // Build WHERE clause for filtering (same as API)
  let whereClause = '';
  let queryParams = [];
  
  if (search) {
    whereClause += ' WHERE (i.tea_type LIKE ? OR u.name LIKE ?)';
    queryParams.push(`%${search}%`, `%${search}%`);
  }
  
  if (grade) {
    whereClause += whereClause ? ' AND i.grade = ?' : ' WHERE i.grade = ?';
    queryParams.push(grade);
  }
  
  console.log('WHERE clause:', whereClause);
  console.log('Initial queryParams:', queryParams);
  
  // The exact SQL from the API
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
      ${whereClause}
      
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
      ${search ? 'AND (so.tea_type LIKE ? OR u.name LIKE ?)' : ''}
      ${grade ? 'AND so.grade = ?' : ''}
    ) as combined_inventory
    ORDER BY ${sortField} ${sortOrder}
    LIMIT ? OFFSET ?
  `;
  
  // Build final query parameters (same as API)
  let finalQueryParams = [...queryParams];
  
  if (search) {
    finalQueryParams.push(`%${search}%`, `%${search}%`);
  }
  
  if (grade) {
    finalQueryParams.push(grade);
  }
  
  finalQueryParams.push(limitNum, offset);
  
  console.log('Final SQL:', sql);
  console.log('Final queryParams:', finalQueryParams);
  
  const [rows] = await connection.execute(sql, finalQueryParams);
  console.log('Total rows:', rows.length);
  console.log('Results:', JSON.stringify(rows, null, 2));
  
  await connection.end();
}

debugQuery().catch(console.error);