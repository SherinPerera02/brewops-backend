const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');

const router = express.Router();

// Get all users (admin only)
router.get('/users', async (req, res) => {
  try {
    const users = await db.query('SELECT id, name, email, role, phone, status, created_at FROM users ORDER BY created_at DESC');
    res.json({ users });

  } catch (error) {
    console.error('Admin users fetch error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Create new user (admin only)
router.post('/users', async (req, res) => {
  try {
    const { name, email, password, role, status } = req.body;

    // Validation
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    // Check if user already exists
    const existingUser = await db.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userData = {
      name,
      email,
      password: hashedPassword,
      role,
      phone: null,
      supplier_id: null,
      staff_id: null,
      manager_id: null,
      status: status || 'active'
    };

    await db.createUser(userData);

    // Log the action
    await db.createSystemLog({
      user_id: 1, // Default admin ID since authentication is removed
      action: 'User Creation',
      description: `Admin created new user: ${email} with role ${role}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.status(201).json({ message: 'User created successfully' });

  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update user (admin only)
router.put('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, status } = req.body;

    // Validation
    if (!name || !email || !role) {
      return res.status(400).json({ message: 'Name, email, and role are required' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    // Check if user exists
    const existingUser = await db.getUserById(id);
    if (!existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if email is taken by another user
    const emailUser = await db.getUserByEmail(email);
    if (emailUser && emailUser.id !== parseInt(id)) {
      return res.status(400).json({ message: 'Email is already taken by another user' });
    }

    // Prepare update data
    let updateData = { name, email, role, status: status || 'active' };
    
    // Hash new password if provided
    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters long' });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }

    // Update user
    await db.updateUser(id, updateData);

    // Log the action
    await db.createSystemLog({
      user_id: 1, // Default admin ID since authentication is removed
      action: 'User Update',
      description: `Admin updated user: ${email}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.json({ message: 'User updated successfully' });

  } catch (error) {
    console.error('User update error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Delete user (admin only)
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUser = await db.getUserById(id);
    if (!existingUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Skip self-deletion check since authentication is removed
    // if (parseInt(id) === req.user.id) {
    //   return res.status(400).json({ message: 'You cannot delete your own account' });
    // }

    // Delete user
    await db.deleteUser(id);

    // Log the action
    await db.createSystemLog({
      user_id: 1, // Default admin ID since authentication is removed
      action: 'User Deletion',
      description: `Admin deleted user: ${existingUser.email}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('User deletion error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Update user status (admin only)
router.put('/users/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive', 'pending'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    await db.updateUserStatus(id, status);

    // Log the action
    await db.createSystemLog({
      user_id: 1, // Default admin ID since authentication is removed
      action: 'User Status Update',
      description: `Admin updated user ${id} status to ${status}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent')
    });

    res.json({ message: 'User status updated successfully' });

  } catch (error) {
    console.error('User status update error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get system logs (admin only)
router.get('/logs', async (req, res) => {
  try {
    const logs = await db.query(`
      SELECT sl.*, u.name as user_name, u.email as user_email 
      FROM system_logs sl 
      LEFT JOIN users u ON sl.user_id = u.id 
      ORDER BY sl.created_at DESC 
      LIMIT 100
    `);
    res.json({ logs });

  } catch (error) {
    console.error('Admin logs fetch error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;