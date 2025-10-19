const express = require("express");
const router = express.Router();
const { db } = require("../database");

// Validation middleware for manager inventory payloads

const validateInventoryData = (req, res, next) => {
  // Accept either manager-style `quantity_kg` or simple `quantity` from other clients
  const rawQty = req.body.quantity_kg ?? req.body.quantity;
  const errors = [];

  // Validate quantity (required). Allow both names, but normalize below.
  const quantity = parseFloat(rawQty);
  if (
    rawQty === undefined ||
    rawQty === null ||
    isNaN(quantity) ||
    quantity <= 0
  ) {
    errors.push("Quantity must be a positive number");
  } else if (quantity > 999999.99) {
    errors.push("Quantity cannot exceed 999,999.99 kg");
  }

  // Validate supplier_id if provided (optional)
  if (req.body.supplier_id) {
    const supplierId = parseInt(req.body.supplier_id);
    if (isNaN(supplierId) || supplierId <= 0) {
      errors.push("Supplier ID must be a positive integer");
    }
  }

  if (errors.length > 0) {
    // Debug log to help trace unexpected validation failures
    console.error("Manager inventory validation failed", {
      path: req.path,
      method: req.method,
      body: req.body,
      errors,
    });
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: errors,
    });
  }

  // Normalize quantity for downstream controllers (provide both names)
  req.body.quantity_kg = parseFloat(quantity);
  req.body.quantity = req.body.quantity_kg;
  if (req.body.supplier_id)
    req.body.supplier_id = parseInt(req.body.supplier_id);

  next();
};

// GET /api/manager/inventory - Delegate to inventoryController.getInventories
router.get("/inventory", async (req, res) => {
  try {
    const mod = await import("../controllers/inventoryController.js");
    return mod.getInventories(req, res);
  } catch (err) {
    console.error("Failed to delegate getInventories:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /api/manager/inventory/stats - Get inventory statistics
router.get("/inventory/stats", async (req, res) => {
  try {
    // Combine basic counts from the simple inventory table with delivered supplier orders
    const statsQuery = `
      SELECT
        (SELECT COUNT(*) FROM inventory) + (SELECT COUNT(*) FROM supplier_orders WHERE status='delivered') as total_items,
        (SELECT IFNULL(SUM(quantity),0) FROM inventory) + (SELECT IFNULL(SUM(quantity_kg),0) FROM supplier_orders WHERE status='delivered') as total_quantity,
        NULL as avg_price,
        NULL as min_price,
        NULL as max_price
    `;

    const stats = await db.query(statsQuery);

    // Use supplier_orders for grade and supplier breakdowns (inventory rows are simple and lack grade/supplier)
    const gradeStats = await db.query(`
      SELECT
        grade,
        COUNT(*) as count,
        SUM(quantity_kg) as total_quantity,
        AVG(price_per_kg) as avg_price
      FROM supplier_orders
      WHERE status = 'delivered' AND grade IS NOT NULL
      GROUP BY grade
      ORDER BY count DESC
    `);

    const supplierStats = await db.query(`
      SELECT
        u.name as supplier_name,
        COUNT(so.id) as item_count,
        SUM(so.quantity_kg) as total_quantity,
        AVG(so.price_per_kg) as avg_price
      FROM supplier_orders so
      LEFT JOIN users u ON so.supplier_id = u.id
      WHERE so.status = 'delivered'
      GROUP BY so.supplier_id, u.name
      ORDER BY item_count DESC
    `);

    res.json({
      success: true,
      data: {
        overview: stats[0],
        by_grade: gradeStats,
        by_supplier: supplierStats,
      },
    });
  } catch (error) {
    console.error("Error fetching inventory statistics:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching inventory statistics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// GET /api/manager/inventory/analytics - Get comprehensive analytics data for charts
router.get("/inventory/analytics", async (req, res) => {
  try {
    // Combined inventory and delivered orders analytics
    // Map the simple `inventory` columns into the richer analytics shape expected by frontend
    const combinedQuery = `
      SELECT
        combined_inventory.tea_type,
        combined_inventory.grade,
        combined_inventory.quantity_kg,
        combined_inventory.price_per_kg,
        combined_inventory.supplier_name,
        combined_inventory.manager_name,
        combined_inventory.created_at,
        combined_inventory.source
      FROM (
        SELECT
          NULL as tea_type,
          NULL as grade,
          i.quantity as quantity_kg,
          0.00 as price_per_kg,
          NULL as supplier_name,
          NULL as manager_name,
          i.createdAt as created_at,
          'inventory' as source
        FROM inventory i

        UNION ALL

        SELECT
          so.tea_type,
          so.grade,
          so.quantity_kg,
          so.price_per_kg,
          u.name as supplier_name,
          m.name as manager_name,
          so.created_at,
          'delivered_order' as source
        FROM supplier_orders so
        LEFT JOIN users u ON so.supplier_id = u.id
        LEFT JOIN users m ON so.manager_id = m.id
        WHERE so.status = 'delivered'
      ) as combined_inventory
      ORDER BY combined_inventory.created_at DESC
    `;

    const allData = await db.query(combinedQuery);

    // Grade distribution
    const gradeDistribution = {};
    allData.forEach((item) => {
      if (!gradeDistribution[item.grade]) {
        gradeDistribution[item.grade] = { count: 0, quantity: 0, value: 0 };
      }
      gradeDistribution[item.grade].count += 1;
      gradeDistribution[item.grade].quantity += parseFloat(item.quantity_kg);
      gradeDistribution[item.grade].value +=
        parseFloat(item.quantity_kg) * parseFloat(item.price_per_kg);
    });

    // Source distribution (inventory vs delivered orders)
    const sourceDistribution = {};
    allData.forEach((item) => {
      if (!sourceDistribution[item.source]) {
        sourceDistribution[item.source] = { count: 0, quantity: 0, value: 0 };
      }
      sourceDistribution[item.source].count += 1;
      sourceDistribution[item.source].quantity += parseFloat(item.quantity_kg);
      sourceDistribution[item.source].value +=
        parseFloat(item.quantity_kg) * parseFloat(item.price_per_kg);
    });

    // Supplier performance
    const supplierPerformance = {};
    allData.forEach((item) => {
      const supplier = item.supplier_name || "Unknown";
      if (!supplierPerformance[supplier]) {
        supplierPerformance[supplier] = {
          count: 0,
          quantity: 0,
          value: 0,
          avgPrice: 0,
        };
      }
      supplierPerformance[supplier].count += 1;
      supplierPerformance[supplier].quantity += parseFloat(item.quantity_kg);
      supplierPerformance[supplier].value +=
        parseFloat(item.quantity_kg) * parseFloat(item.price_per_kg);
    });

    // Calculate average prices for suppliers
    Object.keys(supplierPerformance).forEach((supplier) => {
      supplierPerformance[supplier].avgPrice =
        supplierPerformance[supplier].value /
        supplierPerformance[supplier].quantity;
    });

    // Monthly trends (last 12 months)
    const monthlyTrends = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = date.toISOString().substring(0, 7); // YYYY-MM format
      monthlyTrends[monthKey] = { count: 0, quantity: 0, value: 0 };
    }

    allData.forEach((item) => {
      const monthKey = item.created_at.toISOString().substring(0, 7);
      if (monthlyTrends[monthKey]) {
        monthlyTrends[monthKey].count += 1;
        monthlyTrends[monthKey].quantity += parseFloat(item.quantity_kg);
        monthlyTrends[monthKey].value +=
          parseFloat(item.quantity_kg) * parseFloat(item.price_per_kg);
      }
    });

    // Tea type distribution
    const teaTypeDistribution = {};
    allData.forEach((item) => {
      if (!teaTypeDistribution[item.tea_type]) {
        teaTypeDistribution[item.tea_type] = {
          count: 0,
          quantity: 0,
          value: 0,
        };
      }
      teaTypeDistribution[item.tea_type].count += 1;
      teaTypeDistribution[item.tea_type].quantity += parseFloat(
        item.quantity_kg
      );
      teaTypeDistribution[item.tea_type].value +=
        parseFloat(item.quantity_kg) * parseFloat(item.price_per_kg);
    });

    // Summary statistics
    const totalItems = allData.length;
    const totalQuantity = allData.reduce(
      (sum, item) => sum + parseFloat(item.quantity_kg),
      0
    );
    const totalValue = allData.reduce(
      (sum, item) =>
        sum + parseFloat(item.quantity_kg) * parseFloat(item.price_per_kg),
      0
    );
    const avgPrice = totalValue / totalQuantity;

    res.json({
      success: true,
      data: {
        summary: {
          totalItems,
          totalQuantity,
          totalValue,
          avgPrice,
          inventoryItems: allData.filter((item) => item.source === "inventory")
            .length,
          deliveredOrders: allData.filter(
            (item) => item.source === "delivered_order"
          ).length,
        },
        gradeDistribution: Object.entries(gradeDistribution).map(
          ([grade, data]) => ({
            grade,
            ...data,
          })
        ),
        sourceDistribution: Object.entries(sourceDistribution).map(
          ([source, data]) => ({
            source:
              source === "delivered_order" ? "Delivered Orders" : "Inventory",
            ...data,
          })
        ),
        supplierPerformance: Object.entries(supplierPerformance)
          .map(([supplier, data]) => ({
            supplier,
            ...data,
          }))
          .sort((a, b) => b.value - a.value),
        monthlyTrends: Object.entries(monthlyTrends).map(([month, data]) => ({
          month,
          ...data,
        })),
        teaTypeDistribution: Object.entries(teaTypeDistribution)
          .map(([teaType, data]) => ({
            teaType,
            ...data,
          }))
          .sort((a, b) => b.value - a.value),
      },
    });
  } catch (error) {
    console.error("Error fetching inventory analytics:", error);
    console.error("SQL Error details:", error.sql);
    console.error("Error code:", error.code);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching inventory analytics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
      errorCode: error.code,
    });
  }
});

// GET /api/manager/inventory/report - Generate downloadable report data
router.get("/inventory/report", async (req, res) => {
  try {
    const { format = "json", startDate, endDate, grade, source } = req.query;

    let whereConditions = [];
    let queryParams = [];

    // Build dynamic WHERE clause based on filters
    if (startDate) {
      whereConditions.push("combined_inventory.created_at >= ?");
      queryParams.push(startDate);
    }

    if (endDate) {
      whereConditions.push("combined_inventory.created_at <= ?");
      queryParams.push(endDate);
    }

    if (grade) {
      whereConditions.push("combined_inventory.grade = ?");
      queryParams.push(grade);
    }

    if (source) {
      whereConditions.push("combined_inventory.source = ?");
      queryParams.push(
        source === "delivered_orders" ? "delivered_order" : source
      );
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const reportQuery = `
      SELECT
        combined_inventory.quantity_kg,
        combined_inventory.manager_name,
        combined_inventory.created_at,
        combined_inventory.source,
        (combined_inventory.quantity_kg * combined_inventory.price_per_kg) as total_value
      FROM (
        -- Map simple inventory table into report columns
        SELECT
          NULL as tea_type,
          NULL as grade,
          i.quantity as quantity_kg,
          0.00 as price_per_kg,
          NULL as supplier_name,
          NULL as manager_name,
          i.createdAt as created_at,
          'inventory' as source
        FROM inventory i

        UNION ALL

        SELECT
          so.tea_type,
          so.grade,
          so.quantity_kg,
          so.price_per_kg,
          u.name as supplier_name,
          m.name as manager_name,
          so.created_at,
          'delivered_order' as source
        FROM supplier_orders so
        LEFT JOIN users u ON so.supplier_id = u.id
        LEFT JOIN users m ON so.manager_id = m.id
        WHERE so.status = 'delivered'
      ) as combined_inventory
      ${whereClause}
      ORDER BY combined_inventory.created_at DESC
    `;

    const reportData = await db.query(reportQuery, queryParams);

    // Calculate summary statistics
    const summary = {
      totalItems: reportData.length,
      totalQuantity: reportData.reduce(
        (sum, item) => sum + parseFloat(item.quantity_kg),
        0
      ),
      totalValue: reportData.reduce(
        (sum, item) => sum + parseFloat(item.total_value),
        0
      ),
      avgPrice: 0,
      dateRange: {
        from: startDate || "All time",
        to: endDate || "Present",
      },
      filters: {
        grade: grade || "All grades",
        source: source || "All sources",
      },
    };

    if (summary.totalQuantity > 0) {
      summary.avgPrice = summary.totalValue / summary.totalQuantity;
    }

    res.json({
      success: true,
      data: {
        summary,
        items: reportData,
        generatedAt: new Date().toISOString(),
        format,
      },
    });
  } catch (error) {
    console.error("Error generating inventory report:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while generating inventory report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// GET /api/manager/inventory/:id - Get specific inventory item
router.get("/inventory/:id", async (req, res) => {
  try {
    const mod = await import("../controllers/inventoryController.js");
    return mod.getInventoryById(req, res);
  } catch (err) {
    console.error("Failed to delegate getInventoryById:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /api/manager/inventory - Create new inventory item
// POST /api/manager/inventory - Delegate to inventoryController.createInventory
router.post("/inventory", validateInventoryData, async (req, res) => {
  try {
    // Map manager payload to simple inventory payload
    const { quantity_kg } = req.body;

    // Build a new request body expected by createInventory
    req.body = { quantity: quantity_kg };

    const mod = await import("../controllers/inventoryController.js");
    return mod.createInventory(req, res);
  } catch (err) {
    console.error("Failed to delegate createInventory:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PUT /api/manager/inventory/:id - Update inventory item
router.put("/inventory/:id", validateInventoryData, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity_kg, inventoryid } = req.body;

    // Validate ID parameter
    const itemId = parseInt(id);
    if (isNaN(itemId) || itemId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid inventory ID",
      });
    }

    // Check if inventory item exists
    const existingItem = await db.query(
      "SELECT id, inventoryid FROM inventory WHERE id = ?",
      [itemId]
    );
    if (existingItem.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Inventory item not found",
      });
    }

    // Map to simple controller payload. If no inventoryid provided, keep existing.
    req.body = {
      inventoryid: inventoryid || existingItem[0].inventoryid,
      quantity: quantity_kg,
    };

    const mod = await import("../controllers/inventoryController.js");
    return mod.updateInventory(req, res);
  } catch (error) {
    console.error("Error updating inventory item:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while updating inventory item",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// GET /api/manager/suppliers - Get active suppliers for dropdown
router.get("/suppliers", async (req, res) => {
  try {
    const suppliers = await db.query(`
      SELECT id, name, email
      FROM users
      WHERE role = 'supplier' AND status = 'active'
      ORDER BY name ASC
    `);

    res.json({
      success: true,
      data: suppliers,
    });
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching suppliers",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// GET /api/manager/users - Get all staff and managers
router.get("/users", async (req, res) => {
  try {
    console.log("Fetching users from database...");
    const users = await db.query(`
      SELECT id, name, email, role, status
      FROM users
      ORDER BY role ASC, name ASC
    `);

    console.log(
      `Found ${users.length} users:`,
      users.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        status: u.status,
      }))
    );

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Test route to verify endpoint registration
router.get("/inventory/test-update-price", async (req, res) => {
  res.json({
    success: true,
    message: "Update price endpoint is registered and working!",
    availableEndpoint: "POST /api/manager/inventory/update-price",
  });
});

// GET /api/manager/production - Delegate to productionController.getProductions
router.get("/production", async (req, res) => {
  try {
    const mod = await import("../controllers/productionController.js");
    return mod.getProductions(req, res);
  } catch (err) {
    console.error("Failed to delegate getProductions:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST /api/manager/production - Delegate to productionController.createProduction
router.post("/production", async (req, res) => {
  try {
    const mod = await import("../controllers/productionController.js");
    return mod.createProduction(req, res);
  } catch (err) {
    console.error("Failed to delegate createProduction:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Test route to check production table
router.get("/production-test", async (req, res) => {
  try {
    const db = require("../database").db;

    // Test if table exists and get structure
    const tableInfo = await db.query("DESCRIBE production_data");

    // Test if we can get data
    const productionData = await db.getProductionData();

    res.json({
      success: true,
      tableStructure: tableInfo,
      dataCount: productionData.length,
      sampleData: productionData.slice(0, 3),
    });
  } catch (error) {
    console.error("Production test error:", error);
    res.status(500).json({
      success: false,
      message: "Error testing production table",
      error: error.message,
    });
  }
});

module.exports = router;
