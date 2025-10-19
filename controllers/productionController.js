// Import ProductionModel using createRequire for ES6/CommonJS compatibility
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const ProductionModel = require("../models/productionModel.js");
const InventoryModel = require("../models/inventoryModel.js");

// Generate unique production ID
const generateProductionId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `PROD-${timestamp}-${random}`.toUpperCase();
};

// Create new production record
export const createProduction = async (req, res) => {
  try {
    const { quantity, production_date } = req.body;

    // Validate required fields
    if (!quantity || !production_date) {
      return res.status(400).json({
        success: false,
        message: "Quantity and production date are required",
      });
    }

    // Validate quantity is positive number
    const quantityNum = parseInt(quantity);
    if (isNaN(quantityNum) || quantityNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a positive number",
      });
    }

    // Generate production ID
    const production_id = generateProductionId();

    // Create production time (current time if not provided)
    const production_time = new Date().toTimeString().slice(0, 8);

    // Check if there's enough inventory available
    const allInventory = await InventoryModel.findAll();
    const totalAvailable = allInventory.reduce(
      (sum, item) => sum + (item.quantity || 0),
      0
    );

    if (totalAvailable < quantityNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient inventory. Available: ${totalAvailable} kg, Required: ${quantityNum} kg`,
      });
    }

    // Prepare production data
    const productionData = {
      production_id,
      quantity: quantityNum,
      production_date,
      production_time,
    };

    // Create production record
    const result = await ProductionModel.create(productionData);

    // Deduct quantity from inventory (FIFO - First In First Out)
    let remainingToDeduct = quantityNum;
    const sortedInventory = allInventory.sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    );

    console.log("Starting inventory deduction:", {
      totalToDeduct: quantityNum,
      inventoryItems: sortedInventory.length,
      totalAvailable,
    });

    for (const item of sortedInventory) {
      if (remainingToDeduct <= 0) break;

      const availableInItem = item.quantity || 0;
      if (availableInItem > 0) {
        const deductAmount = Math.min(availableInItem, remainingToDeduct);
        const newQuantity = availableInItem - deductAmount;

        console.log(`Deducting from inventory ${item.id}:`, {
          oldQuantity: availableInItem,
          deductAmount,
          newQuantity,
          remainingToDeduct: remainingToDeduct - deductAmount,
        });

        // Update inventory item
        await InventoryModel.updateById(item.id, { quantity: newQuantity });
        remainingToDeduct -= deductAmount;
      }
    }

    console.log("Inventory deduction completed:", {
      deducted: quantityNum - remainingToDeduct,
      remaining: remainingToDeduct,
    });

    res.status(201).json({
      success: true,
      message: "Production record created successfully and inventory updated",
      data: {
        id: result.insertId,
        production_id,
        quantity: quantityNum,
        production_date,
        production_time,
        inventoryDeducted: quantityNum,
        remainingInventory: totalAvailable - quantityNum,
      },
    });
  } catch (error) {
    console.error("Error creating production:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while creating production record",
      error: error.message,
    });
  }
};

// Get all production records
export const getProductions = async (req, res) => {
  try {
    const productions = await ProductionModel.findAll();

    res.status(200).json({
      success: true,
      message: "Production records retrieved successfully",
      data: productions,
    });
  } catch (error) {
    console.error("Error fetching productions:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching production records",
      error: error.message,
    });
  }
};

// Get production by ID
export const getProductionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Production ID is required",
      });
    }

    const production = await ProductionModel.findById(id);

    if (!production) {
      return res.status(404).json({
        success: false,
        message: "Production record not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Production record retrieved successfully",
      data: production,
    });
  } catch (error) {
    console.error("Error fetching production by ID:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while fetching production record",
      error: error.message,
    });
  }
};
