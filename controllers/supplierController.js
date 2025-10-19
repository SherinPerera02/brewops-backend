const SupplierModel = require("../models/supplierModel");

class SupplierController {
  // Get all suppliers
  static async getAllSuppliers(req, res) {
    try {
      const suppliers = await SupplierModel.findAll();
      // Return direct array for frontend compatibility
      res.json(suppliers);
    } catch (error) {
      console.error("Get suppliers error:", error);
      res
        .status(500)
        .json({ message: error.message || "Failed to fetch suppliers" });
    }
  }

  // Get supplier by ID
  static async getSupplierById(req, res) {
    try {
      const { id } = req.params;
      console.log("=== GET SUPPLIER BY ID ===");
      console.log("Requested supplier ID:", id);
      console.log("ID type:", typeof id);

      // Check if full bank details are requested (for payment processing)
      const includeFullBankDetails = req.query.fullBankDetails === "true";
      console.log("Include full bank details:", includeFullBankDetails);

      const supplier = await SupplierModel.findById(
        id,
        !includeFullBankDetails
      );

      console.log("Supplier query result:", supplier ? "Found" : "Not found");

      if (!supplier) {
        console.error("ERROR: Supplier not found in database");
        console.error("Searched ID:", id);
        console.error("This means either:");
        console.error("1. No user exists with this ID");
        console.error('2. User exists but role is not "supplier"');
        console.error("3. Supply record has invalid supplier_id reference");

        return res.status(404).json({
          success: false,
          message: "Supplier not found",
          debug: {
            searchedId: id,
            idType: typeof id,
          },
        });
      }

      console.log("✓ Supplier found:", supplier.name);

      res.json({
        success: true,
        message: "Supplier fetched successfully",
        data: supplier,
      });
    } catch (error) {
      console.error("Get supplier by ID error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch supplier",
      });
    }
  }

  // Create supply record
  static async createSupplyRecord(req, res) {
    try {
      const {
        supplier_id,
        quantity,
        quantity_kg,
        unit_price,
        payment_method = "spot",
        payment_status = "unpaid",
        supply_date,
        notes,
      } = req.body;

      // Handle both quantity and quantity_kg field names for compatibility
      const finalQuantity = quantity_kg || quantity;

      // Validation
      if (!supplier_id || !finalQuantity || !unit_price || !supply_date) {
        return res.status(400).json({
          success: false,
          message:
            "Supplier ID, quantity, unit price, and supply date are required",
        });
      }

      // Calculate total payment
      const total_payment = parseFloat(finalQuantity) * parseFloat(unit_price);

      // Verify supplier exists
      const supplier = await SupplierModel.findById(supplier_id);
      if (!supplier) {
        return res.status(400).json({
          success: false,
          message: "Invalid supplier ID",
        });
      }

      const supplyRecord = await SupplierModel.createSupplyRecord({
        supplier_id,
        quantity: parseFloat(finalQuantity),
        unit_price: parseFloat(unit_price),
        total_payment,
        payment_method,
        payment_status,
        supply_date,
        notes,
      });

      res.status(201).json({
        success: true,
        message: "Supply record created successfully",
        data: supplyRecord,
      });
    } catch (error) {
      console.error("Create supply record error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to create supply record",
      });
    }
  }

  // Get all supply records
  static async getAllSupplyRecords(req, res) {
    try {
      const supplyRecords = await SupplierModel.findAllSupplyRecords();
      res.json({
        success: true,
        message: "Supply records fetched successfully",
        data: supplyRecords,
      });
    } catch (error) {
      console.error("Get supply records error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch supply records",
      });
    }
  }

  // Get supply record by ID
  static async getSupplyRecordById(req, res) {
    try {
      const { id } = req.params;
      const { fullBankDetails } = req.query;

      // Pass maskBankDetails parameter - false if fullBankDetails=true
      const maskBankDetails = fullBankDetails !== "true";
      const supplyRecord = await SupplierModel.findSupplyRecordById(
        id,
        maskBankDetails
      );

      if (!supplyRecord) {
        return res.status(404).json({
          success: false,
          message: "Supply record not found",
        });
      }

      res.json({
        success: true,
        message: "Supply record fetched successfully",
        data: supplyRecord,
      });
    } catch (error) {
      console.error("Get supply record by ID error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to fetch supply record",
      });
    }
  }

  // Update supply record
  static async updateSupplyRecord(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      // Handle both quantity and quantity_kg field names
      if (updateData.quantity_kg) {
        updateData.quantity = updateData.quantity_kg;
        delete updateData.quantity_kg;
      }

      // If quantity or unit_price is updated, recalculate total_payment
      if (updateData.quantity || updateData.unit_price) {
        const currentRecord = await SupplierModel.findSupplyRecordById(id);
        if (!currentRecord) {
          return res.status(404).json({
            success: false,
            message: "Supply record not found",
          });
        }

        const quantity = parseFloat(
          updateData.quantity || currentRecord.quantity_kg
        );
        const unit_price = parseFloat(
          updateData.unit_price || currentRecord.unit_price
        );
        updateData.total_payment = quantity * unit_price;
      }

      const updatedRecord = await SupplierModel.updateSupplyRecord(
        id,
        updateData
      );

      res.json({
        success: true,
        message: "Supply record updated successfully",
        data: updatedRecord,
      });
    } catch (error) {
      console.error("Update supply record error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update supply record",
      });
    }
  }

  // Delete supply record
  static async deleteSupplyRecord(req, res) {
    try {
      const { id } = req.params;

      // Check if record exists
      const existingRecord = await SupplierModel.findSupplyRecordById(id);
      if (!existingRecord) {
        return res.status(404).json({
          success: false,
          message: "Supply record not found",
        });
      }

      await SupplierModel.deleteSupplyRecord(id);

      res.json({
        success: true,
        message: "Supply record deleted successfully",
      });
    } catch (error) {
      console.error("Delete supply record error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to delete supply record",
      });
    }
  }

  // Update payment status
  static async updatePaymentStatus(req, res) {
    try {
      const { id } = req.params;
      const { payment_status } = req.body;

      // Validate payment status
      if (!payment_status || !["paid", "unpaid"].includes(payment_status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid payment status. Must be "paid" or "unpaid"',
        });
      }

      const updatedRecord = await SupplierModel.updatePaymentStatus(
        id,
        payment_status
      );

      res.json({
        success: true,
        message: "Payment status updated successfully",
        data: updatedRecord,
      });
    } catch (error) {
      console.error("Update payment status error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to update payment status",
      });
    }
  }

  // Mark payment as paid
  static async markPaymentAsPaid(req, res) {
    try {
      const { id } = req.params;

      const updatedRecord = await SupplierModel.updatePaymentStatus(id, "paid");

      res.json({
        success: true,
        message: "Payment marked as paid successfully",
        data: updatedRecord,
      });
    } catch (error) {
      console.error("Mark payment as paid error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to mark payment as paid",
      });
    }
  }
}

module.exports = SupplierController;
