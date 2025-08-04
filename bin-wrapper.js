#!/usr/bin/env node
// Wrapper script to allow npx @geobio/mcp-open-library to work properly
import { OpenLibraryServer } from './build/index.js';

const server = new OpenLibraryServer();
server.run().catch(console.error);
