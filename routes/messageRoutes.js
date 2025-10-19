const express = require("express");
const router = express.Router();
const { pool } = require("../database");

// Get all messages for a user (both sent and received)
router.get("/messages/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const [messages] = await pool.execute(
      `
      SELECT 
        m.*,
        sender.name as sender_name,
        sender.role as sender_role,
        receiver.name as receiver_name,
        receiver.role as receiver_role
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users receiver ON m.receiver_id = receiver.id
      WHERE m.sender_id = ? OR m.receiver_id = ?
      ORDER BY m.created_at DESC
    `,
      [userId, userId]
    );

    res.json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Get messages received by a specific user (receiver_id only)
router.get("/messages/received/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const [messages] = await pool.execute(
      `
      SELECT 
        m.*,
        sender.name as sender_name,
        sender.role as sender_role,
        receiver.name as receiver_name,
        receiver.role as receiver_role
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users receiver ON m.receiver_id = receiver.id
      WHERE m.receiver_id = ?
      ORDER BY m.created_at DESC
    `,
      [userId]
    );

    res.json(messages);
  } catch (error) {
    console.error("Error fetching received messages:", error);
    res.status(500).json({ error: "Failed to fetch received messages" });
  }
});

// Send a new message
router.post("/messages", async (req, res) => {
  try {
    const { sender_id, receiver_id, subject, message } = req.body;

    // Validate required fields
    if (!sender_id || !receiver_id || !subject || !message) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Check if receiver exists
    const [receiverExists] = await pool.execute(
      "SELECT id FROM users WHERE id = ?",
      [receiver_id]
    );

    if (receiverExists.length === 0) {
      return res.status(404).json({ error: "Receiver not found" });
    }

    // Insert the message
    const [result] = await pool.execute(
      `
      INSERT INTO messages (sender_id, receiver_id, subject, message)
      VALUES (?, ?, ?, ?)
    `,
      [sender_id, receiver_id, subject, message]
    );

    // Fetch the created message with user details
    const [newMessage] = await pool.execute(
      `
      SELECT 
        m.*,
        sender.name as sender_name,
        sender.role as sender_role,
        receiver.name as receiver_name,
        receiver.role as receiver_role
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users receiver ON m.receiver_id = receiver.id
      WHERE m.id = ?
    `,
      [result.insertId]
    );

    res.status(201).json(newMessage[0]);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Mark message as read
router.put("/messages/:messageId/read", async (req, res) => {
  try {
    const { messageId } = req.params;

    await pool.execute("UPDATE messages SET is_read = TRUE WHERE id = ?", [
      messageId,
    ]);

    res.json({ message: "Message marked as read" });
  } catch (error) {
    console.error("Error marking message as read:", error);
    res.status(500).json({ error: "Failed to mark message as read" });
  }
});

// Get all suppliers (for managers to send messages to)
router.get("/suppliers", async (req, res) => {
  try {
    const [suppliers] = await pool.execute(
      'SELECT id, name, email FROM users WHERE role = "supplier" AND status = "active"'
    );

    res.json(suppliers);
  } catch (error) {
    console.error("Error fetching suppliers:", error);
    res.status(500).json({ error: "Failed to fetch suppliers" });
  }
});

// Get all managers (for suppliers to see who sent messages)
router.get("/managers", async (req, res) => {
  try {
    const [managers] = await pool.execute(
      'SELECT id, name, email FROM users WHERE role = "manager" AND status = "active"'
    );

    res.json(managers);
  } catch (error) {
    console.error("Error fetching managers:", error);
    res.status(500).json({ error: "Failed to fetch managers" });
  }
});

// Broadcast a message to all suppliers (used by managers)
router.post("/messages/broadcast", async (req, res) => {
  try {
    const { sender_id, subject, message } = req.body;

    if (!sender_id || !subject || !message) {
      return res
        .status(400)
        .json({ error: "sender_id, subject and message are required" });
    }

    // Fetch active suppliers
    const [suppliers] = await pool.execute(
      'SELECT id FROM users WHERE role = "supplier" AND status = "active"'
    );

    if (!suppliers || suppliers.length === 0) {
      return res.status(404).json({ error: "No active suppliers found" });
    }

    // Insert one message per supplier
    const insertPromises = suppliers.map((supplier) => {
      return pool.execute(
        "INSERT INTO messages (sender_id, receiver_id, subject, message) VALUES (?, ?, ?, ?)",
        [sender_id, supplier.id, subject, message]
      );
    });

    await Promise.all(insertPromises);

    res.status(201).json({ success: true, sent: suppliers.length });
  } catch (error) {
    console.error("Error broadcasting message:", error);
    res.status(500).json({ error: "Failed to broadcast message" });
  }
});

module.exports = router;
