#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { z } from "zod";

import {
  BookInfo,
  OpenLibrarySearchResponse,
  AuthorInfo,
  OpenLibraryAuthorSearchResponse,
  DetailedAuthorInfo, // Import the new type
} from "./types.js";

const GetBookByTitleArgsSchema = z.object({
  title: z.string().min(1, { message: "Title cannot be empty" }),
});

const GetAuthorsByNameArgsSchema = z.object({
  name: z.string().min(1, { message: "Author name cannot be empty" }),
});

// Add schema for the new tool's arguments
const GetAuthorInfoArgsSchema = z.object({
  author_key: z
    .string()
    .min(1, { message: "Author key cannot be empty" })
    .regex(/^OL\d+A$/, {
      message: "Author key must be in the format OL<number>A",
    }),
});

// Schema for the get_author_photo tool arguments
const GetAuthorPhotoArgsSchema = z.object({
  olid: z
    .string()
    .min(1, { message: "OLID cannot be empty" })
    .regex(/^OL\d+A$/, {
      message: "OLID must be in the format OL<number>A",
    }),
});

// Schema for the get_book_cover tool arguments
const GetBookCoverArgsSchema = z.object({
  key: z.enum(["ISBN", "OCLC", "LCCN", "OLID", "ID"], {
    errorMap: () => ({
      message: "Key must be one of ISBN, OCLC, LCCN, OLID, ID",
    }),
  }),
  value: z.string().min(1, { message: "Value cannot be empty" }),
  size: z
    .nullable(z.enum(["S", "M", "L"]))
    .optional()
    .transform((val) => val || "L"),
});

class OpenLibraryServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    this.server = new Server(
      {
        name: "open-library-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      },
    );

    this.axiosInstance = axios.create({
      baseURL: "https://openlibrary.org",
    });

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async _handleGetBookByTitle(args: unknown): Promise<CallToolResult> {
    const parseResult = GetBookByTitleArgsSchema.safeParse(args);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for get_book_by_title: ${errorMessages}`,
      );
    }

    const bookTitle = parseResult.data.title;

    try {
      const response = await this.axiosInstance.get<OpenLibrarySearchResponse>(
        "/search.json",
        {
          params: { title: bookTitle },
        },
      );

      if (
        !response.data ||
        !response.data.docs ||
        response.data.docs.length === 0
      ) {
        return {
          content: [
            {
              type: "text",
              text: `No books found matching title: "${bookTitle}"`,
            },
          ],
        };
      }

      const bookResults = Array.isArray(response.data.docs)
        ? response.data.docs.map((doc) => {
            const bookInfo: BookInfo = {
              title: doc.title,
              authors: doc.author_name || [],
              first_publish_year: doc.first_publish_year || null,
              open_library_work_key: doc.key,
              edition_count: doc.edition_count || 0,
            };

            if (doc.cover_i) {
              bookInfo.cover_url = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
            }

            return bookInfo;
          })
        : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(bookResults, null, 2),
          },
        ],
      };
    } catch (error) {
      let errorMessage = "Failed to fetch book data from Open Library.";
      if (axios.isAxiosError(error)) {
        errorMessage = `Open Library API error: ${
          error.response?.statusText ?? error.message
        }`;
      } else if (error instanceof Error) {
        errorMessage = `Error processing request: ${error.message}`;
      }
      console.error("Error in get_book_by_title:", error);

      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  }

  private async _handleGetAuthorsByName(
    args: unknown,
  ): Promise<CallToolResult> {
    const parseResult = GetAuthorsByNameArgsSchema.safeParse(args);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for get_authors_by_name: ${errorMessages}`,
      );
    }

    const authorName = parseResult.data.name;

    try {
      const response =
        await this.axiosInstance.get<OpenLibraryAuthorSearchResponse>(
          "/search/authors.json", // Use the author search endpoint
          {
            params: { q: authorName }, // Use 'q' parameter for author search
          },
        );

      if (
        !response.data ||
        !response.data.docs ||
        response.data.docs.length === 0
      ) {
        return {
          content: [
            {
              type: "text",
              text: `No authors found matching name: "${authorName}"`,
            },
          ],
        };
      }

      const authorResults: AuthorInfo[] = response.data.docs.map((doc) => ({
        key: doc.key,
        name: doc.name,
        alternate_names: doc.alternate_names,
        birth_date: doc.birth_date,
        top_work: doc.top_work,
        work_count: doc.work_count,
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(authorResults, null, 2),
          },
        ],
      };
    } catch (error) {
      let errorMessage = "Failed to fetch author data from Open Library.";
      if (axios.isAxiosError(error)) {
        errorMessage = `Open Library API error: ${
          error.response?.statusText ?? error.message
        }`;
      } else if (error instanceof Error) {
        errorMessage = `Error processing request: ${error.message}`;
      }
      console.error("Error in get_authors_by_name:", error);
      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  }

  // Add handler function for the new tool
  private _handleGetAuthorInfo = async (
    args: unknown,
  ): Promise<CallToolResult> => {
    const parseResult = GetAuthorInfoArgsSchema.safeParse(args);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for get_author_info: ${errorMessages}`,
      );
    }

    const authorKey = parseResult.data.author_key;

    try {
      const response = await this.axiosInstance.get<DetailedAuthorInfo>(
        `/authors/${authorKey}.json`,
      );

      if (!response.data) {
        // Should not happen if API returns 200, but good practice
        return {
          content: [
            {
              type: "text",
              text: `No data found for author key: "${authorKey}"`,
            },
          ],
        };
      }

      // Optionally format the bio if it's an object
      const authorData = { ...response.data };
      if (typeof authorData.bio === "object" && authorData.bio !== null) {
        authorData.bio = authorData.bio.value;
      }

      return {
        content: [
          {
            type: "text",
            // Return the full author details as JSON
            text: JSON.stringify(authorData, null, 2),
          },
        ],
      };
    } catch (error) {
      let errorMessage = `Failed to fetch author data for key ${authorKey}.`;
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          errorMessage = `Author with key "${authorKey}" not found.`;
        } else {
          errorMessage = `Open Library API error: ${
            error.response?.statusText ?? error.message
          }`;
        }
      } else if (error instanceof Error) {
        errorMessage = `Error processing request: ${error.message}`;
      }
      console.error(`Error in get_author_info (${authorKey}):`, error);

      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
        isError: true,
      };
    }
  };

  // Handler function for the get_author_photo tool
  private _handleGetAuthorPhoto = async (
    args: unknown,
  ): Promise<CallToolResult> => {
    const parseResult = GetAuthorPhotoArgsSchema.safeParse(args);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for get_author_photo: ${errorMessages}`,
      );
    }

    const olid = parseResult.data.olid;
    const photoUrl = `https://covers.openlibrary.org/a/olid/${olid}-L.jpg`; // Use -L for large size

    // Note: We don't actually fetch the image here, just return the URL.
    // The Open Library Covers API doesn't provide a way to check if an image exists
    // other than trying to fetch it. We assume the URL is correct if the OLID format is valid.

    return {
      content: [
        {
          type: "text",
          text: photoUrl,
        },
      ],
    };
    // No try/catch needed here as we are just constructing a URL string based on validated input.
  };

  // Handler function for the get_book_cover tool
  private _handleGetBookCover = async (
    args: unknown,
  ): Promise<CallToolResult> => {
    const parseResult = GetBookCoverArgsSchema.safeParse(args);

    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for get_book_cover: ${errorMessages}`,
      );
    }

    const { key, value, size } = parseResult.data;
    // Construct the URL according to the Open Library Covers API format
    const coverUrl = `https://covers.openlibrary.org/b/${key.toLowerCase()}/${value}-${size}.jpg`;

    return {
      content: [
        {
          type: "text",
          text: coverUrl,
        },
      ],
    };
    // No try/catch needed here as we are just constructing a URL string based on validated input.
  };

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_book_by_title",
          description: "Search for a book by its title on Open Library.",
          inputSchema: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "The title of the book to search for.",
              },
            },
            required: ["title"],
          },
        },
        {
          name: "get_authors_by_name",
          description: "Search for author information on Open Library.",
          inputSchema: {
            type: "object",
            properties: {
              name: {
                type: "string",
                description: "The name of the author to search for.",
              },
            },
            required: ["name"],
          },
        },
        {
          name: "get_author_info",
          description:
            "Get detailed information for a specific author using their Open Library Author Key (e.g., OL23919A).",
          inputSchema: {
            type: "object",
            properties: {
              author_key: {
                type: "string",
                description:
                  "The Open Library key for the author (e.g., OL23919A).",
              },
            },
            required: ["author_key"],
          },
        },
        {
          // Add the new tool definition
          name: "get_author_photo",
          description:
            "Get the URL for an author's photo using their Open Library Author ID (OLID, e.g. OL23919A).",
          inputSchema: {
            type: "object",
            properties: {
              olid: {
                type: "string",
                description:
                  "The Open Library Author ID (OLID) for the author (e.g. OL23919A).",
              },
            },
            required: ["olid"],
          },
        },
        {
          // Add the get-book-cover tool definition
          name: "get_book_cover",
          description:
            "Get the URL for a book's cover image using a key (ISBN, OCLC, LCCN, OLID, ID) and value.",
          inputSchema: {
            type: "object",
            properties: {
              key: {
                type: "string",
                // ID is internal cover ID
                enum: ["ISBN", "OCLC", "LCCN", "OLID", "ID"],
                description:
                  "The type of identifier used (ISBN, OCLC, LCCN, OLID, ID).",
              },
              value: {
                type: "string",
                description: "The value of the identifier.",
              },
              size: {
                type: "string",
                enum: ["S", "M", "L"],
                description: "The desired size of the cover (S, M, or L).",
              },
            },
            required: ["key", "value"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "get_book_by_title":
          return this._handleGetBookByTitle(args);
        case "get_authors_by_name":
          return this._handleGetAuthorsByName(args);
        case "get_author_info":
          return this._handleGetAuthorInfo(args);
        case "get_author_photo":
          return this._handleGetAuthorPhoto(args);
        case "get_book_cover":
          return this._handleGetBookCover(args);
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Open Library MCP server running on stdio");
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = new OpenLibraryServer();
  server.run().catch(console.error);
}

export { OpenLibraryServer };
