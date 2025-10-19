const express = require("express");
const { db } = require("../database");
const router = express.Router();

// GET /api/settings/unit-price - returns the global unit price per kg (string or null)
router.get("/unit-price", async (req, res) => {
  try {
    const val = await db.getSetting("unit_price_per_kg");
    res.json({ success: true, data: { unit_price_per_kg: val } });
  } catch (err) {
    console.error("Error fetching unit price setting", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// PUT /api/settings/unit-price - set the global unit price per kg
router.put("/unit-price", async (req, res) => {
  try {
    const { unit_price_per_kg } = req.body;
    if (
      unit_price_per_kg === undefined ||
      unit_price_per_kg === null ||
      isNaN(parseFloat(unit_price_per_kg))
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid unit price" });
    }
    const value = String(parseFloat(unit_price_per_kg).toFixed(2));
    // Persist new setting
    await db.setSetting("unit_price_per_kg", value);
    // Record history (attempt to read user id from req.user if auth middleware exists)
    const changedBy = req.user && req.user.id ? req.user.id : null;
    try {
      await db.addUnitPriceHistory(value, changedBy);
    } catch (histErr) {
      console.warn(
        "Failed to write unit price history:",
        histErr.message || histErr
      );
    }

    res.json({ success: true, data: { unit_price_per_kg: value } });
  } catch (err) {
    console.error("Error saving unit price setting", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET /api/settings/unit-price/history - returns recent unit price changes
router.get("/unit-price/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const rows = await db.getUnitPriceHistory(limit);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching unit price history", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
