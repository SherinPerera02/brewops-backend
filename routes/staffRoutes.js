const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../database");
const SupplierController = require("../controllers/supplierController");
const SupplierModel = require("../models/supplierModel");

const router = express.Router();

// Get comprehensive dashboard analytics
router.get("/dashboard-analytics", async (req, res) => {
  try {
    // Get supply records statistics
    const [supplyRecords] = await pool.execute(`
      SELECT 
        COUNT(*) as total_supplies,
        SUM(quantity_kg) as total_quantity,
        SUM(total_payment) as total_value,
        AVG(unit_price) as avg_unit_price,
        COUNT(CASE WHEN payment_status = 'paid' THEN 1 END) as paid_supplies,
        COUNT(CASE WHEN payment_status = 'unpaid' THEN 1 END) as unpaid_supplies,
        COUNT(CASE WHEN DATE(supply_date) >= DATE_SUB(CURDATE(), INTERVAL 30 DAYS) THEN 1 END) as monthly_supplies
      FROM supply_records
    `);

    // Get supplier statistics
    const [supplierStats] = await pool.execute(`
      SELECT 
        COUNT(DISTINCT supplier_id) as total_suppliers,
        COUNT(*) as total_records
      FROM supply_records
    `);

    // Get top suppliers by value
    const [topSuppliers] = await pool.execute(`
      SELECT 
        u.name as supplier_name,
        COUNT(sr.id) as supply_count,
        SUM(sr.total_payment) as total_value,
        AVG(sr.unit_price) as avg_price
      FROM supply_records sr
      JOIN users u ON sr.supplier_id = u.id
      GROUP BY sr.supplier_id, u.name
      ORDER BY total_value DESC
      LIMIT 5
    `);

    // Get monthly trend data
    const [monthlyTrend] = await pool.execute(`
      SELECT 
        DATE_FORMAT(supply_date, '%Y-%m') as month,
        COUNT(*) as supply_count,
        SUM(total_payment) as total_value
      FROM supply_records
      WHERE supply_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(supply_date, '%Y-%m')
      ORDER BY month DESC
    `);

    // Get payment method distribution
    const [paymentMethods] = await pool.execute(`
      SELECT 
        payment_method,
        COUNT(*) as count,
        SUM(total_payment) as total_value
      FROM supply_records
      GROUP BY payment_method
    `);

    const analytics = {
      supply_metrics: supplyRecords[0],
      supplier_stats: supplierStats[0],
      top_suppliers: topSuppliers,
      monthly_trend: monthlyTrend,
      payment_methods: paymentMethods,
      summary: {
        efficiency_rate:
          supplyRecords[0].total_supplies > 0
            ? (
                (supplyRecords[0].paid_supplies /
                  supplyRecords[0].total_supplies) *
                100
              ).toFixed(2)
            : 0,
        avg_monthly_supplies:
          monthlyTrend.length > 0
            ? (
                monthlyTrend.reduce(
                  (sum, month) => sum + month.supply_count,
                  0
                ) / monthlyTrend.length
              ).toFixed(1)
            : 0,
      },
    };

    res.json({
      success: true,
      message: "Dashboard analytics retrieved successfully",
      data: analytics,
    });
  } catch (error) {
    console.error("Dashboard analytics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve dashboard analytics",
    });
  }
});

// Get staff dashboard statistics (legacy endpoint)
router.get("/dashboard-stats", async (req, res) => {
  try {
    // Get total orders count
    const [totalOrdersResult] = await pool.execute(
      "SELECT COUNT(*) as total FROM supplier_orders"
    );
    const totalOrders = totalOrdersResult[0].total;

    // Get pending orders count
    const [pendingOrdersResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM supplier_orders WHERE status = "pending"'
    );
    const pendingOrders = pendingOrdersResult[0].total;

    // Get total suppliers count
    const [totalSuppliersResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM users WHERE role = "supplier"'
    );
    const totalSuppliers = totalSuppliersResult[0].total;

    // Get delivered orders count
    const [deliveredOrdersResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM supplier_orders WHERE status = "delivered"'
    );
    const deliveredOrders = deliveredOrdersResult[0].total;

    res.json({
      totalOrders,
      pendingOrders,
      totalSuppliers,
      deliveredOrders,
    });
  } catch (error) {
    console.error("Staff dashboard stats fetch error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/staff/orders - Get all supplier orders for staff to view
router.get("/orders", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = "",
      grade = "",
      status = "",
      sortBy = "order_date",
      sortOrder = "desc",
    } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const offset = (pageNum - 1) * limitNum;

    let query = `
      SELECT so.*, u.name as supplier_name, u.email, u.phone
      FROM supplier_orders so
      LEFT JOIN users u ON so.supplier_id = u.id AND u.role = 'supplier'
      WHERE 1=1
    `;
    const params = [];

    // Add search filter
    if (search) {
      query += ` AND (so.tea_type LIKE ? OR u.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    // Add grade filter
    if (grade) {
      query += ` AND so.grade = ?`;
      params.push(grade);
    }

    // Add status filter
    if (status) {
      query += ` AND so.status = ?`;
      params.push(status);
    }

    // Add sorting
    const validSortColumns = [
      "order_date",
      "delivery_date",
      "tea_type",
      "grade",
      "quantity_kg",
      "status",
    ];
    const validSortOrders = ["asc", "desc"];

    if (
      validSortColumns.includes(sortBy) &&
      validSortOrders.includes(sortOrder)
    ) {
      query += ` ORDER BY so.${sortBy} ${sortOrder.toUpperCase()}`;
    } else {
      query += ` ORDER BY so.order_date DESC`;
    }

    // Add pagination
    query += ` LIMIT ? OFFSET ?`;
    params.push(limitNum, offset);

    const [orders] = await pool.execute(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM supplier_orders so
      LEFT JOIN users u ON so.supplier_id = u.id AND u.role = 'supplier'
      WHERE 1=1
    `;
    const countParams = [];

    if (search) {
      countQuery += ` AND (so.tea_type LIKE ? OR u.name LIKE ?)`;
      countParams.push(`%${search}%`, `%${search}%`);
    }

    if (grade) {
      countQuery += ` AND so.grade = ?`;
      countParams.push(grade);
    }

    if (status) {
      countQuery += ` AND so.status = ?`;
      countParams.push(status);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const totalOrders = countResult[0].total;

    res.json({
      orders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        hasNext: page * limit < totalOrders,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Staff orders fetch error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update order status (mark as received)
router.put("/orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    console.log("Status update request:", { id, status, notes });

    // Validate status
    const validStatuses = [
      "pending",
      "confirmed",
      "processing",
      "shipped",
      "delivered",
      "received",
      "cancelled",
    ];
    if (!validStatuses.includes(status)) {
      console.log("Invalid status provided:", status);
      return res.status(400).json({ message: "Invalid status" });
    }

    // Check if order exists
    const [existingOrder] = await pool.execute(
      "SELECT * FROM supplier_orders WHERE id = ?",
      [id]
    );
    if (existingOrder.length === 0) {
      console.log("Order not found:", id);
      return res.status(404).json({ message: "Order not found" });
    }

    console.log("Existing order found:", existingOrder[0]);

    // Update order status
    const updateQuery = `
      UPDATE supplier_orders 
      SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    console.log("Executing update query with:", [
      status,
      notes || existingOrder[0].notes,
      id,
    ]);
    const updateResult = await pool.execute(updateQuery, [
      status,
      notes || existingOrder[0].notes,
      id,
    ]);
    console.log("Update result:", updateResult);

    // Get updated order
    const [updatedOrder] = await pool.execute(
      `
      SELECT so.*, u.name as supplier_name, u.email, u.phone
      FROM supplier_orders so
      LEFT JOIN users u ON so.supplier_id = u.id AND u.role = 'supplier'
      WHERE so.id = ?
    `,
      [id]
    );

    res.json({
      message: "Order status updated successfully",
      order: updatedOrder[0],
    });
  } catch (error) {
    console.error("Order status update error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get order details by ID
router.get("/orders/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [order] = await pool.execute(
      `
      SELECT so.*, u.name as supplier_name, u.email, u.phone
      FROM supplier_orders so
      LEFT JOIN users u ON so.supplier_id = u.id AND u.role = 'supplier'
      WHERE so.id = ?
    `,
      [id]
    );

    if (order.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.json({ order: order[0] });
  } catch (error) {
    console.error("Order fetch error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update order payment status
router.put("/orders/:id/payment", async (req, res) => {
  try {
    const { id } = req.params;
    const { payment_status } = req.body;

    // Validate payment status
    if (!payment_status || !["paid", "unpaid"].includes(payment_status)) {
      return res.status(400).json({
        message: 'Invalid payment status. Must be "paid" or "unpaid"',
      });
    }

    // Check if order exists
    const [existingOrder] = await pool.execute(
      "SELECT id FROM supplier_orders WHERE id = ?",
      [id]
    );
    if (existingOrder.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Update payment status
    await pool.execute(
      "UPDATE supplier_orders SET payment_status = ?, updated_at = NOW() WHERE id = ?",
      [payment_status, id]
    );

    // Get updated order details
    const [updatedOrder] = await pool.execute(
      `
      SELECT so.*, u.name as supplier_name, u.email, u.phone
      FROM supplier_orders so
      LEFT JOIN users u ON so.supplier_id = u.id AND u.role = 'supplier'
      WHERE so.id = ?
    `,
      [id]
    );

    res.json({
      message: "Payment status updated successfully",
      order: updatedOrder[0],
    });
  } catch (error) {
    console.error("Payment status update error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get all suppliers (Controller-based route)
router.get("/suppliers", SupplierController.getAllSuppliers);

// Get supplier by ID (Controller-based route)
router.get("/suppliers/:id", SupplierController.getSupplierById);

// Debug route: Get supplier ID statistics
router.get("/suppliers/debug/stats", async (req, res) => {
  try {
    const result = await SupplierModel.getSupplierIdStats();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error getting supplier ID stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get supplier ID statistics",
      error: error.message,
    });
  }
});

// Debug route: Reset all supplier IDs (use carefully!)
router.post("/suppliers/debug/reset-ids", async (req, res) => {
  try {
    const result = await SupplierModel.resetAllSupplierIds();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Error resetting supplier IDs:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reset supplier IDs",
      error: error.message,
    });
  }
});

const nodemailer = require("nodemailer");

// Helper to create transporter (mirrors userController)
function createTransporter() {
  const host = process.env.MAIL_HOST || "smtp.gmail.com";
  const port = Number(process.env.MAIL_PORT || 587);
  const secure = port === 465; // true for SMTPS (implicit TLS)

  // Add sensible timeouts to fail fast on network issues instead of hanging
  const baseOpts = {
    host,
    port,
    secure,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
    tls: {
      // allow self-signed certs in non-production for easier testing
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
    // timeouts (ms)
    connectionTimeout: Number(process.env.MAIL_CONNECTION_TIMEOUT || 10000),
    greetingTimeout: Number(process.env.MAIL_GREETING_TIMEOUT || 10000),
    socketTimeout: Number(process.env.MAIL_SOCKET_TIMEOUT || 10000),
  };

  if (process.env.MAIL_SERVICE) {
    return nodemailer.createTransport({
      service: process.env.MAIL_SERVICE,
      ...baseOpts,
    });
  }

  return nodemailer.createTransport(baseOpts);
}

// Add new supplier
router.post("/suppliers", async (req, res) => {
  try {
    console.log("Received request body:", req.body);
    const {
      name,
      email,
      password,
      phone,
      address,
      bank_name,
      account_number,
      account_holder_name,
      bank_branch,
      bank_code,
    } = req.body;

    console.log("Extracted values:", {
      name,
      email,
      password: password ? "[REDACTED]" : undefined,
      phone,
      address,
      bank_name,
      account_number: account_number ? "[PROVIDED]" : undefined,
      account_holder_name,
      bank_branch,
      bank_code,
    });

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    // If password not provided or invalid, auto-generate one
    let plainPassword = password;
    const needGeneratePassword =
      !plainPassword ||
      typeof plainPassword !== "string" ||
      plainPassword.trim() === "" ||
      plainPassword.length < 6 ||
      plainPassword.length > 128;

    if (needGeneratePassword) {
      // Generate a random 12-character alphanumeric password (no special chars)
      const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      plainPassword = Array.from(
        { length: 12 },
        () => chars[Math.floor(Math.random() * chars.length)]
      ).join("");
      console.log(
        "Auto-generated password for new supplier (will be emailed): [REDACTED]"
      );
    }

    // Basic name validation
    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 100
    ) {
      return res
        .status(400)
        .json({ message: "Name must be between 2 and 100 characters" });
    }

    // Password length validation - validate the actual plainPassword used (may be autogenerated)
    if (
      typeof plainPassword !== "string" ||
      plainPassword.length < 6 ||
      plainPassword.length > 128
    ) {
      return res.status(400).json({
        message: "Password must be between 6 and 128 characters long",
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ message: "Please enter a valid email address" });
    }

    // Phone validation (optional) - require exactly 10 digits
    const phoneVal = phone ? String(phone).trim() : "";
    let normalizedPhone = "";
    if (phoneVal) {
      // strip all non-digit characters and enforce exactly 10 digits
      normalizedPhone = phoneVal.replace(/\D/g, "");
      if (!/^\d{10}$/.test(normalizedPhone)) {
        return res
          .status(400)
          .json({ message: "Phone number must contain exactly 10 digits" });
      }
    }

    // Address and bank fields length checks (optional)
    if (address && String(address).length > 255) {
      return res
        .status(400)
        .json({ message: "Address is too long (max 255 characters)" });
    }
    if (bank_name && String(bank_name).length > 100) {
      return res
        .status(400)
        .json({ message: "Bank name is too long (max 100 characters)" });
    }
    if (bank_branch && String(bank_branch).length > 100) {
      return res
        .status(400)
        .json({ message: "Bank branch is too long (max 100 characters)" });
    }
    if (bank_code && String(bank_code).length > 20) {
      return res
        .status(400)
        .json({ message: "Bank code is too long (max 20 characters)" });
    }

    // Account number / account holder consistency: if account_number provided, require account_holder_name
    if (account_number && !account_holder_name) {
      return res.status(400).json({
        message:
          "Account holder name is required when account number is provided",
      });
    }
    if (
      account_number &&
      (String(account_number).length < 4 || String(account_number).length > 34)
    ) {
      return res
        .status(400)
        .json({ message: "Account number length is invalid" });
    }

    // Check if email already exists
    const [existingUser] = await pool.execute(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );

    if (existingUser.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // If phone provided, check if phone already exists for any user (compare normalized digits)
    if (normalizedPhone) {
      const [existingPhone] = await pool.execute(
        "SELECT id FROM users WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') = ?",
        [normalizedPhone]
      );

      if (existingPhone.length > 0) {
        return res.status(400).json({ message: "Phone number already exists" });
      }
    }

    // Hash password using bcrypt (same method as user registration)
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Auto-generate supplier ID
    const generatedSupplierId = await SupplierModel.generateSupplierId();
    console.log("Generated supplier ID result:", generatedSupplierId);

    // Validate supplier ID generation
    if (!generatedSupplierId) {
      console.error("Failed to generate supplier ID");
      return res
        .status(500)
        .json({ message: "Failed to generate supplier ID" });
    }

    // Prepare parameters and validate - now including bank information
    const insertParams = [
      name,
      email,
      hashedPassword,
      phone || null,
      generatedSupplierId,
      address || null,
      bank_name || null,
      account_number || null,
      account_holder_name || null,
      bank_branch || null,
      bank_code || null,
      1, // must_change_password = true for newly created suppliers
    ];

    // Debug logging
    console.log("Insert parameters:", {
      name: name,
      email: email,
      hashedPassword: hashedPassword ? "[REDACTED]" : undefined,
      phone: phone || null,
      generatedSupplierId: generatedSupplierId,
      address: address || null,
      bank_name: bank_name || null,
      account_number: account_number ? "[PROVIDED]" : null,
      account_holder_name: account_holder_name || null,
      bank_branch: bank_branch || null,
      bank_code: bank_code || null,
    });

    // Check for undefined parameters (null is ok, undefined is not)
    insertParams.forEach((param, index) => {
      if (param === undefined) {
        console.error(`Parameter at index ${index} is undefined`);
        throw new Error(`Parameter at index ${index} is undefined`);
      }
    });

    // Insert new supplier with bank information
    const [result] = await pool.execute(
      `
      INSERT INTO users (name, email, password, role, phone, supplier_id, status, created_at, updated_at, 
                         address, bank_name, account_number, account_holder_name, bank_branch, bank_code, must_change_password)
      VALUES (?, ?, ?, 'supplier', ?, ?, 'active', NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?)
    `,
      insertParams
    );

    // Get the created supplier
    const [newSupplier] = await pool.execute(
      `
      SELECT id, name, email, phone, supplier_id, role, status, created_at, updated_at,
             address, bank_name, account_number, account_holder_name, bank_branch, bank_code
      FROM users 
      WHERE id = ?
    `,
      [result.insertId]
    );

    // Mask account number in response for security
    const supplierResponse = { ...newSupplier[0] };
    if (supplierResponse.account_number) {
      supplierResponse.account_number =
        "***" + supplierResponse.account_number.slice(-4);
    }

    // Send email with credentials (plaintext password) to the supplier
    (async () => {
      // Try the configured transporter first. On failure, try sensible fallbacks.
      let transporter = createTransporter();
      let mailSent = false;
      let lastSendError = null;
      // Build message payload once (available to catch/fallbacks)
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5001";
      const companyName = process.env.COMPANY_NAME || "BrewOps";
      const loginLink = `${frontendUrl}/login`;

      const html = `
        <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.4;">
          <div style="max-width: 600px; margin: 0 auto; padding: 24px; background: #ffffff; border-radius: 8px; border: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 8px 0; color: #0f172a;">${companyName} — Supplier Account Created</h2>
            <p style="margin: 0 0 16px 0; color: #4b5563;">Hello ${name},<br/>Your supplier account has been created. Use the credentials below to sign in. For security, please change your password after logging in.</p>

            <div style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e6eef9; margin: 12px 0;">
              <p style="margin:0; color:#374151;"><strong>Email:</strong> ${email}</p>
              <p style="margin:6px 0 0 0; color:#374151;"><strong>Temporary password:</strong> <span style="font-family: monospace; background:#fff; padding:4px 8px; border-radius:6px; border:1px solid #e5e7eb;">${plainPassword}</span></p>
            </div>

            <div style="text-align:center; margin-top: 12px;">
              <a href="${loginLink}" style="display:inline-block; background:#059669; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:600;">Sign in now</a>
            </div>

            <p style="margin-top:24px; font-size:12px; color:#9ca3af;">If you did not expect this email, please contact support. This temporary password will stop working after you change it.</p>

            <hr style="border:none; border-top:1px solid #e6e9ee; margin:18px 0" />
            <p style="font-size:12px; color:#9ca3af; margin:0;">${companyName} • Support</p>
          </div>
        </div>
      `;

      const text = `Hello ${name},\n\nYour supplier account has been created.\n\nEmail: ${email}\nTemporary password: ${plainPassword}\n\nPlease change your password after logging in for the first time.\n\nVisit ${loginLink} to sign in.`;

      try {
        // Attempt primary send
        const info = await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.MAIL_USER,
          to: email,
          subject: "Your supplier account details",
          text,
          html,
        });
        console.log(
          `Supplier credentials email sent: ${info.messageId || info.response}`
        );

        // If using Ethereal, log preview URL (getTestMessageUrl returns a preview URL when using ethereal/test account)
        try {
          const preview = nodemailer.getTestMessageUrl(info);
          if (preview) console.log(`Ethereal preview URL: ${preview}`);
        } catch (err) {}
        mailSent = true;
      } catch (mailErr) {
        console.error(
          "Initial send failed:",
          mailErr && mailErr.message ? mailErr.message : mailErr
        );
        lastSendError = mailErr;

        // Try alternate approaches to improve reliability:
        // 1) If port wasn't 587, try 587 (STARTTLS)
        try {
          const altPort = 587;
          console.log(`Attempting fallback send using port ${altPort}`);
          const altTransport = nodemailer.createTransport({
            host: process.env.MAIL_HOST || "smtp.gmail.com",
            port: altPort,
            secure: false,
            auth: {
              user: process.env.MAIL_USER,
              pass: process.env.MAIL_PASS,
            },
            tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
            connectionTimeout: Number(
              process.env.MAIL_CONNECTION_TIMEOUT || 10000
            ),
            greetingTimeout: Number(process.env.MAIL_GREETING_TIMEOUT || 10000),
            socketTimeout: Number(process.env.MAIL_SOCKET_TIMEOUT || 10000),
          });
          const info2 = await altTransport.sendMail({
            from: process.env.MAIL_FROM || process.env.MAIL_USER,
            to: email,
            subject: "Your supplier account details",
            text,
            html,
          });
          console.log(
            `Fallback (port ${altPort}) send succeeded: ${
              info2.messageId || info2.response
            }`
          );
          mailSent = true;
        } catch (altErr) {
          console.error(
            "Fallback port send failed:",
            altErr && altErr.message ? altErr.message : altErr
          );
          lastSendError = altErr;
        }

        // 2) If SendGrid API key present, use SendGrid HTTP API as a fallback (more reliable than raw SMTP in some environments)
        if (!mailSent && process.env.SENDGRID_API_KEY) {
          try {
            console.log("Attempting SendGrid HTTP API fallback");
            const sgMail = require("@sendgrid/mail");
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const msg = {
              to: email,
              from: process.env.MAIL_FROM || process.env.MAIL_USER,
              subject: "Your supplier account details",
              text,
              html,
            };
            const sgRes = await sgMail.send(msg);
            console.log(
              "SendGrid send result:",
              Array.isArray(sgRes) ? sgRes[0].statusCode : sgRes.statusCode
            );
            mailSent = true;
          } catch (sgErr) {
            console.error(
              "SendGrid fallback failed:",
              sgErr && sgErr.message ? sgErr.message : sgErr
            );
            lastSendError = sgErr;
          }
        }

        // 3) Last resort in development: Ethereal and log plaintext password
        if (!mailSent && process.env.NODE_ENV !== "production") {
          try {
            console.log(
              "Falling back to Ethereal test account for supplier email (dev only)"
            );
            const testAccount = await nodemailer.createTestAccount();
            const ethTransport = nodemailer.createTransport({
              host: "smtp.ethereal.email",
              port: 587,
              secure: false,
              auth: { user: testAccount.user, pass: testAccount.pass },
            });
            const info3 = await ethTransport.sendMail({
              from: testAccount.user,
              to: email,
              subject: "Your supplier account details (Ethereal test)",
              text,
              html,
            });
            const preview = nodemailer.getTestMessageUrl(info3);
            console.log("Ethereal message preview URL:", preview);
            console.log(
              `DEV: Generated supplier password for ${email}: ${plainPassword}`
            );
            mailSent = true;
          } catch (ethErr) {
            console.error(
              "Failed to send via Ethereal fallback:",
              ethErr && ethErr.message ? ethErr.message : ethErr
            );
            lastSendError = ethErr;
          }
        }
      }

      if (!mailSent) {
        console.error(
          "All mail send attempts failed. Last error:",
          lastSendError && lastSendError.message
            ? lastSendError.message
            : lastSendError
        );
      }
    })();

    // In development, include the generated password in the response for quick QA (do not enable in production)
    if (process.env.NODE_ENV !== "production") {
      supplierResponse._dev_plainPassword = plainPassword;
    }

    res.status(201).json(supplierResponse);
  } catch (error) {
    console.error("Add supplier error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update/Edit supplier
router.put("/suppliers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      email,
      phone,
      password,
      address,
      bank_name,
      account_number,
      account_holder_name,
      bank_branch,
      bank_code,
    } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    // Basic name validation
    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 100
    ) {
      return res
        .status(400)
        .json({ message: "Name must be between 2 and 100 characters" });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ message: "Please enter a valid email address" });
    }

    // Check if supplier exists
    const [existingSupplier] = await pool.execute(
      "SELECT id, email FROM users WHERE id = ? AND role = ?",
      [id, "supplier"]
    );

    if (existingSupplier.length === 0) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    // Check if email is already taken by another user (if email is being changed)
    if (email !== existingSupplier[0].email) {
      const [emailCheck] = await pool.execute(
        "SELECT id FROM users WHERE email = ? AND id != ?",
        [email, id]
      );

      if (emailCheck.length > 0) {
        return res
          .status(400)
          .json({ message: "Email is already taken by another user" });
      }
    }

    // Phone validation and uniqueness (require exactly 10 digits)
    const phoneValUpdate = phone ? String(phone).trim() : "";
    let normalizedPhoneUpdate = "";
    if (phoneValUpdate) {
      normalizedPhoneUpdate = phoneValUpdate.replace(/\D/g, "");
      if (!/^\d{10}$/.test(normalizedPhoneUpdate)) {
        return res
          .status(400)
          .json({ message: "Phone number must contain exactly 10 digits" });
      }

      const [phoneCheck] = await pool.execute(
        "SELECT id FROM users WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') = ? AND id != ?",
        [normalizedPhoneUpdate, id]
      );

      if (phoneCheck.length > 0) {
        return res
          .status(400)
          .json({ message: "Phone number is already taken by another user" });
      }
    }

    // Account number / holder validation for update as well
    if (account_number && !account_holder_name) {
      return res.status(400).json({
        message:
          "Account holder name is required when account number is provided",
      });
    }
    if (
      account_number &&
      (String(account_number).length < 4 || String(account_number).length > 34)
    ) {
      return res
        .status(400)
        .json({ message: "Account number length is invalid" });
    }

    // Prepare update data (supplier_id is auto-generated and cannot be edited)
    let updateQuery = `
      UPDATE users 
      SET name = ?, email = ?, phone = ?, address = ?, 
          bank_name = ?, account_number = ?, account_holder_name = ?, 
          bank_branch = ?, bank_code = ?, updated_at = NOW()
    `;
    let updateParams = [
      name,
      email,
      phone || null,
      address || null,
      bank_name || null,
      account_number || null,
      account_holder_name || null,
      bank_branch || null,
      bank_code || null,
    ];

    // Add password to update if provided
    if (password && password.trim() !== "") {
      // Validate password length
      if (password.length < 6) {
        return res
          .status(400)
          .json({ message: "Password must be at least 6 characters long" });
      }

      // Hash the new password
      const hashedPassword = await bcrypt.hash(password, 10);
      updateQuery += `, password = ?`;
      updateParams.push(hashedPassword);
    }

    updateQuery += ` WHERE id = ? AND role = 'supplier'`;
    updateParams.push(id);

    // Update supplier
    await pool.execute(updateQuery, updateParams);

    // Get updated supplier data
    const [updatedSupplier] = await pool.execute(
      `
      SELECT id, name, email, phone, supplier_id, role, created_at, updated_at,
             address, bank_name, account_number, account_holder_name, bank_branch, bank_code
      FROM users 
      WHERE id = ? AND role = 'supplier'
    `,
      [id]
    );

    // Mask account number in response for security
    const supplierResponse = { ...updatedSupplier[0] };
    if (supplierResponse.account_number) {
      supplierResponse.account_number =
        "***" + supplierResponse.account_number.slice(-4);
    }

    res.json({
      success: true,
      message: "Supplier updated successfully",
      data: supplierResponse,
    });
  } catch (error) {
    console.error("Update supplier error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Supply Records Management - Using Controller
router.get("/supply-records", SupplierController.getAllSupplyRecords);
router.post("/supply-records", SupplierController.createSupplyRecord);
router.get("/supply-records/:id", SupplierController.getSupplyRecordById);
router.put("/supply-records/:id", SupplierController.updateSupplyRecord);

router.put(
  "/supply-records/:id/payment",
  SupplierController.updatePaymentStatus
);
router.put(
  "/supply-records/:id/mark-paid",
  SupplierController.markPaymentAsPaid
);

module.exports = router;
