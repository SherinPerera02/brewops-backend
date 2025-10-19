const { db } = require("../database");

class ProductionModel {
  // Create production record
  static async create(productionData) {
    try {
      const result = await db.createProductionData(productionData);
      return result;
    } catch (error) {
      console.error("ProductionModel.create error:", error);
      throw error;
    }
  }

  // Get all production records
  static async findAll() {
    try {
      const productions = await db.getProductionData();
      return productions || [];
    } catch (error) {
      console.error("ProductionModel.findAll error:", error);
      throw error;
    }
  }

  // Get production by ID
  static async findById(id) {
    try {
      const production = await db.getProductionDataById(id);
      return production;
    } catch (error) {
      console.error("ProductionModel.findById error:", error);
      throw error;

      if (options.offset) {
        query += " OFFSET ?";
        params.push(options.offset);
      }
    }
  }
}

module.exports = ProductionModel;
