const { pool } = require("./database");

async function updateSupplierIds() {
  try {
    // Get all suppliers without supplier_id
    const [suppliers] = await pool.execute(
      `SELECT id, name FROM users WHERE role = 'supplier' AND (supplier_id IS NULL OR supplier_id = '')`
    );

    console.log(`Found ${suppliers.length} suppliers without supplier_id`);

    for (const supplier of suppliers) {
      // Generate a supplier ID (format: SUP + ID padded to 4 digits)
      const supplierId = `SUP${supplier.id.toString().padStart(4, "0")}`;

      // Update the supplier
      await pool.execute(`UPDATE users SET supplier_id = ? WHERE id = ?`, [
        supplierId,
        supplier.id,
      ]);

      console.log(
        `Updated supplier ${supplier.name} (ID: ${supplier.id}) with supplier_id: ${supplierId}`
      );
    }

    console.log("All suppliers updated successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error updating supplier IDs:", error);
    process.exit(1);
  }
}

// Run the update
updateSupplierIds();
