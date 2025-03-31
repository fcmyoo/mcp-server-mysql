#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import * as mysql2 from 'mysql2/promise'
import * as dotenv from 'dotenv'

export interface TableRow {
  table_name: string
}

export interface ColumnRow {
  column_name: string
  data_type: string
}

// @INFO: Load environment variables from .env file
dotenv.config()

// @INFO: Update the environment setup to ensure database is correctly set
if (process.env.NODE_ENV === 'test' && !process.env.MYSQL_DB) {
  process.env.MYSQL_DB = 'mcp_test_db' // @INFO: Ensure we have a database name for tests
}

// @INFO: Write operation flags
const ALLOW_INSERT_OPERATION = process.env.ALLOW_INSERT_OPERATION === 'true'
const ALLOW_UPDATE_OPERATION = process.env.ALLOW_UPDATE_OPERATION === 'true'
const ALLOW_DELETE_OPERATION = process.env.ALLOW_DELETE_OPERATION === 'true'

// @INFO: Check if running in test mode
const isTestEnvironment =
  process.env.NODE_ENV === 'test' || process.env.VITEST

// @INFO: Safe way to exit process (not during tests)
function safeExit(code: number): void {
  if (!isTestEnvironment) {
    process.exit(code)
  } else {
    console.error(`[Test mode] Would have called process.exit(${code})`)
  }
}

let toolDescription = 'Run SQL queries against MySQL database'

if (ALLOW_INSERT_OPERATION || ALLOW_UPDATE_OPERATION || ALLOW_DELETE_OPERATION) {
  // @INFO: At least one write operation is enabled
  toolDescription += ' with support for:'
  
  if (ALLOW_INSERT_OPERATION) {
    toolDescription += ' INSERT,'
  }
  
  if (ALLOW_UPDATE_OPERATION) {
    toolDescription += ' UPDATE,'
  }
  
  if (ALLOW_DELETE_OPERATION) {
    toolDescription += ' DELETE,'
  }
  
  // @INFO: Remove trailing comma and add READ operations
  toolDescription = toolDescription.replace(/,$/, '') + ' and READ operations'
} else {
  // @INFO: Only read operations are allowed
  toolDescription += ' (READ-ONLY)'
}

const config = {
  server: {
    name: '@benborla29/mcp-server-mysql',
    version: '0.1.18',
    connectionTypes: ['stdio'],
  },
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASS || 'root',
    database: process.env.MYSQL_DB || 'mcp_test_db', // @INFO: Default to test database if not specified
    connectionLimit: 10,
    authPlugins: {
      mysql_clear_password: () => () =>
        Buffer.from(process.env.MYSQL_PASS || 'root'),
    },
    ...(process.env.MYSQL_SSL === 'true'
      ? {
          ssl: {
            rejectUnauthorized:
              process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true',
          },
        }
      : {}),
  },
  paths: {
    schema: 'schema',
  },
}

// @INFO: Add debug logging for configuration
console.error(
  'MySQL Configuration:',
  JSON.stringify(
    {
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password ? '******' : 'not set',
      database: config.mysql.database,
      ssl: process.env.MYSQL_SSL === 'true' ? 'enabled' : 'disabled',
    },
    null,
    2,
  ),
)

// @INFO: Lazy load MySQL pool
let poolPromise: Promise<mysql2.Pool>
const getPool = (): Promise<mysql2.Pool> => {
  if (!poolPromise) {
    poolPromise = new Promise<mysql2.Pool>((resolve, reject) => {
      try {
        const pool = mysql2.createPool(config.mysql)
        console.error('MySQL pool created successfully')
        resolve(pool)
      } catch (error) {
        console.error('Error creating MySQL pool:', error)
        reject(error)
      }
    })
  }
  return poolPromise
}

// @INFO: Lazy load server instance
let serverInstance: Promise<Server> | null = null
const getServer = (): Promise<Server> => {
  if (!serverInstance) {
    serverInstance = new Promise<Server>((resolve) => {
      const server = new Server(config.server, {
        capabilities: {
          resources: {},
          tools: {
            mysql_query: {
              description: toolDescription,
              inputSchema: {
                type: 'object',
                properties: {
                  sql: {
                    type: 'string',
                    description: 'The SQL query to execute',
                  },
                },
                required: ['sql'],
              },
            },
          },
        },
      })

      // @INFO: Register request handlers
      server.setRequestHandler(
        ListResourcesRequestSchema,
        async () => {
          try {
            console.error('Handling ListResourcesRequest')
            const results = (await executeQuery(
              'SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()',
            )) as TableRow[]

            return {
              resources: results.map((row: TableRow) => ({
                uri: new URL(
                  `${row.table_name}/${config.paths.schema}`,
                  `${config.mysql.host}:${config.mysql.port}`,
                ).href,
                mimeType: 'application/json',
                name: `"${row.table_name}" database schema`,
              })),
            }
          } catch (error) {
            console.error('Error in ListResourcesRequest handler:', error)
            throw error
          }
        },
      )

      server.setRequestHandler(
        ReadResourceRequestSchema,
        async (request) => {
          try {
            console.error('Handling ReadResourceRequest')
            const resourceUrl = new URL(request.params.uri)
            const pathComponents = resourceUrl.pathname.split('/')
            const schema = pathComponents.pop()
            const tableName = pathComponents.pop()

            if (schema !== config.paths.schema) {
              throw new Error('Invalid resource URI')
            }

            const results = (await executeQuery(
              'SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?',
              [tableName as string],
            )) as ColumnRow[]

            return {
              contents: [
                {
                  uri: request.params.uri,
                  mimeType: 'application/json',
                  text: JSON.stringify(results, null, 2),
                },
              ],
            }
          } catch (error) {
            console.error('Error in ReadResourceRequest handler:', error)
            throw error
          }
        },
      )

      server.setRequestHandler(ListToolsRequestSchema, async () => {
        console.error('Handling ListToolsRequest')
        
        const toolsResponse = {
          tools: [
            {
              name: 'mysql_query',
              description: toolDescription,
              inputSchema: {
                type: 'object',
                properties: {
                  sql: {
                    type: 'string',
                    description: 'The SQL query to execute',
                  },
                },
                required: ['sql'],
              },
            },
          ],
        }
        
        console.error(
          'ListToolsRequest response:',
          JSON.stringify(toolsResponse, null, 2),
        )
        return toolsResponse
      })

      server.setRequestHandler(
        CallToolRequestSchema,
        async (request) => {
          try {
            console.error('Handling CallToolRequest:', request.params.name)
            if (request.params.name !== 'mysql_query') {
              throw new Error(`Unknown tool: ${request.params.name}`)
            }

            const sql = request.params.arguments?.sql as string
            return executeReadOnlyQuery(sql)
          } catch (error) {
            console.error('Error in CallToolRequest handler:', error)
            throw error
          }
        },
      )

      resolve(server)
    })
  }
  return serverInstance
}

async function executeQuery<T>(
  sql: string,
  params: string[] = [],
): Promise<T> {
  let connection
  try {
    const pool = await getPool()
    connection = await pool.getConnection()
    console.error('Connection acquired successfully')
    const result = await connection.query(sql, params)
    return (Array.isArray(result) ? result[0] : result) as T
  } catch (error) {
    console.error('Error executing query:', error)
    throw error
  } finally {
    if (connection) {
      connection.release()
      console.error('Connection released')
    }
  }
}

async function executeReadOnlyQuery<T>(sql: string): Promise<T> {
  let connection
  try {
    // @INFO: Check if the query is a write operation
    const normalizedSql = sql.trim().toUpperCase()
    
    if (normalizedSql.startsWith('INSERT') && !ALLOW_INSERT_OPERATION) {
      console.error(
        'INSERT operations are not allowed. Set ALLOW_INSERT_OPERATION=true to enable.',
      )
      return {
        content: [
          {
            type: 'text',
            text: 'Error: INSERT operations are not allowed. Ask the administrator to enable ALLOW_INSERT_OPERATION.',
          },
        ],
        isError: true,
      } as T
    }
    
    if (normalizedSql.startsWith('UPDATE') && !ALLOW_UPDATE_OPERATION) {
      console.error(
        'UPDATE operations are not allowed. Set ALLOW_UPDATE_OPERATION=true to enable.',
      )
      return {
        content: [
          {
            type: 'text',
            text: 'Error: UPDATE operations are not allowed. Ask the administrator to enable ALLOW_UPDATE_OPERATION.',
          },
        ],
        isError: true,
      } as T
    }
    
    if (normalizedSql.startsWith('DELETE') && !ALLOW_DELETE_OPERATION) {
      console.error(
        'DELETE operations are not allowed. Set ALLOW_DELETE_OPERATION=true to enable.',
      )
      return {
        content: [
          {
            type: 'text',
            text: 'Error: DELETE operations are not allowed. Ask the administrator to enable ALLOW_DELETE_OPERATION.',
          },
        ],
        isError: true,
      } as T
    }

    // @INFO: For write operations that are allowed, use executeWriteQuery
    if (
      (normalizedSql.startsWith('INSERT') && ALLOW_INSERT_OPERATION) ||
      (normalizedSql.startsWith('UPDATE') && ALLOW_UPDATE_OPERATION) ||
      (normalizedSql.startsWith('DELETE') && ALLOW_DELETE_OPERATION)
    ) {
      return executeWriteQuery(sql)
    }
    
    // @INFO: For read-only operations, continue with the original logic
    const pool = await getPool()
    connection = await pool.getConnection()
    console.error('Read-only connection acquired')

    // @INFO: Set read-only mode
    await connection.query('SET SESSION TRANSACTION READ ONLY')

    // @INFO: Begin transaction
    await connection.beginTransaction()

    try {
      // @INFO: Execute query
      const result = await connection.query(sql)
      const rows = Array.isArray(result) ? result[0] : result

      // @INFO: Rollback transaction (since it's read-only)
      await connection.rollback()

      // @INFO: Reset to read-write mode
      await connection.query('SET SESSION TRANSACTION READ WRITE')

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(rows, null, 2),
          },
        ],
        isError: false,
      } as T
    } catch (error) {
      // @INFO: Rollback transaction on query error
      console.error('Error executing read-only query:', error)
      await connection.rollback()
      throw error
    }
  } catch (error) {
    // @INFO: Ensure we rollback and reset transaction mode on any error
    console.error('Error in read-only query transaction:', error)
    try {
      if (connection) {
        await connection.rollback()
        await connection.query('SET SESSION TRANSACTION READ WRITE')
      }
    } catch (cleanupError) {
      // @INFO: Ignore errors during cleanup
      console.error('Error during cleanup:', cleanupError)
    }
    throw error
  } finally {
    if (connection) {
      connection.release()
      console.error('Read-only connection released')
    }
  }
}

// @INFO: New function to handle write operations
async function executeWriteQuery<T>(sql: string): Promise<T> {
  let connection
  try {
    const pool = await getPool()
    connection = await pool.getConnection()
    console.error('Write connection acquired')

    // @INFO: Begin transaction for write operation
    await connection.beginTransaction()

    try {
      // @INFO: Execute the write query
      const result = await connection.query(sql)
      const response = Array.isArray(result) ? result[0] : result
      
      // @INFO: Commit the transaction
      await connection.commit()
      
      // @INFO: Format the response based on operation type
      let responseText
      const normalizedSql = sql.trim().toUpperCase()
      
      // @INFO: Type assertion for ResultSetHeader which has affectedRows, insertId, etc.
      if (normalizedSql.startsWith('INSERT')) {
        const resultHeader = response as mysql2.ResultSetHeader
        responseText = `Insert successful. Affected rows: ${resultHeader.affectedRows}, Last insert ID: ${resultHeader.insertId}`
      } else if (normalizedSql.startsWith('UPDATE')) {
        const resultHeader = response as mysql2.ResultSetHeader
        responseText = `Update successful. Affected rows: ${resultHeader.affectedRows}, Changed rows: ${resultHeader.changedRows || 0}`
      } else if (normalizedSql.startsWith('DELETE')) {
        const resultHeader = response as mysql2.ResultSetHeader
        responseText = `Delete successful. Affected rows: ${resultHeader.affectedRows}`
      } else {
        responseText = JSON.stringify(response, null, 2)
      }

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
        isError: false,
      } as T
    } catch (error: unknown) {
      // @INFO: Rollback on error
      console.error('Error executing write query:', error)
      await connection.rollback()
      
      return {
        content: [
          {
            type: 'text',
            text: `Error executing write operation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      } as T
    }
  } catch (error: unknown) {
    console.error('Error in write operation transaction:', error)
    return {
      content: [
        {
          type: 'text',
          text: `Database connection error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    } as T
  } finally {
    if (connection) {
      connection.release()
      console.error('Write connection released')
    }
  }
}

// @INFO: Add exports for the query functions
export { executeQuery, executeReadOnlyQuery, executeWriteQuery, getServer }

// @INFO: Server startup and shutdown
async function runServer(): Promise<void> {
  try {
    console.error('Attempting to test database connection...')
    // @INFO: Test the connection before fully starting the server
    const pool = await getPool()
    const connection = await pool.getConnection()
    console.error('Database connection test successful')
    connection.release()
    
    const server = await getServer()
    const transport = new StdioServerTransport()
    console.error('Connecting server to transport...')
    await server.connect(transport)
    console.error('Server connected to transport successfully')
  } catch (error) {
    console.error('Fatal error during server startup:', error)
    safeExit(1)
  }
}

const shutdown = async (signal: string): Promise<void> => {
  console.error(`Received ${signal}. Shutting down...`)
  try {
    // @INFO: Only attempt to close the pool if it was created
    if (poolPromise) {
      const pool = await poolPromise
      await pool.end()
      console.error('MySQL pool closed successfully')
    }
  } catch (err) {
    console.error('Error closing pool:', err)
    throw err
  }
}

process.on('SIGINT', async () => {
  try {
    await shutdown('SIGINT')
    process.exit(0)
  } catch (err) {
    console.error('Error during SIGINT shutdown:', err)
    safeExit(1)
  }
})

process.on('SIGTERM', async () => {
  try {
    await shutdown('SIGTERM')
    process.exit(0)
  } catch (err) {
    console.error('Error during SIGTERM shutdown:', err)
    safeExit(1)
  }
})

// @INFO: Add unhandled error listeners
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  safeExit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason)
  safeExit(1)
})

runServer().catch((error: unknown) => {
  console.error('Server error:', error)
  safeExit(1)
})