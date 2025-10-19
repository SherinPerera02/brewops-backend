const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { db } = require("../database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();
const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-this-in-production";

const nodemailer = require("nodemailer");

function createTransporterLocal() {
  const host = process.env.MAIL_HOST || "smtp.gmail.com";
  const port = Number(process.env.MAIL_PORT || 465);
  const secure = port === 465;
  const baseOpts = {
    host,
    port,
    secure,
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
    connectionTimeout: Number(process.env.MAIL_CONNECTION_TIMEOUT || 10000),
    greetingTimeout: Number(process.env.MAIL_GREETING_TIMEOUT || 10000),
    socketTimeout: Number(process.env.MAIL_SOCKET_TIMEOUT || 10000),
  };
  if (process.env.MAIL_SERVICE)
    return nodemailer.createTransport({
      service: process.env.MAIL_SERVICE,
      ...baseOpts,
    });
  return nodemailer.createTransport(baseOpts);
}

// Verify employee ID endpoint (optional pre-check)
router.get("/verify-employee", async (req, res) => {
  try {
    const { employeeId, role } = req.query;
    if (!employeeId || !role) {
      return res
        .status(400)
        .json({ success: false, message: "employeeId and role are required" });
    }
    const idPattern = /^(STF|MNG)\d{6}$/;
    if (!idPattern.test(employeeId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Employee ID format" });
    }
    if (role === "staff" && !employeeId.startsWith("STF")) {
      return res.status(400).json({
        success: false,
        message: "Employee ID must start with STF for staff role",
      });
    }
    if (role === "manager" && !employeeId.startsWith("MNG")) {
      return res.status(400).json({
        success: false,
        message: "Employee ID must start with MNG for manager role",
      });
    }

    const employeeRecord = await db.getEmployeeByEmployeeId(employeeId);
    if (!employeeRecord) {
      return res
        .status(404)
        .json({ success: false, message: "Employee ID not found or inactive" });
    }
    if (
      (role === "staff" && employeeRecord.employee_type !== "staff") ||
      (role === "manager" && employeeRecord.employee_type !== "manager")
    ) {
      return res.status(400).json({
        success: false,
        message: "Employee ID does not match selected role",
      });
    }
    const alreadyUsed = await db.isEmployeeIdAlreadyUsed(employeeId);
    if (alreadyUsed) {
      return res
        .status(409)
        .json({ success: false, message: "Employee ID already registered" });
    }
    return res.json({
      success: true,
      message: "Employee ID is valid and available",
    });
  } catch (err) {
    console.error("Verify employee error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// User registration
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, phone, employeeId } = req.body;

    // Validation
    if (!name || !email || !password || !role || !employeeId) {
      return res.status(400).json({
        message: "Name, email, password, role, and employeeId are required",
      });
    }
    // Validate employeeId format and role prefix
    const idPattern = /^(STF|MNG)\d{6}$/;
    if (!idPattern.test(employeeId)) {
      return res.status(400).json({
        message: "Invalid Employee ID format (expected STFxxxxxx or MNGxxxxxx)",
      });
    }
    if (role === "staff" && !employeeId.startsWith("STF")) {
      return res
        .status(400)
        .json({ message: "Employee ID must start with STF for staff role" });
    }
    if (role === "manager" && !employeeId.startsWith("MNG")) {
      return res
        .status(400)
        .json({ message: "Employee ID must start with MNG for manager role" });
    }

    // Verify employeeId exists in employees reference table and matches role
    const employeeRecord = await db.getEmployeeByEmployeeId(employeeId);
    if (!employeeRecord) {
      return res.status(400).json({
        message: "Employee ID not found or inactive in factory database",
      });
    }
    if (
      (role === "staff" && employeeRecord.employee_type !== "staff") ||
      (role === "manager" && employeeRecord.employee_type !== "manager")
    ) {
      return res
        .status(400)
        .json({ message: "Employee ID does not match selected role" });
    }

    // Ensure employeeId is not already used by another registered user
    const alreadyUsed = await db.isEmployeeIdAlreadyUsed(employeeId);
    if (alreadyUsed) {
      return res
        .status(400)
        .json({ message: "This Employee ID is already registered" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters long" });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res
        .status(400)
        .json({ message: "Please enter a valid email address" });
    }

    // Check if user already exists
    const existingUser = await db.getUserByEmail(email);
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "User with this email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userData = {
      name,
      email,
      password: hashedPassword,
      role,
      phone: phone || null,
      supplier_id: null,
      staff_id: role === "staff" ? employeeId : null,
      manager_id: role === "manager" ? employeeId : null,
      status: "active", // Set user as active immediately
    };

    await db.createUser(userData);

    // Log the registration
    await db.createSystemLog({
      user_id: null,
      action: "User Registration",
      description: `New user registered: ${email} with role ${role}`,
      ip_address: req.ip,
      user_agent: req.get("User-Agent"),
    });

    // Send a welcome email to the newly registered user if they are staff or manager
    (async () => {
      try {
        if (!["staff", "manager"].includes(role)) return;

        const recipient = email;
        if (!recipient) return;

        const subject = `Welcome to BrewOps, ${name}`;
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5001";
        const html = `<p>Hi ${name},</p>
          <p>Welcome to BrewOps. Your account has been created with the role <strong>${role}</strong>. You can log in using your email address.</p>
          <p><a href="${frontendUrl}/login">Go to BrewOps login</a></p>
          <p>If this wasn't you, please contact your administrator.</p>`;
        const text = `Welcome ${name} to BrewOps. Role: ${role}. Login at ${frontendUrl}/login`;

        // 1) Try primary transporter
        let mailSent = false;
        try {
          const transporter = createTransporterLocal();
          const info = await transporter.sendMail({
            from: process.env.MAIL_FROM || process.env.MAIL_USER,
            to: recipient,
            subject,
            text,
            html,
          });
          mailSent = true;
          const preview = nodemailer.getTestMessageUrl(info);
          if (preview) console.log(`Ethereal preview URL: ${preview}`);
        } catch (e) {
          console.warn(
            "Primary mail send failed:",
            e && e.message ? e.message : e
          );
        }

        // 1b) Try alt SMTP on port 587 if not sent
        if (!mailSent) {
          try {
            const altTransport = nodemailer.createTransport({
              host: process.env.MAIL_HOST || "smtp.gmail.com",
              port: 587,
              secure: false,
              auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASS,
              },
              tls: {
                rejectUnauthorized: process.env.NODE_ENV === "production",
              },
            });
            const info2 = await altTransport.sendMail({
              from: process.env.MAIL_FROM || process.env.MAIL_USER,
              to: recipient,
              subject,
              text,
              html,
            });
            mailSent = true;
            const preview2 = nodemailer.getTestMessageUrl(info2);
            if (preview2) console.log(`Ethereal preview URL: ${preview2}`);
          } catch (e2) {
            console.warn(
              "Alt SMTP send failed:",
              e2 && e2.message ? e2.message : e2
            );
          }
        }

        // 2) SendGrid API fallback
        if (!mailSent && process.env.SENDGRID_API_KEY) {
          try {
            console.log("Attempting SendGrid fallback");
            const sgMail = require("@sendgrid/mail");
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const msg = {
              to: recipient,
              from: process.env.MAIL_FROM || process.env.MAIL_USER,
              subject,
              text,
              html,
            };
            const sgRes = await sgMail.send(msg);
            mailSent = true;
            console.log(
              "SendGrid send result:",
              Array.isArray(sgRes) ? sgRes[0].statusCode : sgRes.statusCode
            );
          } catch (sgErr) {
            console.warn(
              "SendGrid fallback failed:",
              sgErr && sgErr.message ? sgErr.message : sgErr
            );
          }
        }

        // 3) Ethereal dev fallback
        if (!mailSent && process.env.NODE_ENV !== "production") {
          try {
            console.log(
              "Falling back to Ethereal test account for welcome email (dev only)"
            );
            const testAccount = await nodemailer.createTestAccount();
            const ethTransport = nodemailer.createTransport({
              host: "smtp.ethereal.email",
              port: 587,
              secure: false,
              auth: { user: testAccount.user, pass: testAccount.pass },
            });
            const info3 = await ethTransport.sendMail({
              from: process.env.MAIL_FROM || process.env.MAIL_USER,
              to: recipient,
              subject: `${subject} (Ethereal test)`,
              text,
              html,
            });
            const preview3 = nodemailer.getTestMessageUrl(info3);
            console.log("Ethereal message preview URL:", preview3);
            mailSent = true;
          } catch (ethErr) {
            console.warn(
              "Ethereal fallback failed:",
              ethErr && ethErr.message ? ethErr.message : ethErr
            );
          }
        }
      } catch (notifyErr) {
        console.error(
          "Registration welcome email error:",
          notifyErr && notifyErr.message ? notifyErr.message : notifyErr
        );
      }
    })();

    res.status(201).json({
      message: "User registered successfully. You can now login.",
      user: {
        name,
        email,
        role,
        status: "active",
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res
      .status(500)
      .json({ message: "Internal server error during registration" });
  }
});

// User login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    // Find user
    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Check if user is active
    if (user.status !== "active") {
      return res.status(401).json({
        message:
          user.status === "pending"
            ? "Your account is pending approval. Please contact an administrator."
            : "Your account has been deactivated. Please contact an administrator.",
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
      },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    // Log the login
    await db.createSystemLog({
      user_id: user.id,
      action: "User Login",
      description: `User logged in: ${email}`,
      ip_address: req.ip,
      user_agent: req.get("User-Agent"),
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    // Include must_change_password flag for client to enforce change
    userWithoutPassword.must_change_password = user.must_change_password
      ? 1
      : 0;

    res.json({
      message: "Login successful",
      token,
      user: userWithoutPassword,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Internal server error during login" });
  }
});

// Get current user profile
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    // Get user ID from JWT token
    const userId = req.user.id;
    const user = await db.getUserById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Return user data without password
    const { password: _, ...userWithoutPassword } = user;
    res.json({
      success: true,
      data: {
        id: userWithoutPassword.id,
        name: userWithoutPassword.name,
        email: userWithoutPassword.email,
        role: userWithoutPassword.role,
        phone: userWithoutPassword.phone,
        status: userWithoutPassword.status,
      },
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Update user profile
router.put("/profile", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, phone, currentPassword, newPassword } = req.body;

    // Validation
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and email are required",
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    // Get current user data
    const currentUser = await db.getUserById(userId);
    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if email is already taken by another user
    if (email !== currentUser.email) {
      const existingUser = await db.getUserByEmail(email);
      if (existingUser && existingUser.id !== userId) {
        return res.status(400).json({
          success: false,
          message: "Email is already taken by another user",
        });
      }
    }

    let hashedNewPassword = null;

    // Handle password change if provided
    if (currentPassword && newPassword) {
      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(
        currentPassword,
        currentUser.password
      );
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      // Validate new password
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: "New password must be at least 6 characters long",
        });
      }

      // Hash new password
      hashedNewPassword = await bcrypt.hash(newPassword, 10);
    }

    // Prepare update data
    const updateData = {
      name,
      email,
      phone: phone || currentUser.phone,
      role: currentUser.role, // Keep existing role
      status: currentUser.status, // Keep existing status
    };

    // Add password to update data if changing
    if (hashedNewPassword) {
      updateData.password = hashedNewPassword;
      // Clear must_change_password flag when the user changes their password
      updateData.must_change_password = 0;
    }

    // Update user in database
    await db.updateUser(userId, updateData);

    // Get updated user data
    const updatedUser = await db.getUserById(userId);
    const { password: _, ...userWithoutPassword } = updatedUser;

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: userWithoutPassword.id,
        name: userWithoutPassword.name,
        email: userWithoutPassword.email,
        role: userWithoutPassword.role,
        phone: userWithoutPassword.phone,
        status: userWithoutPassword.status,
      },
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
