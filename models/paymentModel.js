const { pool } = require("../database");

class PaymentModel {
  // Create a new payment record
  static async createPayment(paymentData) {
    try {
      const {
        payment_id,
        supply_record_id,
        supplier_id,
        amount,
        currency = "LKR",
        payment_method,
        payment_gateway = null,
        gateway_session_id = null,
        gateway_payment_id = null,
        payment_status = "pending",
        payment_notes = null,
        gateway_response = null,
        created_by = null,
      } = paymentData;

      const query = `
        INSERT INTO payments (
          payment_id, supply_record_id, supplier_id, amount, currency,
          payment_method, payment_gateway, gateway_session_id, gateway_payment_id,
          payment_status, payment_notes, gateway_response, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
        payment_id,
        supply_record_id,
        supplier_id,
        amount,
        currency,
        payment_method,
        payment_gateway,
        gateway_session_id,
        gateway_payment_id,
        payment_status,
        payment_notes,
        gateway_response ? JSON.stringify(gateway_response) : null,
        created_by,
      ];

      const [result] = await pool.execute(query, values);

      // Return the created payment
      return await this.findPaymentById(result.insertId);
    } catch (error) {
      console.error("Error creating payment:", error);
      throw error;
    }
  }

  // Find payment by ID
  static async findPaymentById(paymentId) {
    try {
      const query = `
        SELECT 
          p.*,
          sr.supply_id,
          sr.quantity_kg,
          sr.unit_price,
          sr.supply_date,
          u.name as supplier_name,
          u.email as supplier_email,
          creator.name as created_by_name
        FROM payments p
        LEFT JOIN supply_records sr ON p.supply_record_id = sr.id
        LEFT JOIN users u ON p.supplier_id = u.id
        LEFT JOIN users creator ON p.created_by = creator.id
        WHERE p.id = ?
      `;

      const [rows] = await pool.execute(query, [paymentId]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding payment by ID:", error);
      throw error;
    }
  }

  // Find payment by payment_id (external payment ID)
  static async findPaymentByPaymentId(paymentId) {
    try {
      const query = `
        SELECT 
          p.*,
          sr.supply_id,
          sr.quantity_kg,
          sr.unit_price,
          sr.supply_date,
          u.name as supplier_name,
          u.email as supplier_email,
          creator.name as created_by_name
        FROM payments p
        LEFT JOIN supply_records sr ON p.supply_record_id = sr.id
        LEFT JOIN users u ON p.supplier_id = u.id
        LEFT JOIN users creator ON p.created_by = creator.id
        WHERE p.payment_id = ?
      `;

      const [rows] = await pool.execute(query, [paymentId]);
      return rows[0] || null;
    } catch (error) {
      console.error("Error finding payment by payment ID:", error);
      throw error;
    }
  }

  // Find payments by supply record ID
  static async findPaymentsBySupplyRecord(supplyRecordId) {
    try {
      const query = `
        SELECT 
          p.*,
          sr.supply_id,
          sr.quantity_kg,
          sr.unit_price,
          sr.supply_date,
          u.name as supplier_name,
          u.email as supplier_email,
          creator.name as created_by_name
        FROM payments p
        LEFT JOIN supply_records sr ON p.supply_record_id = sr.id
        LEFT JOIN users u ON p.supplier_id = u.id
        LEFT JOIN users creator ON p.created_by = creator.id
        WHERE p.supply_record_id = ?
        ORDER BY p.created_at DESC
      `;

      const [rows] = await pool.execute(query, [supplyRecordId]);

      // mark payment rows' source
      rows.forEach((r) => {
        r.source = "payment";
      });

      return rows;
    } catch (error) {
      console.error("Error finding payments by supply record:", error);
      throw error;
    }
  }

  // Find all payments, optionally including unpaid supply_records as pending entries
  static async findAllPayments(filters = {}) {
    try {
      // Payments query
      let pQuery = `
        SELECT 
          p.*,
          sr.id as supply_record_id,
          sr.supply_id,
          sr.quantity_kg,
          sr.unit_price,
          sr.supply_date,
          u.name as supplier_name,
          u.email as supplier_email,
          creator.name as created_by_name
        FROM payments p
        LEFT JOIN supply_records sr ON p.supply_record_id = sr.id
        LEFT JOIN users u ON p.supplier_id = u.id
        LEFT JOIN users creator ON p.created_by = creator.id
        WHERE 1=1
      `;

      const pValues = [];
      if (filters.supplier_id) {
        pQuery += " AND p.supplier_id = ?";
        pValues.push(filters.supplier_id);
      }
      if (filters.date_from) {
        pQuery += " AND DATE(p.created_at) >= ?";
        pValues.push(filters.date_from);
      }
      if (filters.date_to) {
        pQuery += " AND DATE(p.created_at) <= ?";
        pValues.push(filters.date_to);
      }
      if (filters.search) {
        pQuery += " AND (p.payment_id LIKE ? OR u.name LIKE ?)";
        const sTerm = `%${filters.search}%`;
        pValues.push(sTerm, sTerm);
      }

      pQuery += " ORDER BY p.created_at DESC";
      if (filters.limit) {
        const lim = parseInt(filters.limit) || 0;
        // inject integer limit directly to avoid prepared-statement argument mismatch
        pQuery += ` LIMIT ${lim}`;
      }

      // debug: ensure pValues length matches ? placeholders in pQuery
      const [pRows] = await pool.execute(pQuery, pValues);
      pRows.forEach((r) => (r.source = "payment"));

      // Supply records (unpaid) to include as pending payments
      let srQuery = `
        SELECT
          NULL as id,
          NULL as payment_id,
          sr.id as supply_record_id,
          sr.supplier_id,
          sr.total_payment as amount,
          'LKR' as currency,
          sr.payment_method,
          NULL as payment_gateway,
          NULL as gateway_session_id,
          NULL as gateway_payment_id,
          CASE WHEN sr.payment_status = 'paid' THEN 'completed' ELSE 'pending' END as payment_status,
          sr.notes as payment_notes,
          NULL as gateway_response,
          NULL as created_by,
          sr.created_at,
          sr.supply_id,
          sr.quantity_kg,
          sr.unit_price,
          sr.supply_date,
          u.name as supplier_name,
          u.email as supplier_email
        FROM supply_records sr
        LEFT JOIN users u ON sr.supplier_id = u.id
        WHERE sr.payment_status != 'paid'
          AND NOT EXISTS (SELECT 1 FROM payments p2 WHERE p2.supply_record_id = sr.id)
      `;

      const srValues = [];
      if (filters.supplier_id) {
        srQuery += " AND sr.supplier_id = ?";
        srValues.push(filters.supplier_id);
      }
      if (filters.date_from) {
        srQuery += " AND DATE(sr.supply_date) >= ?";
        srValues.push(filters.date_from);
      }
      if (filters.date_to) {
        srQuery += " AND DATE(sr.supply_date) <= ?";
        srValues.push(filters.date_to);
      }
      if (filters.search) {
        srQuery += " AND (sr.supply_id LIKE ? OR u.name LIKE ?)";
        const sTerm2 = `%${filters.search}%`;
        srValues.push(sTerm2, sTerm2);
      }

      srQuery += " ORDER BY sr.created_at DESC";
      if (filters.limit) {
        const lim = parseInt(filters.limit) || 0;
        srQuery += ` LIMIT ${lim}`;
      }

      const [srRows] = await pool.execute(srQuery, srValues);
      srRows.forEach((r) => (r.source = "supply_record"));

      // Combine and sort
      const combined = [...pRows, ...srRows];
      combined.sort((a, b) => {
        const da = new Date(a.created_at || a.payment_date || 0).getTime();
        const db = new Date(b.created_at || b.payment_date || 0).getTime();
        return db - da;
      });

      if (filters.limit) {
        return combined.slice(0, parseInt(filters.limit));
      }

      return combined;
    } catch (error) {
      console.error("Error finding all payments:", error);
      throw error;
    }
  }

  // Update payment status
  static async updatePaymentStatus(
    paymentId,
    status,
    gatewayResponse = null,
    paymentDate = null
  ) {
    try {
      const query = `
        UPDATE payments 
        SET payment_status = ?, 
            gateway_response = ?,
            payment_date = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      const values = [
        status,
        gatewayResponse ? JSON.stringify(gatewayResponse) : null,
        paymentDate || (status === "completed" ? new Date() : null),
        paymentId,
      ];

      const [result] = await pool.execute(query, values);

      if (result.affectedRows === 0) {
        throw new Error("Payment not found");
      }

      return await this.findPaymentById(paymentId);
    } catch (error) {
      console.error("Error updating payment status:", error);
      throw error;
    }
  }

  // Update payment by payment_id (external)
  static async updatePaymentByPaymentId(paymentId, updateData) {
    try {
      const payment = await this.findPaymentByPaymentId(paymentId);
      if (!payment) {
        throw new Error("Payment not found");
      }

      const {
        payment_status,
        gateway_payment_id,
        gateway_response,
        payment_date,
        payment_notes,
      } = updateData;

      const query = `
        UPDATE payments 
        SET payment_status = ?, 
            gateway_payment_id = ?,
            gateway_response = ?,
            payment_date = ?,
            payment_notes = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE payment_id = ?
      `;

      const values = [
        payment_status || payment.payment_status,
        gateway_payment_id || payment.gateway_payment_id,
        gateway_response
          ? JSON.stringify(gateway_response)
          : payment.gateway_response,
        payment_date || payment.payment_date,
        payment_notes || payment.payment_notes,
        paymentId,
      ];

      await pool.execute(query, values);
      return await this.findPaymentByPaymentId(paymentId);
    } catch (error) {
      console.error("Error updating payment by payment ID:", error);
      throw error;
    }
  }

  // Get payment statistics
  static async getPaymentStatistics(filters = {}) {
    try {
      // First, get stats from payments table
      let pQuery = `
        SELECT 
          COUNT(*) as total_payments,
          SUM(CASE WHEN payment_status = 'completed' THEN amount ELSE 0 END) as total_completed_amount,
          SUM(CASE WHEN payment_status = 'pending' THEN amount ELSE 0 END) as total_pending_amount,
          SUM(CASE WHEN payment_status = 'failed' THEN amount ELSE 0 END) as total_failed_amount,
          COUNT(CASE WHEN payment_status = 'completed' THEN 1 END) as completed_count,
          COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_count,
          COUNT(CASE WHEN payment_status = 'failed' THEN 1 END) as failed_count,
          AVG(CASE WHEN payment_status = 'completed' THEN amount END) as avg_payment_amount
        FROM payments p
        WHERE 1=1
      `;

      const pValues = [];
      if (filters.date_from) {
        pQuery += " AND DATE(p.created_at) >= ?";
        pValues.push(filters.date_from);
      }
      if (filters.date_to) {
        pQuery += " AND DATE(p.created_at) <= ?";
        pValues.push(filters.date_to);
      }
      if (filters.supplier_id) {
        pQuery += " AND p.supplier_id = ?";
        pValues.push(filters.supplier_id);
      }

      const [pRows] = await pool.execute(pQuery, pValues);
      const pStats = pRows[0] || {
        total_payments: 0,
        total_completed_amount: 0,
        total_pending_amount: 0,
        total_failed_amount: 0,
        completed_count: 0,
        pending_count: 0,
        failed_count: 0,
        avg_payment_amount: null,
      };

      // Now get aggregated totals from supply_records for unpaid/pending supplies
      let srQuery = `
        SELECT
          COUNT(*) as sr_total,
          SUM(CASE WHEN sr.payment_status = 'paid' THEN sr.total_payment ELSE 0 END) as sr_completed_amount,
          SUM(CASE WHEN sr.payment_status != 'paid' THEN sr.total_payment ELSE 0 END) as sr_pending_amount,
          COUNT(CASE WHEN sr.payment_status = 'paid' THEN 1 END) as sr_completed_count,
          COUNT(CASE WHEN sr.payment_status != 'paid' THEN 1 END) as sr_pending_count
        FROM supply_records sr
        WHERE 1=1
      `;

      const srValues = [];
      if (filters.date_from) {
        srQuery += " AND DATE(sr.supply_date) >= ?";
        srValues.push(filters.date_from);
      }
      if (filters.date_to) {
        srQuery += " AND DATE(sr.supply_date) <= ?";
        srValues.push(filters.date_to);
      }
      if (filters.supplier_id) {
        srQuery += " AND sr.supplier_id = ?";
        srValues.push(filters.supplier_id);
      }

      const [srRows] = await pool.execute(srQuery, srValues);
      const srStats = srRows[0] || {
        sr_total: 0,
        sr_completed_amount: 0,
        sr_pending_amount: 0,
        sr_completed_count: 0,
        sr_pending_count: 0,
      };

      // Convert values to numbers to ensure frontend displays amounts correctly
      const num = (v) => {
        // handle null, undefined, and strings
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const totalPayments =
        num(pStats.total_payments) + num(srStats.sr_pending_count);
      const totalCompletedAmount =
        num(pStats.total_completed_amount) + num(srStats.sr_completed_amount);
      const totalPendingAmount =
        num(pStats.total_pending_amount) + num(srStats.sr_pending_amount);
      const totalFailedAmount = num(pStats.total_failed_amount);
      const completedCount =
        num(pStats.completed_count) + num(srStats.sr_completed_count);
      const pendingCount =
        num(pStats.pending_count) + num(srStats.sr_pending_count);
      const failedCount = num(pStats.failed_count);
      const avgPaymentAmount =
        pStats.avg_payment_amount == null
          ? null
          : Number(pStats.avg_payment_amount);

      const combined = {
        // snake_case keys
        total_payments: totalPayments,
        total_completed_amount: totalCompletedAmount,
        total_pending_amount: totalPendingAmount,
        total_failed_amount: totalFailedAmount,
        completed_count: completedCount,
        pending_count: pendingCount,
        failed_count: failedCount,
        avg_payment_amount: avgPaymentAmount,
      };

      // Add camelCase / short aliases used by the front-end
      const aliased = {
        totalPayments: combined.total_payments,
        paidAmount: combined.total_completed_amount,
        pendingAmount: combined.total_pending_amount,
        paidCount: combined.completed_count,
        pendingCount: combined.pending_count,
        failedCount: combined.failed_count,
        avgPaymentAmount: combined.avg_payment_amount,
      };

      return { ...combined, ...aliased };
    } catch (error) {
      console.error("Error getting payment statistics:", error);
      throw error;
    }
  }

  // Generate unique payment ID
  static generatePaymentId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");
    return `PAY_${timestamp}_${random}`;
  }
}

module.exports = PaymentModel;
