import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as mysql2 from 'mysql2/promise';

// Mock the mysql2 module
vi.mock('mysql2/promise', () => {
  const mockConnection = {
    query: vi.fn(),
    release: vi.fn(),
    beginTransaction: vi.fn(),
    rollback: vi.fn(),
  };
  
  const mockPool = {
    getConnection: vi.fn().mockResolvedValue(mockConnection),
    end: vi.fn().mockResolvedValue(undefined),
  };
  
  return {
    createPool: vi.fn().mockReturnValue(mockPool),
  };
});

// Import the functions after mocking
import { executeQuery, executeReadOnlyQuery } from '../../dist/index.js';

describe('Query Functions', () => {
  let mockPool: any;
  let mockConnection: any;
  
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    
    // Get references to the mocked objects
    mockPool = mysql2.createPool({});
    mockConnection = mockPool.getConnection();
  });
  
  afterEach(() => {
    vi.resetAllMocks();
  });
  
  describe('executeQuery', () => {
    it('should execute a query and return results', async () => {
      // Setup
      const mockResults = [{ id: 1, name: 'Test' }];
      mockConnection.query.mockResolvedValueOnce([mockResults]);
      
      // Execute
      const sql = 'SELECT * FROM test';
      const params = [];
      const result = await executeQuery(sql, params);
      
      // Assert
      expect(mockPool.getConnection).toHaveBeenCalledTimes(1);
      expect(mockConnection.query).toHaveBeenCalledWith(sql, params);
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockResults);
    });
    
    it('should handle query parameters correctly', async () => {
      // Setup
      const mockResults = [{ id: 1, name: 'Test' }];
      mockConnection.query.mockResolvedValueOnce([mockResults]);
      
      // Execute
      const sql = 'SELECT * FROM test WHERE id = ?';
      const params = [1];
      await executeQuery(sql, params);
      
      // Assert
      expect(mockConnection.query).toHaveBeenCalledWith(sql, params);
    });
    
    it('should release connection even if query fails', async () => {
      // Setup
      const error = new Error('Query failed');
      mockConnection.query.mockRejectedValueOnce(error);
      
      // Execute and catch error
      const sql = 'SELECT * FROM test';
      await expect(executeQuery(sql, [])).rejects.toThrow(error);
      
      // Assert connection was released
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('executeReadOnlyQuery', () => {
    it('should execute a read-only query in a transaction', async () => {
      // Setup
      const mockResults = [{ id: 1, name: 'Test' }];
      mockConnection.query.mockResolvedValueOnce(undefined) // SET SESSION TRANSACTION READ ONLY
                          .mockResolvedValueOnce(undefined) // beginTransaction
                          .mockResolvedValueOnce([mockResults]) // actual query
                          .mockResolvedValueOnce(undefined) // rollback
                          .mockResolvedValueOnce(undefined); // SET SESSION TRANSACTION READ WRITE
      
      // Execute
      const sql = 'SELECT * FROM test';
      const result = await executeReadOnlyQuery(sql);
      
      // Assert
      expect(mockConnection.query).toHaveBeenCalledTimes(3);
      expect(mockConnection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify(mockResults, null, 2),
          },
        ],
        isError: false,
      });
    });
    
    it('should rollback transaction if query fails', async () => {
      // Setup
      mockConnection.query.mockResolvedValueOnce(undefined) // SET SESSION TRANSACTION READ ONLY
                          .mockResolvedValueOnce(undefined) // beginTransaction
                          .mockRejectedValueOnce(new Error('Query failed')); // actual query
      
      // Execute and catch error
      const sql = 'SELECT * FROM test';
      await expect(executeReadOnlyQuery(sql)).rejects.toThrow('Query failed');
      
      // Assert
      expect(mockConnection.rollback).toHaveBeenCalledTimes(1);
      expect(mockConnection.release).toHaveBeenCalledTimes(1);
    });
  });
}); 