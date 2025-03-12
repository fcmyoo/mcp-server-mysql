# MCP Server for MySQL based on NodeJS
[![smithery badge](https://smithery.ai/badge/@benborla29/mcp-server-mysql)](https://smithery.ai/server/@benborla29/mcp-server-mysql)
![Demo](assets/demo.gif)

A Model Context Protocol server that provides read-only access to MySQL databases. This server enables LLMs to inspect database schemas and execute read-only queries.

## Installation

### Using Smithery
The easiest way to install and configure this MCP server is through [Smithery](https://smithery.ai/server/@benborla29/mcp-server-mysql):

```bash
# Install the MCP server
npx -y @smithery/cli@latest install @benborla29/mcp-server-mysql --client claude
smithery configure @benborla29/mcp-server-mysql
```

During configuration, you'll be prompted to enter your MySQL connection details. Smithery will automatically:
- Set up the correct environment variables
- Configure your LLM application to use the MCP server
- Test the connection to your MySQL database
- Provide helpful troubleshooting if needed

### Using MCP Get
You can also install this package using [MCP Get](https://mcp-get.com/packages/%40benborla29%2Fmcp-server-mysql):

```bash
npx @michaellatman/mcp-get@latest install @benborla29/mcp-server-mysql
```

MCP Get provides a centralized registry of MCP servers and simplifies the installation process.

### Using NPM/PNPM
For manual installation:

```bash
# Using npm
npm install -g @benborla29/mcp-server-mysql

# Using pnpm
pnpm add -g @benborla29/mcp-server-mysql
```

After manual installation, you'll need to configure your LLM application to use the MCP server (see Configuration section below).

## Components

### Tools

- **mysql_query**
  - Execute read-only SQL queries against the connected database
  - Input: `sql` (string): The SQL query to execute
  - All queries are executed within a READ ONLY transaction
  - Supports prepared statements for secure parameter handling
  - Configurable query timeouts and result pagination
  - Built-in query execution statistics

### Resources

The server provides comprehensive database information:

- **Table Schemas**
  - JSON schema information for each table
  - Column names and data types
  - Index information and constraints
  - Foreign key relationships
  - Table statistics and metrics
  - Automatically discovered from database metadata

### Security Features

- SQL injection prevention through prepared statements
- Query whitelisting/blacklisting capabilities
- Rate limiting for query execution
- Query complexity analysis
- Configurable connection encryption
- Read-only transaction enforcement

### Performance Optimizations

- Optimized connection pooling
- Query result caching
- Large result set streaming
- Query execution plan analysis
- Configurable query timeouts

### Monitoring and Debugging

- Comprehensive query logging
- Performance metrics collection
- Error tracking and reporting
- Health check endpoints
- Query execution statistics

## Configuration

### Automatic Configuration with Smithery
If you installed using Smithery, your configuration is already set up. You can view or modify it with:

```bash
smithery configure @benborla29/mcp-server-mysql
```

### Manual Configuration for Claude Desktop App
To manually configure the MCP server for Claude Desktop App, add the following to your `claude_desktop_config.json` file (typically located in your user directory):

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "npx",
      "args": [
        "-y",
        "@benborla29/mcp-server-mysql"
      ],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "",
        "MYSQL_DB": "db_name"
      }
    }
  }
}
```

Replace `db_name` with your database name or leave it blank to access all databases.

### Advanced Configuration Options
For more control over the MCP server's behavior, you can use these advanced configuration options:

```json
{
  "mcpServers": {
    "mcp_server_mysql": {
      "command": "/path/to/npx/binary/npx",
      "args": [
        "-y",
        "@benborla29/mcp-server-mysql"
      ],
      "env": {
        // Basic connection settings
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "",
        "MYSQL_DB": "db_name",
        "PATH": "/path/to/node/bin:/usr/bin:/bin",
        
        // Performance settings
        "MYSQL_POOL_SIZE": "10",
        "MYSQL_QUERY_TIMEOUT": "30000",
        "MYSQL_CACHE_TTL": "60000",
        
        // Security settings
        "MYSQL_RATE_LIMIT": "100",
        "MYSQL_MAX_QUERY_COMPLEXITY": "1000",
        "MYSQL_SSL": "true",
        
        // Monitoring settings
        "MYSQL_ENABLE_LOGGING": "true",
        "MYSQL_LOG_LEVEL": "info",
        "MYSQL_METRICS_ENABLED": "true"
      }
    }
  }
}
```

## Environment Variables

### Basic Connection
- `MYSQL_HOST`: MySQL server host (default: "127.0.0.1")
- `MYSQL_PORT`: MySQL server port (default: "3306")
- `MYSQL_USER`: MySQL username (default: "root")
- `MYSQL_PASS`: MySQL password
- `MYSQL_DB`: Target database name

### Performance Configuration
- `MYSQL_POOL_SIZE`: Connection pool size (default: "10")
- `MYSQL_QUERY_TIMEOUT`: Query timeout in milliseconds (default: "30000")
- `MYSQL_CACHE_TTL`: Cache time-to-live in milliseconds (default: "60000")

### Security Configuration
- `MYSQL_RATE_LIMIT`: Maximum queries per minute (default: "100")
- `MYSQL_MAX_QUERY_COMPLEXITY`: Maximum query complexity score (default: "1000")
- `MYSQL_SSL`: Enable SSL/TLS encryption (default: "false")

### Monitoring Configuration
- `MYSQL_ENABLE_LOGGING`: Enable query logging (default: "false")
- `MYSQL_LOG_LEVEL`: Logging level (default: "info")
- `MYSQL_METRICS_ENABLED`: Enable performance metrics (default: "false")

## Testing

### Database Setup

Before running tests, you need to set up the test database and seed it with test data:

1. **Create Test Database and User**
   ```sql
   -- Connect as root and create test database
   CREATE DATABASE IF NOT EXISTS mcp_test;
   
   -- Create test user with appropriate permissions
   CREATE USER IF NOT EXISTS 'mcp_test'@'localhost' IDENTIFIED BY 'mcp_test_password';
   GRANT ALL PRIVILEGES ON mcp_test.* TO 'mcp_test'@'localhost';
   FLUSH PRIVILEGES;
   ```

2. **Run Database Setup Script**
   ```bash
   # Run the database setup script
   pnpm run setup:test:db
   ```

   This will create the necessary tables and seed data. The script is located in `scripts/setup-test-db.ts`:
   ```typescript
   // scripts/setup-test-db.ts
   import mysql from 'mysql2/promise';
   import dotenv from 'dotenv';

   // Load test environment variables
   dotenv.config({ path: '.env.test' });

   async function setupTestDatabase() {
     const connection = await mysql.createConnection({
       host: process.env.MYSQL_HOST || 'localhost',
       port: Number(process.env.MYSQL_PORT) || 3306,
       user: process.env.MYSQL_USER || 'mcp_test',
       password: process.env.MYSQL_PASS || 'mcp_test_password',
       database: process.env.MYSQL_DB || 'mcp_test',
       multipleStatements: true
     });

     try {
       // Create test tables
       await connection.query(`
         CREATE TABLE IF NOT EXISTS users (
           id INT PRIMARY KEY AUTO_INCREMENT,
           name VARCHAR(255) NOT NULL,
           email VARCHAR(255) UNIQUE NOT NULL,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
         );

         CREATE TABLE IF NOT EXISTS posts (
           id INT PRIMARY KEY AUTO_INCREMENT,
           user_id INT NOT NULL,
           title VARCHAR(255) NOT NULL,
           content TEXT,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           FOREIGN KEY (user_id) REFERENCES users(id)
         );
       `);

       // Seed test data
       await connection.query(`
         -- Clear existing data
         DELETE FROM posts;
         DELETE FROM users;
         ALTER TABLE posts AUTO_INCREMENT = 1;
         ALTER TABLE users AUTO_INCREMENT = 1;

         -- Insert test users
         INSERT INTO users (name, email) VALUES
         ('Test User 1', 'user1@test.com'),
         ('Test User 2', 'user2@test.com');

         -- Insert test posts
         INSERT INTO posts (user_id, title, content) VALUES
         (1, 'First Post', 'Content of first post'),
         (1, 'Second Post', 'Content of second post'),
         (2, 'Another Post', 'Content from another user');
       `);

       console.log('Test database setup completed successfully');
     } catch (error) {
       console.error('Error setting up test database:', error);
       throw error;
     } finally {
       await connection.end();
     }
   }

   setupTestDatabase().catch(console.error);
   ```

3. **Configure Test Environment**
   Create a `.env.test` file in the project root:
   ```env
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_USER=mcp_test
   MYSQL_PASS=mcp_test_password
   MYSQL_DB=mcp_test
   ```

4. **Update package.json Scripts**
   Add these scripts to your package.json:
   ```json
   {
     "scripts": {
       "setup:test:db": "ts-node scripts/setup-test-db.ts",
       "pretest": "pnpm run setup:test:db",
       "test": "vitest run",
       "test:watch": "vitest",
       "test:coverage": "vitest run --coverage"
     }
   }
   ```

### Running Tests

The project includes a comprehensive test suite to ensure functionality and reliability:

```bash
# First-time setup
pnpm run setup:test:db

# Run all tests
pnpm test

# Run specific test categories
pnpm test:unit      # Unit tests only
pnpm test:integration  # Integration tests only
pnpm test:e2e       # End-to-end tests only

# Run tests with coverage report
pnpm test:coverage

# Run tests in watch mode during development
pnpm test:watch
```

### Test Environment Setup

For integration and E2E tests, you'll need a MySQL test database:

1. Create a test database:
   ```sql
   CREATE DATABASE mcp_test;
   ```

2. Create a test configuration file `.env.test`:
   ```
   MYSQL_HOST=127.0.0.1
   MYSQL_PORT=3306
   MYSQL_USER=root
   MYSQL_PASS=your_password
   MYSQL_DB=mcp_test
   ```

3. The test suite will automatically use this configuration when running tests.

### Writing Tests

When contributing new features, please include appropriate tests:

1. **Unit Tests**: Located in `tests/unit/`
   - Test individual functions and components
   - Use mocks for external dependencies
   - Example:
     ```typescript
     // tests/unit/query.test.ts
     import { describe, it, expect, vi } from 'vitest';
     import { executeQuery } from '../../src/query';
     
     describe('executeQuery', () => {
       it('should execute a valid query', async () => {
         const mockResults = [{ id: 1, name: 'test' }];
         const mockConnection = {
           query: vi.fn().mockResolvedValue([mockResults]),
           release: vi.fn()
         };
         const mockPool = {
           getConnection: vi.fn().mockResolvedValue(mockConnection)
         };

         const result = await executeQuery('SELECT * FROM test');
         expect(result).toEqual(mockResults);
       });

       it('should handle query errors', async () => {
         const mockError = new Error('Query failed');
         const mockConnection = {
           query: vi.fn().mockRejectedValue(mockError),
           release: vi.fn()
         };
         const mockPool = {
           getConnection: vi.fn().mockResolvedValue(mockConnection)
         };

         await expect(executeQuery('INVALID SQL'))
           .rejects.toThrow('Query failed');
       });
     });
     ```

2. **Integration Tests**: Located in `tests/integration/`
   - Test interactions between components
   - Use real database connections
   - Example:
     ```typescript
     // tests/integration/mysql.test.ts
     import { describe, it, expect, beforeAll, afterAll } from 'vitest';
     import { pool } from '../../src/db';
     
     describe('MySQL Connection', () => {
       beforeAll(async () => {
         // Setup test database
         await pool.query(`
           CREATE TABLE IF NOT EXISTS test_table (
             id INT PRIMARY KEY AUTO_INCREMENT,
             name VARCHAR(255) NOT NULL
           )
         `);
       });
       
       it('should perform CRUD operations', async () => {
         // Insert test data
         const insertResult = await pool.query(
           'INSERT INTO test_table (name) VALUES (?)',
           ['test_name']
         );
         expect(insertResult.affectedRows).toBe(1);

         // Read test data
         const [rows] = await pool.query(
           'SELECT * FROM test_table WHERE name = ?',
           ['test_name']
         );
         expect(rows[0].name).toBe('test_name');
       });
       
       afterAll(async () => {
         // Cleanup
         await pool.query('DROP TABLE IF EXISTS test_table');
         await pool.end();
       });
     });
     ```

3. **E2E Tests**: Located in `tests/e2e/`
   - Test the entire application flow
   - Simulate real user scenarios
   - Example:
     ```typescript
     // tests/e2e/server.test.ts
     import { describe, it, expect } from 'vitest';
     import { createServer, sendRequest } from '../utils';
     
     describe('MCP Server', () => {
       it('should handle mysql_query tool requests', async () => {
         const server = await createServer();
         const response = await sendRequest(server, {
           name: 'mysql_query',
           arguments: {
             sql: 'SELECT 1 + 1 as result'
           }
         });

         expect(response.content[0].text).toContain('"result": 2');
       });

       it('should handle schema inspection requests', async () => {
         const server = await createServer();
         const response = await sendRequest(server, {
           type: 'ListResources'
         });

         expect(response.resources).toBeInstanceOf(Array);
         expect(response.resources[0]).toHaveProperty('uri');
       });
     });
     ```

### Test Coverage Requirements

- Minimum coverage requirements:
  - Statements: 80%
  - Branches: 75%
  - Functions: 80%
  - Lines: 80%

- Run coverage report:
  ```bash
  pnpm test:coverage
  ```

### Continuous Integration

The project uses GitHub Actions for CI/CD:

- Tests run automatically on pull requests
- Code coverage reports are generated
- Linting and type checking are performed

The CI pipeline includes:

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      mysql:
        image: mysql:8.0
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: mcp_test
        ports:
          - 3306:3306
        options: --health-cmd="mysqladmin ping" --health-interval=10s --health-timeout=5s --health-retries=3

    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: pnpm install
        
      - name: Run tests
        run: pnpm test
        env:
          MYSQL_HOST: 127.0.0.1
          MYSQL_PORT: 3306
          MYSQL_USER: root
          MYSQL_PASS: root
          MYSQL_DB: mcp_test
          
      - name: Upload coverage
        uses: codecov/codecov-action@v2
```

### Testing Best Practices

1. **Test Organization**
   - Keep test files close to the code they test
   - Use descriptive test names
   - Group related tests using `describe` blocks

2. **Test Data**
   - Use fixtures for complex test data
   - Clean up test data after tests
   - Don't rely on test execution order

3. **Mocking**
   - Mock external dependencies
   - Use meaningful mock data
   - Reset mocks between tests

4. **Assertions**
   - Make assertions specific and meaningful
   - Test both success and failure cases
   - Include edge cases and boundary conditions

## Troubleshooting

### Using Smithery for Troubleshooting
If you installed with Smithery, you can use its built-in diagnostics:

```bash
# Check the status of your MCP server
smithery status @benborla29/mcp-server-mysql

# Run diagnostics
smithery diagnose @benborla29/mcp-server-mysql

# View logs
smithery logs @benborla29/mcp-server-mysql
```

### Using MCP Get for Troubleshooting
If you installed with MCP Get:

```bash
# Check the status
mcp-get status @benborla29/mcp-server-mysql

# View logs
mcp-get logs @benborla29/mcp-server-mysql
```

### Common Issues

1. **Connection Issues**
   - Verify MySQL server is running and accessible
   - Check credentials and permissions
   - Ensure SSL/TLS configuration is correct if enabled
   - Try connecting with a MySQL client to confirm access

2. **Performance Issues**
   - Adjust connection pool size
   - Configure query timeout values
   - Enable query caching if needed
   - Check query complexity settings
   - Monitor server resource usage

3. **Security Restrictions**
   - Review rate limiting configuration
   - Check query whitelist/blacklist settings
   - Verify SSL/TLS settings
   - Ensure the user has appropriate MySQL permissions

4. **Path Resolution**
If you encounter an error "Could not connect to MCP server mcp-server-mysql", explicitly set the path of all required binaries:
```json
{
  "env": {
    "PATH": "/path/to/node/bin:/usr/bin:/bin"
  }
}
```

5. **Authentication Issues**
   - For MySQL 8.0+, ensure the server supports the `caching_sha2_password` authentication plugin
   - Check if your MySQL user is configured with the correct authentication method
   - Try creating a user with legacy authentication if needed:
     ```sql
     CREATE USER 'user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request to 
https://github.com/benborla/mcp-server-mysql

### Development Setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Build the project: `pnpm run build`
4. Run tests: `pnpm test`

### Project Roadmap

We're actively working on enhancing this MCP server. Check our [CHANGELOG.md](./CHANGELOG.md) for details on planned features, including:

- Enhanced query capabilities with prepared statements
- Advanced security features
- Performance optimizations
- Comprehensive monitoring
- Expanded schema information

If you'd like to contribute to any of these areas, please check the issues on GitHub or open a new one to discuss your ideas.

### Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Submit a pull request

## License

This MCP server is licensed under the MIT License. See the LICENSE file for details.
