import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { ImapFlow } from 'imapflow';

// Load environment variables from .env file
dotenv.config();

// Create an MCP server with metadata
const server = new McpServer({
  name: "mail-server",
  version: "1.0.0"
});

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  logger: true, // Enable detailed logging
  debug: true,  // Show SMTP traffic
  tls: {
    minVersion: 'TLSv1.2' // Force modern TLS
  }
});

// Add an email sending tool (server.tool)
server.registerTool("send_email", 
  {
    title: "Send Email Tool",
    description: "Send an email to a specified address",
    inputSchema: {
      to: z.string().email(),        // Valid email format
      subject: z.string(),           // Email subject
      body: z.string(),              // Email body content
    },
  },
  
  async ({ to, subject, body }) => {
    try {
      console.log('Attempting to send to:', to);
      
      const info = await mailer.sendMail({
        from: `${process.env.FROM_NAME} <${process.env.FROM_ADDRESS}>`,
        to,
        subject,
        text: body,
        html: `<p>${body}</p>` // Add HTML version
      });

      console.log('Email sent! Message ID:', info.messageId);
      return {
        content: [{ type: "text", text: `Email sent to ${to}! ID: ${info.messageId}` }]
      };
    } catch (err) {
      console.error('FULL ERROR:', {
        message: err.message,
        responseCode: err.responseCode,
        response: err.response
      });
      return {
        content: [{ type: "text", text: `Failed: ${err.message}` }]
      };
    }
  }
);

server.registerTool("read_emails", 
  {
    title: "Email Reader Tool",
    description: "Read emails from your inbox with filtering options",
    inputSchema: {
      mailbox: z.string().default("INBOX").describe("Mailbox name (INBOX, SPAM, etc)"),
      limit: z.number().default(10).describe("Max number of emails to fetch"),
      unseenOnly: z.boolean().default(false).describe("Fetch only unread emails"),
      afterDate: z.string().optional().describe("Only emails after this date (YYYY-MM-DD)")
    },
  },
  async ({ mailbox, limit, unseenOnly, afterDate }) => {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS,
      },
      logger: false
    });

    try {
      await client.connect();
      let lock = await client.getMailboxLock(mailbox);
      let messages = [];
      let searchCriteria = {};

      if (unseenOnly) searchCriteria.seen = false;
      if (afterDate) searchCriteria.since = new Date(afterDate);

      for await (let message of client.fetch(searchCriteria, {
        source: true,
        limit: limit,
        envelope: true
      })) {
        messages.push({
          id: message.uid,
          date: message.envelope.date,
          from: message.envelope.from[0].address,
          subject: message.envelope.subject,
          preview: message.envelope.preview
        });
      }

      lock.release();
      await client.logout();

      return {
        content: [{
          type: "text",
          text: `Found ${messages.length} emails in ${mailbox}`,
          details: messages
        }]
      };
    } catch (err) {
      return {
        content: [{
          type: "text", 
          text: `Error reading emails: ${err.message}`
        }]
      };
    }
  }
);

// Register a dynamic greeting resource
server.registerResource(
  "greeting",
  new ResourceTemplate("greeting://{name}", { list: undefined }),
  { 
    title: "Greeting Resource",  // Display name for UI
    description: "Generates a dynamic greeting based on the provided name"
  },
  async (uri, { name }) => {
    return {
      contents: [{
        uri: uri.href,
        text: `Hello, ${name}!`
      }]
    };
  }
);

// Set up the transport mechanism (stdin for input, stdout for output)
const transport = new StdioServerTransport();

// Connect the server to the transport to start receiving and sending messages
await server.connect(transport);

console.log(`✅ MCP Server started successfully! Listening for requests...`);
