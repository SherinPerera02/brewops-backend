const { pool } = require("../database");

class SupplierModel {
  // Get all suppliers (fixed version)
  static async findAll() {
    try {
      const [rows] = await pool.execute(`
        SELECT id, name, email, phone, supplier_id, created_at, status, role,
               address, bank_name, account_number, account_holder_name, bank_branch, bank_code
        FROM users 
        WHERE role = 'supplier'
        ORDER BY created_at DESC
      `);

      // Auto-generate supplier_id for existing suppliers that don't have one
      for (const row of rows) {
        if (
          !row.supplier_id ||
          row.supplier_id === "" ||
          row.supplier_id === null
        ) {
          // Generate supplier_id for suppliers that don't have one
          const newSupplierId = await this.generateSupplierId();
          await pool.execute(
            'UPDATE users SET supplier_id = ? WHERE id = ? AND role = "supplier"',
            [newSupplierId, row.id]
          );
          row.supplier_id = newSupplierId;
        }

        // Mask account number for security
        if (row.account_number) {
          row.account_number = "***" + row.account_number.slice(-4);
        }
      }

      return rows;
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      throw new Error(`Failed to fetch suppliers: ${error.message}`);
    }
  }

  // Find supplier by ID
  static async findById(id, maskBankDetails = true) {
    try {
      console.log(
        "SupplierModel.findById called with ID:",
        id,
        "Type:",
        typeof id
      );

      const [rows] = await pool.execute(
        `
        SELECT id, name, email, phone, supplier_id, created_at, status, role,
               address, bank_name, account_number, account_holder_name, bank_branch, bank_code
        FROM users 
        WHERE id = ? AND role = 'supplier'
      `,
        [id]
      );

      console.log("Query returned", rows.length, "rows");

      const supplier = rows[0] || null;

      // If not found, check if user exists with different role for debugging
      if (!supplier) {
        const [checkRows] = await pool.execute(
          "SELECT id, name, role FROM users WHERE id = ?",
          [id]
        );

        if (checkRows.length > 0) {
          console.error('ERROR: User exists but role is not "supplier"');
          console.error("User details:", checkRows[0]);
        } else {
          console.error("ERROR: No user exists with ID:", id);
        }
      } else {
        console.log("Supplier found:", supplier.name, "(ID:", supplier.id, ")");
      }

      // Mask account number for security (unless explicitly requested not to)
      if (supplier && supplier.account_number && maskBankDetails) {
        supplier.account_number = "***" + supplier.account_number.slice(-4);
      }

      return supplier;
    } catch (error) {
      console.error("Error fetching supplier by ID:", error);
      throw new Error(`Failed to fetch supplier: ${error.message}`);
    }
  }

  // Create supply record
  static async createSupplyRecord(data) {
    const {
      supplier_id,
      quantity,
      unit_price,
      total_payment,
      payment_method = "spot",
      payment_status = "unpaid",
      supply_date,
      notes,
    } = data;

    try {
      // Generate supply record ID
      const supplyId = await this.generateSupplyId();

      const [result] = await pool.execute(
        `
        INSERT INTO supply_records (
          supply_id, supplier_id, quantity_kg, unit_price, total_payment,
          payment_method, payment_status, supply_date, supply_time, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          supplyId,
          supplier_id,
          quantity,
          unit_price,
          total_payment,
          payment_method,
          payment_status,
          supply_date,
          new Date().toTimeString().slice(0, 8), // Current time in HH:MM:SS format
          notes,
        ]
      );

      return {
        id: supplyId,
        supply_id: supplyId,
        supplier_id,
        quantity_kg: quantity,
        unit_price,
        total_payment,
        payment_method,
        payment_status,
        supply_date,
        supply_time: new Date().toTimeString().slice(0, 8),
        notes,
        created_at: new Date(),
      };
    } catch (error) {
      console.error("Error creating supply record:", error);
      throw new Error("Failed to create supply record");
    }
  }

  // Get all supply records with supplier details
  static async findAllSupplyRecords() {
    try {
      const [rows] = await pool.execute(`
        SELECT 
          sr.*,
          u.name as supplier_name,
          u.email as supplier_email,
          u.phone as supplier_phone,
          u.supplier_id as supplier_code
        FROM supply_records sr
        LEFT JOIN users u ON sr.supplier_id = u.id AND u.role = 'supplier'
        ORDER BY sr.created_at DESC
      `);

      // Ensure all records have supply_id
      for (const row of rows) {
        if (!row.supply_id || row.supply_id === "") {
          // Generate supply_id for records that don't have one
          const newSupplyId = await this.generateSupplyId();
          await pool.execute(
            "UPDATE supply_records SET supply_id = ? WHERE id = ?",
            [newSupplyId, row.id]
          );
          row.supply_id = newSupplyId;
        }
      }

      return rows;
    } catch (error) {
      console.error("Error fetching supply records:", error);
      throw new Error("Failed to fetch supply records");
    }
  }

  // Find supply record by ID
  static async findSupplyRecordById(id, maskBankDetails = true) {
    try {
      const [rows] = await pool.execute(
        `
        SELECT 
          sr.*,
          u.name as supplier_name,
          u.email as supplier_email,
          u.phone as supplier_phone,
          u.address as supplier_address,
          u.bank_name as supplier_bank_name,
          u.account_number as supplier_account_number,
          u.account_holder_name as supplier_account_holder_name,
          u.bank_branch as supplier_bank_branch,
          u.bank_code as supplier_bank_code,
          u.supplier_id as supplier_code
        FROM supply_records sr
        LEFT JOIN users u ON sr.supplier_id = u.id AND u.role = 'supplier'
        WHERE sr.id = ?
      `,
        [id]
      );

      const record = rows[0] || null;

      if (record) {
        // Format the response with supply_record and supplier objects
        return {
          supply_record: {
            id: record.id,
            supply_id: record.supply_id,
            supplier_id: record.supplier_id,
            quantity_kg: record.quantity_kg,
            remaining_quantity_kg: record.remaining_quantity_kg,
            unit_price: record.unit_price,
            total_payment: record.total_payment,
            payment_method: record.payment_method,
            payment_status: record.payment_status,
            supply_date: record.supply_date,
            supply_time: record.supply_time,
            notes: record.notes,
            created_at: record.created_at,
            updated_at: record.updated_at,
          },
          supplier: {
            id: record.supplier_id,
            name: record.supplier_name,
            email: record.supplier_email,
            phone: record.supplier_phone,
            supplier_id: record.supplier_code,
            address: record.supplier_address,
            bank_name: record.supplier_bank_name,
            account_number:
              maskBankDetails && record.supplier_account_number
                ? "***" + record.supplier_account_number.slice(-4)
                : record.supplier_account_number,
            account_holder_name: record.supplier_account_holder_name,
            bank_branch: record.supplier_bank_branch,
            bank_code: record.supplier_bank_code,
          },
        };
      }

      return null;
    } catch (error) {
      console.error("Error fetching supply record by ID:", error);
      throw new Error("Failed to fetch supply record");
    }
  }

  // Update supply record
  static async updateSupplyRecord(id, data) {
    try {
      // First, check if the record exists and get its creation time
      const [existingRecord] = await pool.execute(
        `SELECT id, created_at FROM supply_records WHERE id = ?`,
        [id]
      );

      if (existingRecord.length === 0) {
        throw new Error("Supply record not found");
      }

      // Check if the record is within the 15-minute edit window
      const createdAt = new Date(existingRecord[0].created_at);
      const currentTime = new Date();
      const timeDifference = (currentTime - createdAt) / (1000 * 60); // Difference in minutes

      if (timeDifference > 15) {
        throw new Error(
          "Supply record can only be edited within 15 minutes of creation. This record was created more than 15 minutes ago."
        );
      }

      const fields = [];
      const values = [];

      // Build dynamic update query with field name mapping
      Object.keys(data).forEach((key) => {
        if (data[key] !== undefined && key !== "id") {
          // Map quantity to quantity_kg for database compatibility
          const dbFieldName = key === "quantity" ? "quantity_kg" : key;
          fields.push(`${dbFieldName} = ?`);
          values.push(data[key]);
        }
      });

      if (fields.length === 0) {
        throw new Error("No fields to update");
      }

      values.push(id);

      const [result] = await pool.execute(
        `
        UPDATE supply_records 
        SET ${fields.join(", ")}, updated_at = NOW()
        WHERE id = ?
      `,
        values
      );

      if (result.affectedRows === 0) {
        throw new Error("Supply record not found");
      }

      return await this.findSupplyRecordById(id);
    } catch (error) {
      console.error("Error updating supply record:", error);
      throw new Error(error.message || "Failed to update supply record");
    }
  }

  // Delete supply record
  static async deleteSupplyRecord(id) {
    try {
      // First, check if the record exists and get its creation time
      const [existingRecord] = await pool.execute(
        `SELECT id, created_at FROM supply_records WHERE id = ?`,
        [id]
      );

      if (existingRecord.length === 0) {
        throw new Error("Supply record not found");
      }

      // Check if the record is within the 15-minute edit window
      const createdAt = new Date(existingRecord[0].created_at);
      const currentTime = new Date();
      const timeDifference = (currentTime - createdAt) / (1000 * 60); // Difference in minutes

      if (timeDifference > 15) {
        throw new Error(
          "Supply record can only be deleted within 15 minutes of creation. This record was created more than 15 minutes ago."
        );
      }

      const [result] = await pool.execute(
        "DELETE FROM supply_records WHERE id = ?",
        [id]
      );

      if (result.affectedRows === 0) {
        throw new Error("Supply record not found");
      }

      return { message: "Supply record deleted successfully" };
    } catch (error) {
      console.error("Error deleting supply record:", error);
      throw new Error("Failed to delete supply record");
    }
  }

  // Update payment status
  static async updatePaymentStatus(id, paymentStatus) {
    try {
      const [result] = await pool.execute(
        `
        UPDATE supply_records 
        SET payment_status = ?, updated_at = NOW()
        WHERE id = ?
      `,
        [paymentStatus, id]
      );

      if (result.affectedRows === 0) {
        throw new Error("Supply record not found");
      }

      return await this.findSupplyRecordById(id);
    } catch (error) {
      console.error("Error updating payment status:", error);
      throw new Error("Failed to update payment status");
    }
  }

  // Generate unique supply ID
  static async generateSupplyId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");

    const baseId = `SUP-${year}${month}${day}-${hours}${minutes}`;

    // Check if ID exists and add suffix if needed
    let supplyId = baseId;
    let counter = 1;

    while (await this.supplyIdExists(supplyId)) {
      supplyId = `${baseId}-${counter.toString().padStart(2, "0")}`;
      counter++;
    }

    return supplyId;
  }

  // Check if supply ID exists
  static async supplyIdExists(supplyId) {
    try {
      const [rows] = await pool.execute(
        "SELECT id FROM supply_records WHERE supply_id = ?",
        [supplyId]
      );
      return rows.length > 0;
    } catch (error) {
      console.error("Error checking supply ID existence:", error);
      return false;
    }
  }

  // Generate unique supplier ID in format SUP000001
  static async generateSupplierId() {
    try {
      console.log("Starting supplier ID generation...");

      // Get all existing supplier ID numbers and find the highest
      const [rows] = await pool.execute(`
        SELECT supplier_id FROM users 
        WHERE role = 'supplier' AND supplier_id IS NOT NULL AND supplier_id != '' 
        AND supplier_id REGEXP '^SUP[0-9]{6}$'
        ORDER BY CAST(SUBSTRING(supplier_id, 4) AS UNSIGNED) DESC
      `);

      console.log("Existing supplier IDs query result:", rows);

      let nextNumber = 1;
      if (rows && rows.length > 0) {
        // Extract numbers from all supplier IDs and find the maximum
        let maxNumber = 0;
        for (const row of rows) {
          if (row.supplier_id) {
            const match = row.supplier_id.match(/SUP(\d{6})/);
            if (match && match[1]) {
              const num = parseInt(match[1]);
              if (!isNaN(num) && num > maxNumber) {
                maxNumber = num;
              }
            }
          }
        }
        nextNumber = maxNumber + 1;
        console.log(
          "Highest existing number:",
          maxNumber,
          "Next number:",
          nextNumber
        );
      } else {
        console.log("No existing supplier IDs found, starting with 1");
      }

      // Try to generate a unique ID (with retry mechanism)
      let attempts = 0;
      let supplierId = "";

      while (attempts < 10) {
        supplierId = `SUP${(nextNumber + attempts)
          .toString()
          .padStart(6, "0")}`;
        console.log(
          `Attempt ${attempts + 1}: Generated supplier ID: ${supplierId}`
        );

        // Check if this ID already exists
        const exists = await this.supplierIdExists(supplierId);
        console.log(`ID ${supplierId} exists: ${exists}`);

        if (!exists) {
          console.log("Found unique ID:", supplierId);
          break;
        }

        attempts++;
      }

      // Final validation
      if (!supplierId || supplierId === "" || !supplierId.startsWith("SUP")) {
        console.error("Invalid supplier ID generated:", supplierId);
        throw new Error("Invalid supplier ID generated");
      }

      if (attempts >= 10) {
        console.error(
          "Could not generate unique supplier ID after 10 attempts"
        );
        throw new Error("Could not generate unique supplier ID");
      }

      console.log("Final supplier ID:", supplierId);
      return supplierId;
    } catch (error) {
      console.error("Error generating supplier ID:", error);
      // Return a fallback ID if all else fails
      const fallbackId = `SUP${Date.now().toString().slice(-6)}`;
      console.log("Using fallback ID:", fallbackId);
      return fallbackId;
    }
  }

  // Check if supplier ID exists
  static async supplierIdExists(supplierId) {
    try {
      const [rows] = await pool.execute(
        "SELECT id FROM users WHERE supplier_id = ? AND role = 'supplier'",
        [supplierId]
      );
      return rows.length > 0;
    } catch (error) {
      console.error("Error checking supplier ID existence:", error);
      return false;
    }
  }

  // Get current supplier ID statistics
  static async getSupplierIdStats() {
    try {
      const [allSuppliers] = await pool.execute(
        "SELECT id, name, email, supplier_id FROM users WHERE role = 'supplier' ORDER BY id ASC"
      );

      const stats = {
        totalSuppliers: allSuppliers.length,
        suppliersWithIds: 0,
        suppliersWithoutIds: 0,
        highestIdNumber: 0,
        allIds: [],
      };

      for (const supplier of allSuppliers) {
        if (supplier.supplier_id && supplier.supplier_id !== "") {
          stats.suppliersWithIds++;
          stats.allIds.push(supplier.supplier_id);

          // Extract number from ID
          const match = supplier.supplier_id.match(/SUP(\d{6})/);
          if (match && match[1]) {
            const num = parseInt(match[1]);
            if (!isNaN(num) && num > stats.highestIdNumber) {
              stats.highestIdNumber = num;
            }
          }
        } else {
          stats.suppliersWithoutIds++;
        }
      }

      return { stats, suppliers: allSuppliers };
    } catch (error) {
      console.error("Error getting supplier ID statistics:", error);
      throw error;
    }
  }

  // Reset and regenerate all supplier IDs (use carefully!)
  static async resetAllSupplierIds() {
    try {
      console.log("Starting supplier ID reset process...");

      // Get all suppliers without supplier_id or with invalid supplier_id
      const [suppliers] = await pool.execute(
        `SELECT id, name, email FROM users 
         WHERE role = 'supplier' 
         ORDER BY id ASC`
      );

      console.log(`Found ${suppliers.length} suppliers to process`);

      let counter = 1;
      for (const supplier of suppliers) {
        const newSupplierId = `SUP${counter.toString().padStart(6, "0")}`;

        await pool.execute(
          "UPDATE users SET supplier_id = ? WHERE id = ? AND role = 'supplier'",
          [newSupplierId, supplier.id]
        );

        console.log(
          `Updated supplier ${supplier.name} (ID: ${supplier.id}) to ${newSupplierId}`
        );
        counter++;
      }

      console.log("Supplier ID reset completed successfully");
      return {
        updated: suppliers.length,
        message: "All supplier IDs reset successfully",
      };
    } catch (error) {
      console.error("Error resetting supplier IDs:", error);
      throw error;
    }
  }

  // Deactivate suppliers who have been inactive for 6 months
  // Criteria:
  // - user.role = 'supplier'
  // - user.status = 'active'
  // - user.created_at is older than 6 months
  // - AND there are no supply_records for that supplier within the last 6 months
  static async deactivateOldSuppliers() {
    try {
      const [result] = await pool.execute(
        `
        UPDATE users u
        LEFT JOIN (
          SELECT DISTINCT supplier_id FROM supply_records
          WHERE supply_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
        ) recent ON recent.supplier_id = u.id
        SET u.status = 'inactive', u.updated_at = NOW()
        WHERE u.role = 'supplier'
          AND u.status = 'active'
          AND u.created_at <= DATE_SUB(NOW(), INTERVAL 6 MONTH)
          AND recent.supplier_id IS NULL
      `
      );

      const affected = result && result.affectedRows ? result.affectedRows : 0;
      console.log(
        `Supplier deactivation job: ${affected} supplier(s) set to inactive`
      );
      return affected;
    } catch (error) {
      console.error("Error running deactivateOldSuppliers:", error);
      throw error;
    }
  }
}

module.exports = SupplierModel;
