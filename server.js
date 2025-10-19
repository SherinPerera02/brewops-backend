const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { initializeDatabase } = require("./database");

// Import routes
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const adminRoutes = require("./routes/adminRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const staffRoutes = require("./routes/staffRoutes");
const managerRoutes = require("./routes/managerRoutes");
const messageRoutes = require("./routes/messageRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const SupplierModel = require("./models/supplierModel");
const profileRoutes = require("./routes/profileRoutes");
const settingsRoutes = require("./routes/settingsRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

// Configure server to handle larger headers
const server = require("http").createServer(app);
server.maxHeadersCount = 0; // Remove header count limit
server.headersTimeout = 60000; // 60 seconds
server.requestTimeout = 60000; // 60 seconds

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/supplier", supplierRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/manager", managerRoutes);
app.use("/api", messageRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/users", profileRoutes);
app.use("/api/settings", settingsRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Start server
async function startServer() {
  try {
    console.log("Initializing database...");
    await initializeDatabase();
    console.log("Database initialized successfully");

    // Run supplier deactivation job once at startup and then daily
    try {
      const deactivated = await SupplierModel.deactivateOldSuppliers();
      console.log(
        `Initial supplier deactivation completed. ${deactivated} deactivated.`
      );
    } catch (err) {
      console.error("Initial supplier deactivation job failed:", err);
    }

    // Schedule a daily job (24 hours) to deactivate old suppliers
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    setInterval(async () => {
      try {
        await SupplierModel.deactivateOldSuppliers();
      } catch (err) {
        console.error("Scheduled supplier deactivation job failed:", err);
      }
    }, ONE_DAY_MS);

    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log("Available routes:");
      console.log("  POST /api/auth/register - User registration");
      console.log("  POST /api/auth/login - User login");
      console.log("  GET  /api/auth/verify-employee - Verify employee ID");
      console.log("  GET  /api/auth/profile - Get user profile");
      console.log("  GET  /api/users/profile - Get user profile");
      console.log("  POST /api/users/send-otp - Send password reset OTP");
      console.log("  POST /api/users/reset-password - Reset password with OTP");
      console.log("  GET  /api/admin/users - Get all users (admin)");
      console.log("  POST /api/admin/users - Create user (admin)");
      console.log("  PUT  /api/admin/users/:id - Update user (admin)");
      console.log("  DELETE /api/admin/users/:id - Delete user (admin)");
      console.log(
        "  PUT  /api/admin/users/:id/status - Update user status (admin)"
      );
      console.log("  GET  /api/admin/logs - Get system logs (admin)");
      console.log("  GET  /api/supplier/orders - Get supplier orders");
      console.log("  POST /api/supplier/orders - Create supplier order");
      console.log("  PUT  /api/supplier/orders/:id - Update supplier order");
      console.log("  DELETE /api/supplier/orders/:id - Delete supplier order");
      console.log("  GET  /api/staff/tasks - Get staff tasks");
      console.log("  GET  /api/staff/orders - Get all supplier orders (staff)");
      console.log(
        "  PUT  /api/staff/orders/:id/status - Update order status (staff)"
      );
      console.log("  GET  /api/staff/orders/:id - Get order details (staff)");
      console.log("  GET  /api/manager/production - Get production data");
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
