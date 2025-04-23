/* eslint-disable @typescript-eslint/no-explicit-any */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Mock } from "vitest";

import { OpenLibraryServer } from "./index.js";
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

describe("OpenLibraryServer", () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  describe("get_book_by_title tool", () => {
    it("should correctly list the get_book_by_title tool", async () => {
      // Find the handler registered for ListToolsRequestSchema
      const listToolsHandler = mockMcpServer.setRequestHandler.mock.calls.find(
        (call: [any, (...args: any[]) => Promise<any>]) =>
          call[0] === ListToolsRequestSchema,
      )?.[1];

      expect(listToolsHandler).toBeDefined();

      if (listToolsHandler) {
        const result = await listToolsHandler({} as any); // Call the handler
        expect(result.tools).toHaveLength(3);
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
                cover_i: 12345,
              },
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
        const expectedBookInfo = [
          {
            title: "The Hobbit",
            authors: ["J.R.R. Tolkien"],
            first_publish_year: 1937,
            open_library_work_key: "/works/OL45883W",
            edition_count: 120,
            cover_url: "https://covers.openlibrary.org/b/id/12345-M.jpg",
          },
        ];
        expect(JSON.parse(result.content[0].text)).toEqual(expectedBookInfo);
      }
    });

    it("should handle CallTool request for book without cover", async () => {
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
                title: "Book Without Cover",
                author_name: ["Author Name"],
                first_publish_year: 2024,
                key: "/works/OL12345W",
                edition_count: 1,
                // No cover_i field
              },
            ],
          },
        };
        mockedAxios.get.mockResolvedValue(mockApiResponse);

        const mockRequest = {
          params: {
            name: "get_book_by_title",
            arguments: { title: "Book Without Cover" },
          },
        };

        const result = await callToolHandler(mockRequest as any);

        expect(mockedAxios.get).toHaveBeenCalledWith("/search.json", {
          params: { title: "Book Without Cover" },
        });
        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        const expectedBookInfo = [
          {
            title: "Book Without Cover",
            authors: ["Author Name"],
            first_publish_year: 2024,
            open_library_work_key: "/works/OL12345W",
            edition_count: 1,
            // No cover_url expected
          },
        ];
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
            "Invalid arguments for get_book_by_title: title: Required",
          ),
        );
        expect(mockedAxios.get).not.toHaveBeenCalled();
      }
    });

    it("should handle multiple books with the same title", async () => {
      const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
        (call: [any, (...args: any[]) => Promise<any>]) =>
          call[0] === CallToolRequestSchema,
      )?.[1];

      expect(callToolHandler).toBeDefined();

      if (callToolHandler) {
        // Mock a response with multiple books that have the same title
        const mockApiResponse = {
          data: {
            docs: [
              {
                title: "Pride and Prejudice",
                author_name: ["Jane Austen"],
                first_publish_year: 1813,
                key: "/works/OL12345W",
                edition_count: 200,
                cover_i: 12345,
              },
              {
                title: "Pride and Prejudice",
                author_name: ["Jane Austen", "Another Editor"],
                first_publish_year: 1900,
                key: "/works/OL67890W",
                edition_count: 50,
                cover_i: 67890,
              },
              {
                title: "Pride and Prejudice",
                author_name: ["Jane Austen", "Illustrated Edition"],
                first_publish_year: 2000,
                key: "/works/OL54321W",
                edition_count: 10,
                // No cover for this edition
              },
            ],
          },
        };
        mockedAxios.get.mockResolvedValue(mockApiResponse);

        const mockRequest = {
          params: {
            name: "get_book_by_title",
            arguments: { title: "Pride and Prejudice" },
          },
        };

        const result = await callToolHandler(mockRequest as any);

        expect(mockedAxios.get).toHaveBeenCalledWith("/search.json", {
          params: { title: "Pride and Prejudice" },
        });
        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");

        const expectedBooks = [
          {
            title: "Pride and Prejudice",
            authors: ["Jane Austen"],
            first_publish_year: 1813,
            open_library_work_key: "/works/OL12345W",
            edition_count: 200,
            cover_url: "https://covers.openlibrary.org/b/id/12345-M.jpg",
          },
          {
            title: "Pride and Prejudice",
            authors: ["Jane Austen", "Another Editor"],
            first_publish_year: 1900,
            open_library_work_key: "/works/OL67890W",
            edition_count: 50,
            cover_url: "https://covers.openlibrary.org/b/id/67890-M.jpg",
          },
          {
            title: "Pride and Prejudice",
            authors: ["Jane Austen", "Illustrated Edition"],
            first_publish_year: 2000,
            open_library_work_key: "/works/OL54321W",
            edition_count: 10,
            // No cover_url for this edition
          },
        ];

        // Check that all books are returned in the array
        expect(JSON.parse(result.content[0].text)).toEqual(expectedBooks);
        // Verify array length matches expected number of books
        expect(JSON.parse(result.content[0].text).length).toBe(3);
      }
    });
  });

  describe("get_authors_by_name tool", () => {
    it("should correctly list the get_authors_by_name tool", async () => {
      const listToolsHandler = mockMcpServer.setRequestHandler.mock.calls.find(
        (call: [any, (...args: any[]) => Promise<any>]) =>
          call[0] === ListToolsRequestSchema,
      )?.[1];

      expect(listToolsHandler).toBeDefined();

      if (listToolsHandler) {
        const result = await listToolsHandler({} as any);
        expect(result.tools).toHaveLength(3); // Now expects 2 tools
        const authorTool = result.tools.find(
          (tool: any) => tool.name === "get_authors_by_name",
        );
        expect(authorTool).toBeDefined();
        expect(authorTool.description).toBeDefined();
        expect(authorTool.inputSchema).toEqual({
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The name of the author to search for.",
            },
          },
          required: ["name"],
        });
      }
    });

    it("should handle CallTool request for get_authors_by_name successfully", async () => {
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
                key: "OL23919A",
                name: "J. R. R. Tolkien",
                alternate_names: ["John Ronald Reuel Tolkien"],
                birth_date: "3 January 1892",
                top_work: "The Lord of the Rings",
                work_count: 150,
              },
            ],
          },
        };
        mockedAxios.get.mockResolvedValue(mockApiResponse);

        const mockRequest = {
          params: {
            name: "get_authors_by_name",
            arguments: { name: "J. R. R. Tolkien" },
          },
        };

        const result = await callToolHandler(mockRequest as any);

        expect(mockedAxios.get).toHaveBeenCalledWith("/search/authors.json", {
          params: { q: "J. R. R. Tolkien" },
        });
        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        const expectedAuthorInfo = [
          {
            key: "OL23919A",
            name: "J. R. R. Tolkien",
            alternate_names: ["John Ronald Reuel Tolkien"],
            birth_date: "3 January 1892",
            top_work: "The Lord of the Rings",
            work_count: 150,
          },
        ];
        expect(JSON.parse(result.content[0].text)).toEqual(expectedAuthorInfo);
      }
    });

    it("should handle CallTool request when no authors are found", async () => {
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
            name: "get_authors_by_name",
            arguments: { name: "NonExistentAuthor123" },
          },
        };

        const result = await callToolHandler(mockRequest as any);

        expect(mockedAxios.get).toHaveBeenCalledWith("/search/authors.json", {
          params: { q: "NonExistentAuthor123" },
        });
        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text).toBe(
          'No authors found matching name: "NonExistentAuthor123"',
        );
      }
    });

    it("should handle CallTool request with missing name argument", async () => {
      const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
        (call: [any, (...args: any[]) => Promise<any>]) =>
          call[0] === CallToolRequestSchema,
      )?.[1];

      expect(callToolHandler).toBeDefined();

      if (callToolHandler) {
        const mockRequest = {
          params: {
            name: "get_authors_by_name",
            arguments: {}, // Missing name
          },
        };

        await expect(callToolHandler(mockRequest as any)).rejects.toThrow(
          new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for get_authors_by_name: name: Required",
          ),
        );
        expect(mockedAxios.get).not.toHaveBeenCalled();
      }
    });

    it("should handle API errors during CallTool request for get_authors_by_name", async () => {
      const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
        (call: [any, (...args: any[]) => Promise<any>]) =>
          call[0] === CallToolRequestSchema,
      )?.[1];

      expect(callToolHandler).toBeDefined();

      if (callToolHandler) {
        const apiError = new Error("Network Error");
        (apiError as any).isAxiosError = true;
        (apiError as any).response = { statusText: "Gateway Timeout" };
        mockedAxios.get.mockRejectedValue(apiError);

        const mockRequest = {
          params: {
            name: "get_authors_by_name",
            arguments: { name: "ErrorProneAuthor" },
          },
        };

        const result = await callToolHandler(mockRequest as any);

        expect(mockedAxios.get).toHaveBeenCalledWith("/search/authors.json", {
          params: { q: "ErrorProneAuthor" },
        });
        expect(result.isError).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text).toBe(
          "Error processing request: Network Error",
        );
      }
    });

    it("should handle API errors without response status text for get_authors_by_name", async () => {
      const callToolHandler = mockMcpServer.setRequestHandler.mock.calls.find(
        (call: [any, (...args: any[]) => Promise<any>]) =>
          call[0] === CallToolRequestSchema,
      )?.[1];

      expect(callToolHandler).toBeDefined();

      if (callToolHandler) {
        const apiError = new Error("Another Custom Error");
        (apiError as any).isAxiosError = true;
        (apiError as any).response = { status: 500 }; // No statusText
        (apiError as any).message = "Another Custom Error";

        mockedAxios.isAxiosError.mockImplementation(
          (err: any) => !!err.isAxiosError,
        );
        mockedAxios.get.mockRejectedValue(apiError);

        const mockRequest = {
          params: {
            name: "get_authors_by_name",
            arguments: { name: "ErrorAuthorNoStatus" },
          },
        };

        const result = await callToolHandler(mockRequest as any);

        expect(mockedAxios.get).toHaveBeenCalledWith("/search/authors.json", {
          params: { q: "ErrorAuthorNoStatus" },
        });
        expect(result.isError).toBe(true);
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        expect(result.content[0].text).toBe(
          "Open Library API error: Another Custom Error",
        );
      }
    });

    it("should handle multiple authors found", async () => {
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
                key: "OL1A",
                name: "Smith",
                top_work: "Work A",
                work_count: 10,
              },
              {
                key: "OL2B",
                name: "Smith",
                birth_date: "1970",
                top_work: "Work B",
                work_count: 5,
              },
            ],
          },
        };
        mockedAxios.get.mockResolvedValue(mockApiResponse);

        const mockRequest = {
          params: {
            name: "get_authors_by_name",
            arguments: { name: "Smith" },
          },
        };

        const result = await callToolHandler(mockRequest as any);

        expect(mockedAxios.get).toHaveBeenCalledWith("/search/authors.json", {
          params: { q: "Smith" },
        });
        expect(result.isError).toBeUndefined();
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("text");
        const expectedAuthors = [
          {
            key: "OL1A",
            name: "Smith",
            alternate_names: undefined, // Ensure undefined fields are handled if not present
            birth_date: undefined,
            top_work: "Work A",
            work_count: 10,
          },
          {
            key: "OL2B",
            name: "Smith",
            alternate_names: undefined,
            birth_date: "1970",
            top_work: "Work B",
            work_count: 5,
          },
        ];
        expect(JSON.parse(result.content[0].text)).toEqual(expectedAuthors);
        expect(JSON.parse(result.content[0].text).length).toBe(2);
      }
    });
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
          arguments: { title: "The Hobbit" }, // Args don't matter here
        },
      };

      await expect(callToolHandler(mockRequest as any)).rejects.toThrow(
        new McpError(ErrorCode.MethodNotFound, "Unknown tool: unknown_tool"),
      );
      expect(mockedAxios.get).not.toHaveBeenCalled();
    }
  });
});
