import {
  CallToolResult,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import { z } from "zod";

import { DetailedAuthorInfo } from "./get-author-info.types.js"; // Update import path

// Define the schema for the tool arguments
const GetAuthorInfoArgsSchema = z.object({
  author_key: z
    .string()
    .min(1, { message: "Author key cannot be empty" })
    .regex(/^OL\d+A$/, {
      message: "Author key must be in the format OL<number>A",
    }),
});

// Define the handler function using arrow function syntax
export const handleGetAuthorInfo = async (
  args: unknown,
  axiosInstance: AxiosInstance,
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
    const response = await axiosInstance.get<DetailedAuthorInfo>(
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authorData.bio = (authorData.bio as any).value; // Adjust type assertion if needed
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
