const express = require("express");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { db } = require("../database");

const router = express.Router();

// Build a transporter from environment variables
function buildTransporter() {
  const service = process.env.MAIL_SERVICE;
  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT || 587);
  const secureEnv = String(process.env.MAIL_SECURE || "").toLowerCase();
  const secure = secureEnv === "true" || port === 465;
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;

  if (!user || !pass) {
    console.warn(
      "Email not fully configured: set MAIL_USER and MAIL_PASS in .env to send emails"
    );
    return null;
  }

  // Prefer host/port if provided; otherwise use service
  let transportOptions = { auth: { user, pass } };
  if (host) {
    transportOptions = { ...transportOptions, host, port, secure };
  } else if (service) {
    transportOptions = { ...transportOptions, service };
    // nodemailer will default to TLS start on port 587 for service
  } else {
    // Default to gmail host if nothing specified
    transportOptions = {
      ...transportOptions,
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
    };
  }

  return nodemailer.createTransport(transportOptions);
}

const mailTransporter = buildTransporter();

// POST /api/users/send-otp - send a one-time code to user's email
router.post("/send-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await db.getUserByEmail(email);
    if (!user) {
      // To prevent user enumeration, return 200 with generic message
      return res.json({ message: "If the email exists, an OTP has been sent" });
    }

    // Generate a 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.createPasswordReset(user.id, otp, expiresAt);

    // Send email if transporter is configured; otherwise log for development
    if (mailTransporter) {
      try {
        await mailTransporter.sendMail({
          from: process.env.MAIL_FROM || process.env.MAIL_USER,
          to: email,
          subject: "Password Reset OTP",
          text: `Your OTP is ${otp}. It expires in 10 minutes.`,
          html: `<p>Your OTP is <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
        });
      } catch (sendErr) {
        console.error("Failed to send OTP email:", sendErr.message);
        // Fall through to generic response to avoid leaking details
      }
    } else {
      console.log(
        `OTP for ${email}: ${otp} (expires at ${expiresAt.toISOString()})`
      );
    }

    res.json({ message: "If the email exists, an OTP has been sent" });
  } catch (error) {
    console.error("Send OTP error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST /api/users/reset-password - reset password using email + otp
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res
        .status(400)
        .json({ message: "Email, OTP, and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters long" });
    }

    const user = await db.getUserByEmail(email);
    if (!user) {
      return res.status(400).json({ message: "Invalid email or OTP" });
    }

    const record = await db.getValidPasswordReset(user.id, otp);
    if (!record) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.updateUser(user.id, { ...user, password: hashed });
    await db.markPasswordResetUsed(record.id);

    res.json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get current user profile
router.get("/profile", async (req, res) => {
  try {
    const user = await db.getUserById(1); // Default user ID since authentication is removed
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
