const { pool } = require('./database');

async function checkUsers() {
  try {
    console.log('Checking users in database...');
    
    // Check if users exist
    const [users] = await pool.execute('SELECT id, name, email, role FROM users LIMIT 10');
    
    if (users.length === 0) {
      console.log('No users found in database. Creating test users...');
      
      // Create test users
      const bcrypt = require('bcryptjs');
      const password1 = await bcrypt.hash('password123', 10);
      const password2 = await bcrypt.hash('password123', 10);
      
      await pool.execute(
        'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
        ['John Doe', 'john@example.com', password1, 'user', 'active']
      );
      
      await pool.execute(
        'INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)',
        ['Jane Smith', 'jane@example.com', password2, 'user', 'active']
      );
      
      console.log('Test users created:');
      console.log('1. John Doe (john@example.com) - password: password123');
      console.log('2. Jane Smith (jane@example.com) - password: password123');
      
      // Fetch the created users
      const [newUsers] = await pool.execute('SELECT id, name, email, role FROM users');
      console.log('Users in database:', newUsers);
    } else {
      console.log('Users found in database:', users);
    }
    
  } catch (error) {
    console.error('Error checking users:', error);
  } finally {
    process.exit(0);
  }
}

checkUsers();