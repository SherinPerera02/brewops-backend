// Import InventoryModel using createRequire for ES6/CommonJS compatibility
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const InventoryModel = require("../models/inventoryModel.js");
const SupplierModel = require("../models/supplierModel.js");

// Auto-Generated Inventory ID Function
/**
 * Generate inventory ID format: INV-YYYYMMDD-HHMM
 * @returns {string} Auto-generated inventory ID
 */
export const generateInventoryId = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  return `INV-${year}${month}${day}-${hours}${minutes}`;
};

// Create inventory
export const createInventory = async (req, res) => {
  const maxRetries = 3;
  let retryCount = 0;

  // Accept both quantity_kg (from manager routes) and quantity (legacy)
  const quantity = req.body.quantity_kg || req.body.quantity;

  // Validate required fields
  if (!quantity) {
    console.error("Inventory creation failed: Missing quantity", {
      body: req.body,
    });
    return res.status(400).json({
      success: false,
      message: "Quantity is required",
    });
  }

  console.log("Creating inventory with data:", { quantity, body: req.body });

  // Check total available supply records quantity before creating inventory
  try {
    const allSupplyRecords = await SupplierModel.findAllSupplyRecords();
    const totalSupplyAvailable = allSupplyRecords.reduce(
      (sum, record) => sum + (parseFloat(record.quantity_kg) || 0),
      0
    );

    console.log("Supply records check:", {
      totalSupplyAvailable,
      requestedQuantity: quantity,
      supplyRecordsCount: allSupplyRecords.length,
    });

    if (totalSupplyAvailable < quantity) {
      return res.status(400).json({
        success: false,
        message: `Insufficient supply records. Available: ${totalSupplyAvailable} kg, Required: ${quantity} kg`,
      });
    }
  } catch (error) {
    console.error("Error checking supply records:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check supply records availability",
      error: error.message,
    });
  }

  while (retryCount < maxRetries) {
    try {
      // Auto-generate inventory ID
      const finalInventoryId = generateInventoryId();

      // Add random suffix to reduce collision chance on rapid requests
      const randomSuffix = Math.floor(Math.random() * 100)
        .toString()
        .padStart(2, "0");
      const uniqueInventoryId = `${finalInventoryId}-${randomSuffix}`;

      console.log(
        `Attempt ${
          retryCount + 1
        }: Auto-generated inventory ID: ${uniqueInventoryId}`
      );

      const newInventory = await InventoryModel.create({
        inventoryid: uniqueInventoryId,
        quantity,
      });

      console.log("Inventory created successfully:", {
        inventoryid: uniqueInventoryId,
        quantity,
        attempt: retryCount + 1,
      });

      // Deduct quantity from supply records (FIFO - First In First Out)
      let remainingToDeduct = parseFloat(quantity);
      const allSupplyRecords = await SupplierModel.findAllSupplyRecords();
      const sortedSupplyRecords = allSupplyRecords.sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );

      console.log("Starting supply record deduction:", {
        totalToDeduct: quantity,
        supplyRecordsCount: sortedSupplyRecords.length,
      });

      for (const record of sortedSupplyRecords) {
        if (remainingToDeduct <= 0) break;

        const availableInRecord = parseFloat(record.quantity_kg) || 0;
        if (availableInRecord > 0) {
          const deductAmount = Math.min(availableInRecord, remainingToDeduct);
          const newQuantity = availableInRecord - deductAmount;

          console.log(`Deducting from supply record ${record.id}:`, {
            supplyId: record.supply_id,
            oldQuantity: availableInRecord,
            deductAmount,
            newQuantity,
            remainingToDeduct: remainingToDeduct - deductAmount,
          });

          // Direct SQL update to bypass 15-minute edit window (this is for business logic, not user editing)
          const { pool } = require("../database.js");
          await pool.execute(
            "UPDATE supply_records SET quantity_kg = ?, updated_at = NOW() WHERE id = ?",
            [newQuantity, record.id]
          );

          remainingToDeduct -= deductAmount;
        }
      }

      console.log("Supply record deduction completed:", {
        deducted: parseFloat(quantity) - remainingToDeduct,
        remaining: remainingToDeduct,
      });

      return res.status(201).json({
        success: true,
        data: newInventory,
        message: `Inventory created with auto-generated inventory ID: ${uniqueInventoryId}. ${quantity} kg deducted from supply records.`,
        inventoryIdGenerated: true,
        supplyDeducted: parseFloat(quantity) - remainingToDeduct,
      });
    } catch (error) {
      retryCount++;

      // Check if it's a UNIQUE constraint violation on inventoryid
      const isUniqueConstraintError =
        error.name === "SequelizeUniqueConstraintError" ||
        (error.parent && error.parent.code === "ER_DUP_ENTRY") ||
        (error.message && error.message.includes("UNIQUE constraint failed"));

      if (isUniqueConstraintError && retryCount < maxRetries) {
        console.warn(
          `Inventory ID collision detected. Retry ${retryCount}/${maxRetries}`,
          {
            error: error.message,
            errorCode: error.parent?.code,
          }
        );

        // Add small delay before retry to reduce collision chance
        await new Promise((resolve) =>
          setTimeout(resolve, 50 + Math.random() * 100)
        );
        continue;
      }

      // Log detailed error information
      console.error("Error creating inventory:", {
        error: error.message,
        errorName: error.name,
        errorCode: error.parent?.code,
        retryCount,
        body: req.body,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        message: isUniqueConstraintError
          ? "Failed to generate unique inventory ID after multiple attempts"
          : "Internal server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
};

// Get all inventories
export const getInventories = async (req, res) => {
  try {
    const inventories = await InventoryModel.findAll();
    res.status(200).json({
      success: true,
      data: inventories,
      count: inventories.length,
      message: "Inventories fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching inventories:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Get inventory by ID
export const getInventoryById = async (req, res) => {
  try {
    const inventory = await InventoryModel.findById(req.params.id);

    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: "Inventory not found",
      });
    }

    res.status(200).json({
      success: true,
      data: inventory,
      message: "Inventory fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching inventory by ID:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Update inventory
export const updateInventory = async (req, res) => {
  try {
    // Accept both quantity_kg (from manager routes) and quantity (legacy)
    const quantity = req.body.quantity_kg || req.body.quantity;
    const inventoryid = req.body.inventoryid;

    console.log("Updating inventory with data:", {
      id: req.params.id,
      quantity,
      inventoryid,
      body: req.body,
    });

    // Validate required fields - quantity is required, inventoryid is optional
    if (!quantity) {
      console.error("Inventory update failed: Missing quantity", {
        body: req.body,
      });
      return res.status(400).json({
        success: false,
        message: "Quantity is required",
      });
    }

    // Enforce 15-minute edit window: only allow updates within 15 minutes of creation
    const existing = await InventoryModel.findById(req.params.id);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Inventory not found" });
    }

    const createdAt = new Date(
      existing.createdAt || existing.created_at || existing.createdAt
    );
    const now = new Date();
    const diffMs = now - createdAt;
    const diffMinutes = diffMs / (1000 * 60);
    if (diffMinutes > 15) {
      return res.status(403).json({
        success: false,
        message: "Inventory edit window has expired (15 minutes)",
      });
    }

    const updateData = { quantity };
    if (inventoryid) {
      updateData.inventoryid = inventoryid;
    }

    const updated = await InventoryModel.updateById(req.params.id, updateData);

    console.log("Inventory updated successfully:", {
      id: req.params.id,
      updatedData: updateData,
      result: updated,
    });

    res.status(200).json({
      success: true,
      data: updated,
      message: "Inventory updated successfully",
    });
  } catch (error) {
    console.error("Error updating inventory:", {
      error: error.message,
      errorName: error.name,
      id: req.params.id,
      body: req.body,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// Generate Inventory ID endpoint
export const generateInventoryIdEndpoint = async (req, res) => {
  try {
    // Always generate standard INV-YYYYMMDD-HHMMSS-timestamp format
    const inventoryId = generateInventoryId();

    res.status(200).json({
      success: true,
      data: {
        inventoryId,
        format: "Standard INV-YYYYMMDD-HHMMSS-timestamp",
        timestamp: new Date().toISOString(),
        examples: {
          current: inventoryId,
          another: generateInventoryId(),
        },
      },
      message: "Inventory ID generated successfully",
    });
  } catch (error) {
    console.error("Error generating inventory ID:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
