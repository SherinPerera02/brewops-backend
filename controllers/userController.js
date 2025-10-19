const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const { db } = require("../database");

dotenv.config();

const transporter = nodemailer.createTransport({
  service: process.env.MAIL_SERVICE || "gmail",
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: Number(process.env.MAIL_PORT || 587),
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

async function sendOTP(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await db.getUserByEmail(email);
    if (!user) {
      // prevent user enumeration
      return res.json({ message: "If the email exists, an OTP has been sent" });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.createPasswordReset(user.id, otp, expiresAt);

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.MAIL_USER,
      to: email,
      subject: "Password Reset OTP",
      text: `Your OTP is ${otp}. It expires in 10 minutes.`,
    });

    res.json({ message: "If the email exists, an OTP has been sent" });
  } catch (err) {
    console.error("sendOTP error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

async function resetPassword(req, res) {
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
    await db.updateUser(user.id, {
      name: user.name,
      email: user.email,
      password: hashed,
      role: user.role,
      status: user.status,
      phone: user.phone,
    });
    await db.markPasswordResetUsed(record.id);

    res.json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("resetPassword error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = { sendOTP, resetPassword };
