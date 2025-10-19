const mysql = require("mysql2/promise");
require("dotenv").config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "softora_app",
  port: process.env.DB_PORT || 3306,
};

// Create connection pool
const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Initialize database and tables
async function initializeDatabase() {
  try {
    // Create database if it doesn't exist
    const connection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port,
    });

    await connection.execute(
      `CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`
    );
    await connection.end();

    console.log(`Database '${dbConfig.database}' created or already exists`);

    // Create tables
    await createTables();
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
}

// Create necessary tables
async function createTables() {
  try {
    // Users table
    const createUsersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('supplier', 'staff', 'manager', 'admin') NOT NULL,
        must_change_password TINYINT(1) DEFAULT 0,
        phone VARCHAR(20),
        supplier_id VARCHAR(50),
        staff_id VARCHAR(50),
        manager_id VARCHAR(50),
        status ENUM('active', 'inactive', 'pending') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    // Employees reference table (used to validate registration employee IDs)
    const createEmployeesTable = `
      CREATE TABLE IF NOT EXISTS employees (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(10) UNIQUE NOT NULL,
        employee_type ENUM('staff', 'manager') NOT NULL,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_employee_type (employee_type),
        INDEX idx_employee_id (employee_id)
      )
    `;

    // Orders table (for suppliers)
    const createOrdersTable = `
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        supplier_id INT,
        order_number VARCHAR(50) UNIQUE NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        quantity INT NOT NULL,
        unit_price DECIMAL(10, 2) NOT NULL,
        total_amount DECIMAL(10, 2) NOT NULL,
        status ENUM('pending', 'confirmed', 'shipped', 'delivered', 'cancelled') DEFAULT 'pending',
        order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivery_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;

    // Tasks table (for staff)
    const createTasksTable = `
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        staff_id INT,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
        status ENUM('pending', 'in_progress', 'completed', 'cancelled') DEFAULT 'pending',
        assigned_by INT,
        due_date DATE,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `;

    // Production data table (for managers) - Simplified for: production_id, quantity, date, time
    const createProductionTable = `
      CREATE TABLE IF NOT EXISTS production_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        production_id VARCHAR(50) UNIQUE NOT NULL,
        quantity DECIMAL(10, 2) NOT NULL,
        production_date DATE NOT NULL,
        production_time TIME DEFAULT (CURRENT_TIME),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_production_date (production_date),
        INDEX idx_production_id (production_id)
      )
    `;

    // System logs table (for admin)
    const createSystemLogsTable = `
      CREATE TABLE IF NOT EXISTS system_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        action VARCHAR(255) NOT NULL,
        description TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `;

    // Inventory table (simple schema used by inventoryModel/inventoryController)
    const createInventoryTable = `
      CREATE TABLE IF NOT EXISTS inventory (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inventoryid VARCHAR(100) NOT NULL UNIQUE,
        quantity INT NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    // Messages table (for manager-supplier communication)
    const createMessagesTable = `
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender_id INT NOT NULL,
        receiver_id INT NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;

    // Supplier Orders table (for supplier dashboard orders with inventory-like fields)
    const createSupplierOrdersTable = `
      CREATE TABLE IF NOT EXISTS supplier_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tea_type VARCHAR(255) NOT NULL,
        grade VARCHAR(100) NOT NULL,
        quantity_kg DECIMAL(10, 2) NOT NULL,
        supplier_id INT NOT NULL,
        price_per_kg DECIMAL(10, 2) NOT NULL,
        status ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'received', 'cancelled') DEFAULT 'pending',
        payment_method ENUM('spot', 'monthly') DEFAULT 'spot',
        payment_status ENUM('paid', 'unpaid') DEFAULT 'unpaid',
        order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivery_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;

    // Supply Records table (for tracking raw tea leaves delivered by suppliers)
    const createSupplyRecordsTable = `
      CREATE TABLE IF NOT EXISTS supply_records (
        id INT AUTO_INCREMENT PRIMARY KEY,
        supply_id VARCHAR(50) UNIQUE NOT NULL,
        supplier_id INT NOT NULL,
        quantity_kg DECIMAL(10, 2) NOT NULL,
        remaining_quantity_kg DECIMAL(10, 2) NOT NULL DEFAULT 0,
        unit_price DECIMAL(10, 2) NOT NULL,
        total_payment DECIMAL(10, 2) NOT NULL,
        payment_method ENUM('spot', 'monthly') DEFAULT 'spot',
        payment_status ENUM('paid', 'unpaid') DEFAULT 'unpaid',
        supply_date DATE NOT NULL,
        supply_time TIME NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;

    // Execute table creation queries
    await pool.execute(createUsersTable);
    console.log("Users table created or already exists");

    // Ensure employees table exists for employee ID verification
    await pool.execute(createEmployeesTable);
    console.log("Employees table created or already exists");

    await pool.execute(createOrdersTable);
    console.log("Orders table created or already exists");

    await pool.execute(createTasksTable);
    console.log("Tasks table created or already exists");

    await pool.execute(createProductionTable);
    console.log("Production data table created or already exists");

    await pool.execute(createSupplyRecordsTable);
    console.log("Supply records table created or already exists");

    // Payments table (for tracking payment transactions)
    const createPaymentsTable = `
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        payment_id VARCHAR(100) UNIQUE NOT NULL,
        supply_record_id INT NOT NULL,
        supplier_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'LKR',
        payment_method ENUM('spot', 'gateway', 'bank_transfer', 'cash', 'cheque') NOT NULL,
        payment_gateway VARCHAR(50) NULL,
        gateway_session_id VARCHAR(255) NULL,
        gateway_payment_id VARCHAR(255) NULL,
        payment_status ENUM('pending', 'completed', 'failed', 'cancelled', 'refunded') DEFAULT 'pending',
        payment_date TIMESTAMP NULL,
        payment_notes TEXT NULL,
        gateway_response JSON NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (supply_record_id) REFERENCES supply_records(id) ON DELETE CASCADE,
        FOREIGN KEY (supplier_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_payment_id (payment_id),
        INDEX idx_supply_record (supply_record_id),
        INDEX idx_supplier (supplier_id),
        INDEX idx_payment_status (payment_status),
        INDEX idx_payment_date (payment_date)
      )
    `;

    await pool.execute(createPaymentsTable);
    console.log("Payments table created or already exists");

    // Create settings table for global key/value application settings
    const createSettingsTable =
      `
      CREATE TABLE IF NOT EXISTS settings (
        ` +
      "`key`" +
      ` VARCHAR(100) PRIMARY KEY,
        value VARCHAR(500) NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await pool.execute(createSettingsTable);
    console.log("Settings table created or already exists");

    // Unit price history table - store every change to the global unit price
    const createUnitPriceHistoryTable = `
      CREATE TABLE IF NOT EXISTS unit_price_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        unit_price DECIMAL(10,2) NOT NULL,
        changed_by INT NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_changed_at (changed_at),
        INDEX idx_changed_by (changed_by)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await pool.execute(createUnitPriceHistoryTable);
    console.log("Unit price history table created or already exists");

    // Add remaining_quantity_kg column to existing supply_records table if it doesn't exist
    try {
      await pool.execute(`
        ALTER TABLE supply_records 
        ADD COLUMN remaining_quantity_kg DECIMAL(10, 2) NOT NULL DEFAULT 0
      `);
      console.log("Added remaining_quantity_kg column to supply_records table");
    } catch (error) {
      // Column might already exist, that's okay
      if (!error.message.includes("Duplicate column name")) {
        console.log(
          "remaining_quantity_kg column might already exist or other issue:",
          error.message
        );
      }
    }

    // Update existing supply records to set remaining_quantity_kg = quantity_kg where remaining_quantity_kg = 0
    try {
      await pool.execute(`
        UPDATE supply_records 
        SET remaining_quantity_kg = quantity_kg 
        WHERE remaining_quantity_kg = 0
      `);
      console.log("Updated existing supply records with remaining quantities");
    } catch (error) {
      console.log("Error updating existing supply records:", error.message);
    }

    // Add address and bank information columns to users table for suppliers
    try {
      await pool.execute(`
        ALTER TABLE users 
        ADD COLUMN address VARCHAR(500) NULL,
        ADD COLUMN bank_name VARCHAR(100) NULL,
        ADD COLUMN account_number VARCHAR(50) NULL,
        ADD COLUMN account_holder_name VARCHAR(255) NULL,
        ADD COLUMN bank_branch VARCHAR(100) NULL,
        ADD COLUMN bank_code VARCHAR(20) NULL
      `);
      console.log("Added address and bank information columns to users table");
    } catch (error) {
      // Columns might already exist, that's okay
      if (!error.message.includes("Duplicate column name")) {
        console.log(
          "Address and bank information columns might already exist or other issue:",
          error.message
        );
      }
    }

    // Add custom average price column to users (nullable decimal)
    try {
      await pool.execute(`
        ALTER TABLE users
        ADD COLUMN custom_avg_price DECIMAL(10,2) NULL
      `);
      console.log("Added custom_avg_price column to users table");
    } catch (error) {
      if (!error.message.includes("Duplicate column name")) {
        console.log(
          "custom_avg_price column might already exist or other issue:",
          error.message
        );
      }
    }

    // Add must_change_password column if it doesn't exist (migration safe)
    try {
      await pool.execute(`
        ALTER TABLE users
        ADD COLUMN must_change_password TINYINT(1) DEFAULT 0
      `);
      console.log("Added must_change_password column to users table");
    } catch (error) {
      if (!error.message.includes("Duplicate column name")) {
        console.log(
          "must_change_password column might already exist or other issue:",
          error.message
        );
      }
    }

    // Migration: Remove manager_id column from production_data if it exists
    try {
      await pool.execute(`ALTER TABLE production_data DROP COLUMN manager_id`);
      console.log("Removed manager_id column from production_data table");
    } catch (error) {
      // Column might not exist, which is fine
      if (!error.message.includes("check that column/key exists")) {
        console.log("manager_id column already removed or doesn't exist");
      }
    }

    await pool.execute(createSystemLogsTable);
    console.log("System logs table created or already exists");

    await pool.execute(createInventoryTable);
    console.log("Inventory table created or already exists");

    await pool.execute(createMessagesTable);
    console.log("Messages table created or already exists");

    await pool.execute(createSupplierOrdersTable);
    console.log("Supplier orders table created or already exists");

    // Password resets table (for OTP-based reset)
    const createPasswordResetsTable = `
      CREATE TABLE IF NOT EXISTS password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        otp_code VARCHAR(10) NOT NULL,
        expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user (user_id),
        INDEX idx_user_otp (user_id, otp_code),
        INDEX idx_expires (expires_at)
      )
    `;

    await pool.execute(createPasswordResetsTable);
    console.log("Password resets table created or already exists");

    // Seed a few employees (for testing) if not present
    try {
      await pool.execute(
        `INSERT INTO employees (employee_id, employee_type, status) VALUES 
         ('STF000001', 'staff', 'active'),
         ('STF000002', 'staff', 'active'),
         ('MNG000001', 'manager', 'active')
         ON DUPLICATE KEY UPDATE employee_type = VALUES(employee_type), status = VALUES(status)`
      );
      console.log("Seeded sample employees (STF000001/2, MNG000001)");
    } catch (seedErr) {
      console.log("Skipping employee seeding:", seedErr.message);
    }

    // Insert default admin user if not exists
    await insertDefaultAdmin();
  } catch (error) {
    console.error("Error creating tables:", error);
    throw error;
  }
}

// Insert default admin user
async function insertDefaultAdmin() {
  try {
    const bcrypt = require("bcryptjs");
    const defaultPassword = await bcrypt.hash("admin123", 10);

    const [existingAdmin] = await pool.execute(
      "SELECT id FROM users WHERE email = ? AND role = ?",
      ["admin@softora.com", "admin"]
    );

    if (existingAdmin.length === 0) {
      await pool.execute(
        `INSERT INTO users (name, email, password, role, status) 
         VALUES (?, ?, ?, ?, ?)`,
        [
          "System Administrator",
          "admin@softora.com",
          defaultPassword,
          "admin",
          "active",
        ]
      );
      console.log("Default admin user created: admin@softora.com / admin123");
    } else {
      console.log("Default admin user already exists");
    }
  } catch (error) {
    console.error("Error creating default admin:", error);
  }
}

// Database query helper functions
const db = {
  // Generic query function
  async query(sql, params = []) {
    try {
      const [results] = await pool.execute(sql, params);
      return results;
    } catch (error) {
      console.error("Database query error:", error);
      throw error;
    }
  },

  // User operations
  async createUser(userData) {
    const {
      name,
      email,
      password,
      role,
      phone,
      supplier_id,
      staff_id,
      manager_id,
      status,
    } = userData;
    const sql = `
      INSERT INTO users (name, email, password, role, phone, supplier_id, staff_id, manager_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return await this.query(sql, [
      name,
      email,
      password,
      role,
      phone,
      supplier_id,
      staff_id,
      manager_id,
      status || "pending",
    ]);
  },

  async getUserByEmail(email) {
    const sql = "SELECT * FROM users WHERE email = ?";
    const results = await this.query(sql, [email]);
    return results[0];
  },

  async getUserById(id) {
    const sql = "SELECT * FROM users WHERE id = ?";
    const results = await this.query(sql, [id]);
    return results[0];
  },

  // Get custom average price for a user
  async getUserCustomAvgPrice(id) {
    const sql = "SELECT custom_avg_price FROM users WHERE id = ?";
    const results = await this.query(sql, [id]);
    return results[0] ? results[0].custom_avg_price : null;
  },

  // Set custom average price for a user
  async setUserCustomAvgPrice(id, price) {
    const sql = "UPDATE users SET custom_avg_price = ? WHERE id = ?";
    return await this.query(sql, [price, id]);
  },

  // Settings helpers
  async getSetting(key) {
    const sql = "SELECT value FROM settings WHERE `key` = ?";
    const results = await this.query(sql, [key]);
    return results[0] ? results[0].value : null;
  },

  async setSetting(key, value) {
    // Upsert style: try update then insert if no rows affected
    try {
      const updateSql = "UPDATE settings SET value = ? WHERE `key` = ?";
      const result = await this.query(updateSql, [value, key]);
      // result may not give affectedRows via this helper; use INSERT ... ON DUPLICATE KEY
      const insertSql =
        "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)";
      return await this.query(insertSql, [key, value]);
    } catch (err) {
      throw err;
    }
  },

  // Unit price history helpers
  async addUnitPriceHistory(unitPrice, changedBy = null) {
    const sql = `INSERT INTO unit_price_history (unit_price, changed_by) VALUES (?, ?)`;
    return await this.query(sql, [unitPrice, changedBy]);
  },

  async getUnitPriceHistory(limit = 100) {
    const sql = `SELECT id, unit_price, changed_by, changed_at FROM unit_price_history ORDER BY changed_at DESC LIMIT ?`;
    return await this.query(sql, [limit]);
  },

  async updateUser(id, userData) {
    const { name, email, password, role, status, phone, must_change_password } =
      userData;
    let sql, params;

    if (password) {
      // If password and must_change_password provided
      if (typeof must_change_password !== "undefined") {
        sql =
          "UPDATE users SET name = ?, email = ?, password = ?, role = ?, status = ?, phone = ?, must_change_password = ? WHERE id = ?";
      } else {
        sql =
          "UPDATE users SET name = ?, email = ?, password = ?, role = ?, status = ?, phone = ? WHERE id = ?";
      }
      // Convert undefined to null for SQL parameters
      const safe = (v) => (v === undefined ? null : v);
      params = [
        safe(name),
        safe(email),
        safe(password),
        safe(role),
        safe(status),
        safe(phone),
      ];
      if (typeof must_change_password !== "undefined")
        params.push(must_change_password ? 1 : 0);
      params.push(id);
    } else {
      if (typeof must_change_password !== "undefined") {
        sql =
          "UPDATE users SET name = ?, email = ?, role = ?, status = ?, phone = ?, must_change_password = ? WHERE id = ?";
      } else {
        sql =
          "UPDATE users SET name = ?, email = ?, role = ?, status = ?, phone = ? WHERE id = ?";
      }
      const safe = (v) => (v === undefined ? null : v);
      params = [safe(name), safe(email), safe(role), safe(status), safe(phone)];
      if (typeof must_change_password !== "undefined")
        params.push(must_change_password ? 1 : 0);
      params.push(id);
    }

    return await this.query(sql, params);
  },

  async deleteUser(id) {
    const sql = "DELETE FROM users WHERE id = ?";
    return await this.query(sql, [id]);
  },

  async updateUserStatus(id, status) {
    const sql = "UPDATE users SET status = ? WHERE id = ?";
    return await this.query(sql, [status, id]);
  },

  // Employee reference operations
  async getEmployeeByEmployeeId(employeeId) {
    const sql =
      "SELECT * FROM employees WHERE employee_id = ? AND status = 'active'";
    const results = await this.query(sql, [employeeId]);
    return results[0];
  },

  async isEmployeeIdAlreadyUsed(employeeId) {
    const sql = "SELECT id FROM users WHERE staff_id = ? OR manager_id = ?";
    const results = await this.query(sql, [employeeId, employeeId]);
    return results.length > 0;
  },

  // Order operations
  async createOrder(orderData) {
    const {
      supplier_id,
      order_number,
      product_name,
      quantity,
      unit_price,
      total_amount,
      delivery_date,
    } = orderData;
    const sql = `
      INSERT INTO orders (supplier_id, order_number, product_name, quantity, unit_price, total_amount, delivery_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    return await this.query(sql, [
      supplier_id,
      order_number,
      product_name,
      quantity,
      unit_price,
      total_amount,
      delivery_date,
    ]);
  },

  async getOrdersBySupplier(supplier_id) {
    const sql =
      "SELECT * FROM orders WHERE supplier_id = ? ORDER BY created_at DESC";
    return await this.query(sql, [supplier_id]);
  },

  // Task operations
  async createTask(taskData) {
    const { staff_id, title, description, priority, assigned_by, due_date } =
      taskData;
    const sql = `
      INSERT INTO tasks (staff_id, title, description, priority, assigned_by, due_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    return await this.query(sql, [
      staff_id,
      title,
      description,
      priority,
      assigned_by,
      due_date,
    ]);
  },

  async getTasksByStaff(staff_id) {
    const sql =
      "SELECT * FROM tasks WHERE staff_id = ? ORDER BY created_at DESC";
    return await this.query(sql, [staff_id]);
  },

  // Production operations - Simplified for production_id, quantity, date, time
  async createProductionData(productionData) {
    const { production_id, quantity, production_date, production_time } =
      productionData;

    const sql = `
      INSERT INTO production_data (production_id, quantity, production_date, production_time)
      VALUES (?, ?, ?, ?)
    `;

    return await this.query(sql, [
      production_id,
      quantity,
      production_date,
      production_time || null, // Let MySQL use default CURRENT_TIME if not provided
    ]);
  },

  async getProductionData() {
    const sql = `
      SELECT 
        id, 
        production_id, 
        quantity, 
        production_date, 
        production_time,
        created_at,
        updated_at,
        DATE_FORMAT(created_at, '%H:%i') as time_created
      FROM production_data 
      ORDER BY production_date DESC, created_at DESC
    `;
    return await this.query(sql);
  },

  // Get production data by ID
  async getProductionDataById(id) {
    const sql = `
      SELECT 
        id, 
        production_id, 
        quantity, 
        production_date, 
        production_time,
        created_at,
        updated_at
      FROM production_data 
      WHERE id = ?
    `;
    return await this.query(sql, [id]);
  },

  // Inventory operations
  async createInventory(inventoryData) {
    // inventoryData expected: { inventoryid, quantity }
    const { inventoryid, quantity } = inventoryData;
    const sql = `
      INSERT INTO inventory (inventoryid, quantity)
      VALUES (?, ?)
    `;
    return await this.query(sql, [inventoryid, quantity]);
  },

  async getAllInventory() {
    const sql = `
      SELECT *
      FROM inventory
      ORDER BY createdAt DESC
    `;
    return await this.query(sql);
  },

  async getInventoryById(id) {
    const sql = `
      SELECT *
      FROM inventory
      WHERE id = ?
    `;
    return await this.query(sql, [id]);
  },

  async updateInventory(id, inventoryData) {
    // inventoryData expected: { inventoryid, quantity }
    const { inventoryid, quantity } = inventoryData;
    const sql = `
      UPDATE inventory SET inventoryid = ?, quantity = ? WHERE id = ?
    `;
    return await this.query(sql, [inventoryid, quantity, id]);
  },

  // System log operations
  async createSystemLog(logData) {
    const { user_id, action, description, ip_address, user_agent } = logData;
    const sql = `
      INSERT INTO system_logs (user_id, action, description, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `;
    return await this.query(sql, [
      user_id,
      action,
      description,
      ip_address,
      user_agent,
    ]);
  },

  async getSystemLogs(limit = 50) {
    const sql = `
      SELECT sl.*, u.name as user_name, u.email as user_email 
      FROM system_logs sl 
      LEFT JOIN users u ON sl.user_id = u.id 
      ORDER BY sl.created_at DESC 
      LIMIT ?
    `;
    return await this.query(sql, [limit]);
  },

  // Password reset operations (OTP)
  async createPasswordReset(userId, otpCode, expiresAt) {
    const sql = `
      INSERT INTO password_resets (user_id, otp_code, expires_at)
      VALUES (?, ?, ?)
    `;
    return await this.query(sql, [userId, otpCode, expiresAt]);
  },

  async getValidPasswordReset(userId, otpCode) {
    const sql = `
      SELECT * FROM password_resets
      WHERE user_id = ? AND otp_code = ? AND used = FALSE AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const results = await this.query(sql, [userId, otpCode]);
    return results[0];
  },

  async markPasswordResetUsed(id) {
    const sql = `UPDATE password_resets SET used = TRUE WHERE id = ?`;
    return await this.query(sql, [id]);
  },
};

module.exports = {
  pool,
  db,
  initializeDatabase,
};
