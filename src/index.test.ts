import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { OpenLibraryServer } from "./index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// Mock the MCP Server and its methods
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  const mockServer = {
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onerror: vi.fn(),
  };
  return {
    Server: vi.fn(() => mockServer),
  };
});

// Mock axios
vi.mock("axios");
const mockedAxios = vi.mocked(axios, true); // Use true for deep mocking

import { Mock } from "vitest";

describe("OpenLibraryServer", () => {
  let serverInstance: OpenLibraryServer;
  // Explicitly type the mock server instance based on the mocked structure
  let mockMcpServer: {
    setRequestHandler: Mock<
      (schema: any, handler: (...args: any[]) => Promise<any>) => void
    >;
    connect: Mock<(transport: any) => Promise<void>>;
    close: Mock<() => Promise<void>>;
    onerror: Mock<(error: any) => void>;
  };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    // Create a new instance, which will internally create a mocked Server
    serverInstance = new OpenLibraryServer();
    // Get the mocked MCP Server instance created by the constructor
    mockMcpServer = (Server as any).mock.results[0].value;
    mockedAxios.create.mockReturnThis(); // Ensure axios.create() returns the mocked instance
  });

  it("should correctly list the get_book_by_title tool", async () => {
    // Find the handler registered for ListToolsRequestSchema
    const listToolsHandler = mockMcpServer.setRequestHandler.mock.calls.find(
      (call: [any, (...args: any[]) => Promise<any>]) =>
        call[0] === ListToolsRequestSchema,
    )?.[1];

    expect(listToolsHandler).toBeDefined();

    if (listToolsHandler) {
      const result = await listToolsHandler({} as any); // Call the handler
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("get_book_by_title");
      expect(result.tools[0].description).toBeDefined();
      expect(result.tools[0].inputSchema).toEqual({
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "The title of the book to search for.",
          },
        },
        required: ["title"],
      });
    }
  });

  it("should handle CallTool request for get_book_by_title successfully", async () => {
    // Find the handler registered for CallToolRequestSchema
    const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
      (call: [any, (...args: any[]) => Promise<any>]) =>
        call[0] === CallToolRequestSchema,
    )?.[1];

    expect(callToolHandler).toBeDefined();

    if (callToolHandler) {
      const mockApiResponse = {
        data: {
          docs: [
            {
              title: "The Hobbit",
              author_name: ["J.R.R. Tolkien"],
              first_publish_year: 1937,
              key: "/works/OL45883W",
              edition_count: 120,
            },
            // Add more docs if needed to test picking the first one
          ],
        },
      };
      mockedAxios.get.mockResolvedValue(mockApiResponse);

      const mockRequest = {
        params: {
          name: "get_book_by_title",
          arguments: { title: "The Hobbit" },
        },
      };

      const result = await callToolHandler(mockRequest as any);

      expect(mockedAxios.get).toHaveBeenCalledWith("/search.json", {
        params: { title: "The Hobbit" },
      });
      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const expectedBookInfo = {
        title: "The Hobbit",
        authors: ["J.R.R. Tolkien"],
        first_publish_year: 1937,
        open_library_work_key: "/works/OL45883W",
        edition_count: 120,
      };
      expect(JSON.parse(result.content[0].text)).toEqual(expectedBookInfo);
    }
  });

  it("should handle CallTool request when no books are found", async () => {
    const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
      (call: [any, (...args: any[]) => Promise<any>]) =>
        call[0] === CallToolRequestSchema,
    )?.[1];

    expect(callToolHandler).toBeDefined();

    if (callToolHandler) {
      const mockApiResponse = {
        data: {
          docs: [], // Empty docs array
        },
      };
      mockedAxios.get.mockResolvedValue(mockApiResponse);

      const mockRequest = {
        params: {
          name: "get_book_by_title",
          arguments: { title: "NonExistentBook123" },
        },
      };

      const result = await callToolHandler(mockRequest as any);

      expect(mockedAxios.get).toHaveBeenCalledWith("/search.json", {
        params: { title: "NonExistentBook123" },
      });
      expect(result.isError).toBeUndefined(); // Not an API error, just no results
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toBe(
        'No books found matching title: "NonExistentBook123"',
      );
    }
  });

  it("should handle CallTool request with missing title argument", async () => {
    const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
      (call: [any, (...args: any[]) => Promise<any>]) =>
        call[0] === CallToolRequestSchema,
    )?.[1];

    expect(callToolHandler).toBeDefined();

    if (callToolHandler) {
      const mockRequest = {
        params: {
          name: "get_book_by_title",
          arguments: {}, // Missing title
        },
      };

      await expect(callToolHandler(mockRequest as any)).rejects.toThrow(
        new McpError(
          ErrorCode.InvalidParams,
          "Invalid arguments: title: Required",
        ),
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
    }
  });

  it("should handle CallTool request for an unknown tool", async () => {
    const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
      (call: [any, (...args: any[]) => Promise<any>]) =>
        call[0] === CallToolRequestSchema,
    )?.[1];

    expect(callToolHandler).toBeDefined();

    if (callToolHandler) {
      const mockRequest = {
        params: {
          name: "unknown_tool",
          arguments: { title: "The Hobbit" },
        },
      };

      await expect(callToolHandler(mockRequest as any)).rejects.toThrow(
        new McpError(ErrorCode.MethodNotFound, "Unknown tool: unknown_tool"),
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
    }
  });

  it("should handle API errors during CallTool request", async () => {
    const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
      (call: [any, (...args: any[]) => Promise<any>]) =>
        call[0] === CallToolRequestSchema,
    )?.[1];

    expect(callToolHandler).toBeDefined();

    if (callToolHandler) {
      const apiError = new Error("Network Error");
      // Simulate an Axios error structure
      (apiError as any).isAxiosError = true;
      (apiError as any).response = { statusText: "Service Unavailable" };
      mockedAxios.get.mockRejectedValue(apiError);

      const mockRequest = {
        params: {
          name: "get_book_by_title",
          arguments: { title: "ErrorProneBook" },
        },
      };

      const result = await callToolHandler(mockRequest as any);

      expect(mockedAxios.get).toHaveBeenCalledWith("/search.json", {
        params: { title: "ErrorProneBook" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain(
        "Error processing request: Network Error",
      );
    }
  });

  it("should handle API errors without response status text", async () => {
    const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
      (call: [any, (...args: any[]) => Promise<any>]) =>
        call[0] === CallToolRequestSchema,
    )?.[1];

    expect(callToolHandler).toBeDefined();

    if (callToolHandler) {
      const apiError = new Error("Custom Error Message");
      // Simulate an Axios error structure without response.statusText
      (apiError as any).isAxiosError = true; // Mark it as an Axios error
      (apiError as any).response = { status: 503 }; // No statusText
      (apiError as any).message = "Custom Error Message"; // Ensure message is set

      // Mock isAxiosError to recognize our simulated error object
      mockedAxios.isAxiosError.mockImplementation((err: any) => !!err.isAxiosError);

      mockedAxios.get.mockRejectedValue(apiError);

      const mockRequest = {
        params: {
          name: "get_book_by_title",
          arguments: { title: "ErrorProneBookNoStatus" },
        },
      };

      const result = await callToolHandler(mockRequest as any);

      expect(mockedAxios.get).toHaveBeenCalledWith("/search.json", {
        params: { title: "ErrorProneBookNoStatus" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      // Check that it falls back to error.message
      expect(result.content[0].text).toBe(
        "Open Library API error: Custom Error Message",
      );
    }
  });
});
