const { db } = require("../database");

class InventoryModel {
  static async create({ inventoryid, quantity }) {
    const result = await db.query(
      "INSERT INTO inventory (inventoryid, quantity) VALUES (?, ?)",
      [inventoryid, quantity]
    );
    // db.query returns the result object for INSERT operations
    return { id: result.insertId, inventoryid, quantity };
  }

  static async findAll() {
    const rows = await db.query(
      "SELECT * FROM inventory ORDER BY createdAt DESC"
    );
    return rows;
  }

  static async findById(id) {
    const rows = await db.query("SELECT * FROM inventory WHERE id = ?", [id]);
    return rows[0] || null;
  }

  static async updateById(id, { inventoryid, quantity }) {
    const fields = [];
    const values = [];

    if (quantity !== undefined) {
      fields.push("quantity = ?");
      values.push(quantity);
    }

    if (inventoryid !== undefined) {
      fields.push("inventoryid = ?");
      values.push(inventoryid);
    }

    if (fields.length === 0) {
      throw new Error("No fields to update");
    }

    values.push(id); // Add id for WHERE clause

    const result = await db.query(
      `UPDATE inventory SET ${fields.join(", ")} WHERE id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      throw new Error("Inventory not found");
    }

    // Return the updated record
    return await this.findById(id);
  }

  static async deleteById(id) {
    const result = await db.query("DELETE FROM inventory WHERE id = ?", [id]);
    return result.affectedRows > 0;
  }
}

module.exports = InventoryModel;
