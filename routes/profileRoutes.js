const express = require("express");
const { db } = require("../database");

const router = express.Router();

// GET /api/users/:id/custom-price - returns custom price for user
router.get("/:id/custom-price", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: "Invalid user id" });
    const price = await db.getUserCustomAvgPrice(id);
    res.json({ success: true, data: { custom_avg_price: price } });
  } catch (error) {
    console.error("Error fetching custom price:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PUT /api/users/:id/custom-price - update custom price for user
router.put("/:id/custom-price", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ message: "Invalid user id" });
    const { custom_avg_price } = req.body;
    const price =
      custom_avg_price === null || custom_avg_price === ""
        ? null
        : parseFloat(custom_avg_price);
    if (
      custom_avg_price !== null &&
      custom_avg_price !== "" &&
      (isNaN(price) || price <= 0)
    ) {
      return res.status(400).json({ message: "Invalid price value" });
    }
    await db.setUserCustomAvgPrice(id, price);
    res.json({
      success: true,
      message: "Custom price updated",
      data: { custom_avg_price: price },
    });
  } catch (error) {
    console.error("Error updating custom price:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
