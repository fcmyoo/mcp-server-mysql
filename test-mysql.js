import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('MySQL Configuration:', {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: process.env.MYSQL_PORT || '3306',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASS || '',
  database: process.env.MYSQL_DB || '',
});

async function testConnection() {
  try {
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASS || '',
      database: process.env.MYSQL_DB || '',
      connectTimeout: 10000,
    });

    console.log('Pool created successfully, trying to get a connection...');
    const connection = await pool.getConnection();
    console.log('Connection successful!');
    
    // Test a simple query if connection works
    if (process.env.MYSQL_DB) {
      const [rows] = await connection.query('SHOW TABLES');
      console.log('Tables in database:', rows);
    } else {
      const [rows] = await connection.query('SHOW DATABASES');
      console.log('Available databases:', rows);
    }
    
    connection.release();
    await pool.end();
    console.log('Connection released and pool ended');
  } catch (error) {
    console.error('Error connecting to MySQL:', error);
  }
}

testConnection(); 