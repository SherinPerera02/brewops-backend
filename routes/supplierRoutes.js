const express = require('express');
const { db } = require('../database');

const router = express.Router();

// Validation middleware for supplier order data
const validateOrderData = (req, res, next) => {
  const { tea_type, grade, quantity_kg, price_per_kg, payment_method, payment_status } = req.body;
  
  // Required field validation
  if (!tea_type || !grade || !quantity_kg || !price_per_kg) {
    return res.status(400).json({
      success: false,
      message: 'Tea type, grade, quantity, and price per kg are required'
    });
  }

  // Data type validation
  const quantity = parseFloat(quantity_kg);
  const price = parseFloat(price_per_kg);
  
  if (isNaN(quantity) || quantity <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Quantity must be a positive number'
    });
  }

  if (isNaN(price) || price <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Price per kg must be a positive number'
    });
  }

  // Validate grade
  const validGrades = ['PEKOE', 'OP', 'OPA', 'FLOWERY_PEKOE', 'FBOP', 'GBOP', 'TGFOP', 'FTGFOP', 'SFTGFOP'];
  if (!validGrades.includes(grade)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid grade. Must be one of: ' + validGrades.join(', ')
    });
  }

  // Validate payment method
  if (payment_method && !['spot', 'monthly'].includes(payment_method)) {
    return res.status(400).json({
      success: false,
      message: 'Payment method must be either "spot" or "monthly"'
    });
  }

  // Validate payment status
  if (payment_status && !['paid', 'unpaid'].includes(payment_status)) {
    return res.status(400).json({
      success: false,
      message: 'Payment status must be either "paid" or "unpaid"'
    });
  }

  next();
};

// GET /api/supplier/orders - Get all supplier orders with pagination and filtering
router.get('/orders', async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', grade = '', status = '', sort_by = 'created_at', sort_order = 'DESC' } = req.query;
    const supplier_id = 1; // Default supplier ID since authentication is removed
    
    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Validate sort parameters
    const validSortFields = ['tea_type', 'grade', 'quantity_kg', 'price_per_kg', 'status', 'created_at', 'updated_at'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = ['ASC', 'DESC'].includes(sort_order.toUpperCase()) ? sort_order.toUpperCase() : 'DESC';

    // Build WHERE clause for filtering
    let whereClause = 'WHERE so.supplier_id = ?';
    let queryParams = [supplier_id];
    
    if (search) {
      whereClause += ' AND (so.tea_type LIKE ? OR so.notes LIKE ?)';
      queryParams.push(`%${search}%`, `%${search}%`);
    }
    
    if (grade) {
      whereClause += ' AND so.grade = ?';
      queryParams.push(grade);
    }

    if (status) {
      whereClause += ' AND so.status = ?';
      queryParams.push(status);
    }

    // Get total count for pagination
    const countSql = `
      SELECT COUNT(*) as total 
      FROM supplier_orders so 
      ${whereClause}
    `;
    const countResult = await db.query(countSql, queryParams);
    const total = countResult[0].total;

    // Get orders with pagination
    const sql = `
      SELECT 
        so.id,
        so.tea_type,
        so.grade,
        so.quantity_kg,
        so.supplier_id,
        so.price_per_kg,
        so.status,
        so.payment_method,
        so.payment_status,
        so.order_date,
        so.delivery_date,
        so.notes,
        so.created_at,
        so.updated_at,
        u.name as supplier_name
      FROM supplier_orders so 
      LEFT JOIN users u ON so.supplier_id = u.id
      ${whereClause}
      ORDER BY so.${sortField} ${sortOrder}
      LIMIT ? OFFSET ?
    `;
    
    queryParams.push(limitNum, offset);
    const orders = await db.query(sql, queryParams);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum)
        }
      }
    });

  } catch (error) {
    console.error('Error fetching supplier orders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching orders',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/supplier/orders/:id - Get specific order
router.get('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supplier_id = 1; // Default supplier ID since authentication is removed
    
    // Validate ID parameter
    const orderId = parseInt(id);
    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    const sql = `
      SELECT 
        so.id,
        so.tea_type,
        so.grade,
        so.quantity_kg,
        so.supplier_id,
        so.price_per_kg,
        so.status,
        so.payment_method,
        so.payment_status,
        so.order_date,
        so.delivery_date,
        so.notes,
        so.created_at,
        so.updated_at,
        u.name as supplier_name
      FROM supplier_orders so 
      LEFT JOIN users u ON so.supplier_id = u.id
      WHERE so.id = ? AND so.supplier_id = ?
    `;
    
    const result = await db.query(sql, [orderId, supplier_id]);
    
    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: result[0]
    });

  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while fetching order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/supplier/orders - Create new order
router.post('/orders', validateOrderData, async (req, res) => {
  try {
    const { tea_type, grade, quantity_kg, price_per_kg, delivery_date, notes, payment_method, payment_status } = req.body;
    const supplier_id = 1; // Default supplier ID since authentication is removed

    const sql = `
      INSERT INTO supplier_orders (tea_type, grade, quantity_kg, supplier_id, price_per_kg, delivery_date, notes, payment_method, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const result = await db.query(sql, [
      tea_type, 
      grade, 
      quantity_kg, 
      supplier_id, 
      price_per_kg, 
      delivery_date || null, 
      notes || null,
      payment_method || 'spot',
      payment_status || 'unpaid'
    ]);
    
    // Fetch the created order with supplier info
    const newOrder = await db.query(`
      SELECT 
        so.id,
        so.tea_type,
        so.grade,
        so.quantity_kg,
        so.supplier_id,
        so.price_per_kg,
        so.status,
        so.payment_method,
        so.payment_status,
        so.order_date,
        so.delivery_date,
        so.notes,
        so.created_at,
        so.updated_at,
        u.name as supplier_name
      FROM supplier_orders so 
      LEFT JOIN users u ON so.supplier_id = u.id
      WHERE so.id = ?
    `, [result.insertId]);

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      data: newOrder[0]
    });

  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT /api/supplier/orders/:id - Update order
router.put('/orders/:id', validateOrderData, async (req, res) => {
  try {
    const { id } = req.params;
    const { tea_type, grade, quantity_kg, price_per_kg, delivery_date, notes, status, payment_method, payment_status } = req.body;
    const supplier_id = 1; // Default supplier ID since authentication is removed
    
    // Validate ID parameter
    const orderId = parseInt(id);
    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists and belongs to supplier
    const existingOrder = await db.query('SELECT id FROM supplier_orders WHERE id = ? AND supplier_id = ?', [orderId, supplier_id]);
    if (existingOrder.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Validate status if provided
    if (status) {
      const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
        });
      }
    }

    const sql = `
      UPDATE supplier_orders 
      SET tea_type = ?, grade = ?, quantity_kg = ?, price_per_kg = ?, delivery_date = ?, notes = ?, status = COALESCE(?, status), payment_method = COALESCE(?, payment_method), payment_status = COALESCE(?, payment_status)
      WHERE id = ? AND supplier_id = ?
    `;
    
    await db.query(sql, [
      tea_type, 
      grade, 
      quantity_kg, 
      price_per_kg, 
      delivery_date || null, 
      notes || null, 
      status || null, 
      payment_method || null, 
      payment_status || null, 
      orderId, 
      supplier_id
    ]);

    // Fetch the updated order with supplier info
    const updatedOrder = await db.query(`
      SELECT 
        so.id,
        so.tea_type,
        so.grade,
        so.quantity_kg,
        so.supplier_id,
        so.price_per_kg,
        so.status,
        so.payment_method,
        so.payment_status,
        so.order_date,
        so.delivery_date,
        so.notes,
        so.created_at,
        so.updated_at,
        u.name as supplier_name
      FROM supplier_orders so 
      LEFT JOIN users u ON so.supplier_id = u.id
      WHERE so.id = ?
    `, [orderId]);

    res.json({
      success: true,
      message: 'Order updated successfully',
      data: updatedOrder[0]
    });

  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// DELETE /api/supplier/orders/:id - Delete order
router.delete('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supplier_id = 1; // Default supplier ID since authentication is removed
    
    // Validate ID parameter
    const orderId = parseInt(id);
    if (isNaN(orderId) || orderId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order ID'
      });
    }

    // Check if order exists and belongs to supplier
    const existingOrder = await db.query('SELECT id, status FROM supplier_orders WHERE id = ? AND supplier_id = ?', [orderId, supplier_id]);
    if (existingOrder.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Prevent deletion of confirmed or shipped orders
    const order = existingOrder[0];
    if (['confirmed', 'processing', 'shipped', 'delivered'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete orders that are confirmed, processing, shipped, or delivered'
      });
    }

    await db.query('DELETE FROM supplier_orders WHERE id = ? AND supplier_id = ?', [orderId, supplier_id]);

    res.json({
      success: true,
      message: 'Order deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while deleting order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;