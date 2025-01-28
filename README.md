# MCP Server for MySQL based on NodeJS
[![smithery badge](https://smithery.ai/badge/@benborla29/mcp-server-mysql)](https://smithery.ai/server/@benborla29/mcp-server-mysql)
![Demo](assets/demo.gif)

A Model Context Protocol server that provides read-only access to MySQL databases. This server enables LLMs to inspect database schemas and execute read-only queries.

## Components

### Tools

- **mysql_query**
  - Execute read-only SQL queries against the connected database
  - Input: `sql` (string): The SQL query to execute
  - All queries are executed within a READ ONLY transaction

### Resources

The server provides schema information for each table in the database:

- **Table Schemas**
  - JSON schema information for each table
  - Includes column names and data types
  - Automatically discovered from database metadata

## Usage with Claude Desktop

To use this server with the Claude Desktop app, add the following configuration to the "mcpServers" section of your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mcp_server_myqsl": {
      "command": "npx",
      "args": [
        "-y",
        "@benborla29/mcp-server-mysql",
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

Replace `/db_name` with your database name or leave it blank to retrieve all databases.

## Troubleshooting
If you encounter an error "Could not connect to MCP server mcp-server-mysql", you may need to explicitly
set the path of all required binaries such as the configuration below:

```json
{
  "mcpServers": {
    "mcp_server_myqsl": {
      "command": "/path/to/npx/binary/npx",
      "args": [
        "-y",
        "@benborla29/mcp-server-mysql",
      ],
      "env": {
        "MYSQL_HOST": "127.0.0.1",
        "MYSQL_PORT": "3306",
        "MYSQL_USER": "root",
        "MYSQL_PASS": "",
        "MYSQL_DB": "db_name"
        "PATH": "/path/to/node/bin:/usr/bin:/bin" <-- Add this
      }

    }
  }
}
```

## License

This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
