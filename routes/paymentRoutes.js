const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const PaymentModel = require("../models/paymentModel");
const SupplierModel = require("../models/supplierModel");

// Payment Gateway Integration Routes

// Create payment session for monthly payments
router.post("/gateway", authenticateToken, async (req, res) => {
  try {
    const {
      amount,
      currency = "LKR",
      description,
      supplier_name,
      supplier_email,
      supply_record_id,
    } = req.body;

    // Validate required fields
    if (!amount || !description || !supply_record_id) {
      return res.status(400).json({
        success: false,
        message: "Amount, description, and supply_record_id are required",
      });
    }

    // Generate unique payment ID
    const payment_id = PaymentModel.generatePaymentId();
    const session_id = `session_${Date.now()}_${supply_record_id}`;

    // Create payment record in database
    const paymentData = {
      payment_id: payment_id,
      supply_record_id: supply_record_id,
      supplier_id: req.user?.id || null,
      amount: parseFloat(amount),
      currency: currency,
      payment_method: "gateway",
      payment_gateway: process.env.PAYMENT_GATEWAY_PROVIDER || "demo",
      gateway_session_id: session_id,
      payment_status: "pending",
      payment_notes: description,
      created_by: req.user?.id || null,
    };

    // Save payment to database
    const payment = await PaymentModel.createPayment(paymentData);

    // Demo payment gateway URL
    const returnUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/payment-result/success`;
    const cancelUrl = `${
      process.env.FRONTEND_URL || "http://localhost:3000"
    }/payment-result/cancel`;

    const paymentUrl = `${
      process.env.PAYMENT_GATEWAY_URL || "https://demo-payment-gateway.com"
    }/checkout?session_id=${session_id}&payment_id=${payment_id}&amount=${amount}&currency=${currency}&return_url=${encodeURIComponent(
      returnUrl
    )}&cancel_url=${encodeURIComponent(cancelUrl)}`;

    console.log("Payment session created:", {
      payment_id: payment.payment_id,
      session_id: session_id,
      amount: payment.amount,
      supplier: supplier_name,
    });

    res.json({
      success: true,
      message: "Payment session created successfully",
      payment_id: payment.payment_id,
      session_id: session_id,
      payment_url: paymentUrl,
      amount: payment.amount,
      currency: payment.currency,
    });
  } catch (error) {
    console.error("Payment gateway error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create payment session",
    });
  }
});

// Payment success callback (webhook)
router.post("/callback/success", async (req, res) => {
  try {
    const {
      session_id,
      payment_id,
      status,
      supply_record_id,
      gateway_payment_id,
    } = req.body;

    console.log("Payment success callback:", {
      session_id,
      payment_id,
      status,
      supply_record_id,
      gateway_payment_id,
    });

    if (status === "completed" && payment_id) {
      const payment = await PaymentModel.findPaymentByPaymentId(payment_id);

      if (payment) {
        await PaymentModel.updatePaymentByPaymentId(payment_id, {
          payment_status: "completed",
          gateway_payment_id: gateway_payment_id,
          payment_date: new Date(),
          gateway_response: req.body,
        });

        const { pool } = require("../database");
        await pool.execute(
          "UPDATE supply_records SET payment_status = ? WHERE id = ?",
          ["paid", payment.supply_record_id]
        );

        console.log(
          `Payment ${payment_id} completed and supply record ${payment.supply_record_id} marked as paid`
        );
      } else {
        console.error(`Payment not found: ${payment_id}`);
      }
    }

    res.json({
      success: true,
      message: "Payment processed successfully",
    });
  } catch (error) {
    console.error("Payment callback error:", error);
    res.status(500).json({
      success: false,
      message: "Payment callback processing failed",
    });
  }
});

// Payment failure callback
router.post("/callback/failure", async (req, res) => {
  try {
    const { session_id, error_code, error_message, supply_record_id } =
      req.body;

    console.log("Payment failure callback:", {
      session_id,
      error_code,
      error_message,
      supply_record_id,
    });

    res.json({
      success: true,
      message: "Payment failure processed",
    });
  } catch (error) {
    console.error("Payment failure callback error:", error);
    res.status(500).json({
      success: false,
      message: "Payment failure callback processing failed",
    });
  }
});

// Get payment status
router.get("/status/:session_id", authenticateToken, async (req, res) => {
  try {
    const { session_id } = req.params;

    res.json({
      success: true,
      session_id,
      status: "pending",
      message: "Payment status retrieved successfully",
    });
  } catch (error) {
    console.error("Payment status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payment status",
    });
  }
});

// Get all payments with filtering
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const {
      supplier_id,
      payment_status,
      payment_method,
      date_from,
      date_to,
      search,
      limit = 100,
    } = req.query;

    const filters = {
      supplier_id,
      payment_status,
      payment_method,
      date_from,
      date_to,
      search,
      limit,
    };

    const payments = await PaymentModel.findAllPayments(filters);

    res.json({
      success: true,
      message: "Payment history retrieved successfully",
      data: payments,
      count: payments.length,
    });
  } catch (error) {
    console.error("Payment history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payment history",
    });
  }
});

// Get payment statistics
router.get("/statistics", authenticateToken, async (req, res) => {
  try {
    const { date_from, date_to, supplier_id } = req.query;

    const filters = { date_from, date_to, supplier_id };
    const stats = await PaymentModel.getPaymentStatistics(filters);

    res.json({
      success: true,
      message: "Payment statistics retrieved successfully",
      data: stats,
    });
  } catch (error) {
    console.error("Payment statistics error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve payment statistics",
    });
  }
});

// Get payments by supply record ID
router.get("/supply-record/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const payments = await PaymentModel.findPaymentsBySupplyRecord(id);

    res.json({
      success: true,
      message: "Supply record payments retrieved successfully",
      data: payments,
    });
  } catch (error) {
    console.error("Supply record payments error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve supply record payments",
    });
  }
});

// Create direct payment (for spot payments)
router.post("/direct", authenticateToken, async (req, res) => {
  try {
    console.log("=== DIRECT PAYMENT REQUEST ===");
    console.log("Request body:", req.body);
    console.log("User:", req.user);

    const {
      supply_record_id,
      supplier_id,
      amount,
      payment_method = "spot",
      payment_notes,
    } = req.body;

    if (!supply_record_id || !supplier_id || !amount) {
      console.error("Missing required fields:", {
        supply_record_id,
        supplier_id,
        amount,
      });
      return res.status(400).json({
        success: false,
        message: "Supply record ID, supplier ID, and amount are required",
      });
    }

    const payment_id = PaymentModel.generatePaymentId();
    console.log("Generated payment ID:", payment_id);

    const paymentData = {
      payment_id,
      supply_record_id,
      supplier_id,
      amount: parseFloat(amount),
      payment_method,
      payment_status: "completed",
      payment_notes,
      created_by: req.user?.id,
    };

    console.log("Creating payment with data:", paymentData);
    const payment = await PaymentModel.createPayment(paymentData);
    console.log("Payment created successfully:", payment);

    // Update supply record payment status
    console.log("Updating supply record status to paid...");
    const { pool } = require("../database");
    await pool.execute(
      "UPDATE supply_records SET payment_status = ? WHERE id = ?",
      ["paid", supply_record_id]
    );
    console.log("Supply record updated successfully");

    res.json({
      success: true,
      message: "Payment processed successfully",
      data: payment,
    });
  } catch (error) {
    console.error("=== DIRECT PAYMENT ERROR ===");
    console.error("Error name:", error.name);
    console.error("Error message:", error.message);
    console.error("Error code:", error.code);
    console.error("Error stack:", error.stack);
    console.error("Full error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process payment",
      error: error.code || "UNKNOWN_ERROR",
    });
  }
});

module.exports = router;
