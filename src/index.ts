#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import { z } from "zod";

import { BookInfo, OpenLibrarySearchResponse } from "./types.js";

// Zod schema for the tool arguments
const GetBookByTitleArgsSchema = z.object({
  title: z.string().min(1, { message: "Title cannot be empty" }),
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
          // No resources needed as per plan
          resources: {},
          tools: {},
        },
      },
    );

    this.axiosInstance = axios.create({
      baseURL: "https://openlibrary.org",
    });

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // ListTools handler
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
      ],
    }));

    // CallTool handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== "get_book_by_title") {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`,
        );
      }

      // Validate arguments using Zod
      const parseResult = GetBookByTitleArgsSchema.safeParse(
        request.params.arguments,
      );

      if (!parseResult.success) {
        // Combine Zod error messages into a single string
        const errorMessages = parseResult.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid arguments: ${errorMessages}`,
        );
      }

      // Use the validated data
      const bookTitle = parseResult.data.title;

      try {
        const response =
          await this.axiosInstance.get<OpenLibrarySearchResponse>(
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
        // Process the *first* result as per the plan
        const firstDoc = response.data.docs[0];

        const bookInfo: BookInfo = {
          title: firstDoc.title,
          authors: firstDoc.author_name || [],
          first_publish_year: firstDoc.first_publish_year || null,
          open_library_work_key: firstDoc.key,
          edition_count: firstDoc.edition_count || 0,
        };

        return {
          content: [
            {
              type: "text",
              // Return the formatted JSON as a string
              text: JSON.stringify(bookInfo, null, 2),
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
        // Return an error response to the MCP client
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
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Open Library MCP server running on stdio");
  }
}

// Only run the server if the script is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = new OpenLibraryServer();
  server.run().catch(console.error);
}

// Export the class for testing purposes
export { OpenLibraryServer };
