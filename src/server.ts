
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from './auth.js';
import { ApiClient } from './api.js';
import { getPortfolio } from './tools/getPortfolio.js';
import { executeTrade } from './tools/executeTrade.js';
import { searchSymbol, getQuote } from './tools/lookup.js';
import { getOpenOrders, cancelOrder } from './tools/orders.js';
import { getRankings, discoverTournaments } from './tools/getRankings.js';
import { getTradingViewScreener, getStockLookup } from './tools/tradingview.js';
import type { Config } from './types.js';

// Load configuration
const config: Config = {
    username: process.env.HTMW_USERNAME || '',
    password: process.env.HTMW_PASSWORD || '',
    baseUrl: 'https://app.howthemarketworks.com',
};

if (!config.username || !config.password) {
    console.error('Error: HTMW_USERNAME and HTMW_PASSWORD environment variables are required');
    process.exit(1);
}

const auth = new AuthManager(config);
const api = new ApiClient(auth);

const server = new Server(
    {
        name: 'htmw-mcp-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Define tools (Synchronized with index.ts)
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'get_portfolio',
                description: 'Get current portfolio holdings, positions, and account balances',
                inputSchema: { type: 'object', properties: {}, required: [] },
            },
            {
                name: 'get_quote',
                description: 'Get real-time quote for a stock symbol',
                inputSchema: {
                    type: 'object',
                    properties: { symbol: { type: 'string', description: 'Stock ticker' } },
                    required: ['symbol'],
                },
            },
            {
                name: 'search_symbol',
                description: 'Search for stock symbols by name or partial ticker',
                inputSchema: {
                    type: 'object',
                    properties: { query: { type: 'string', description: 'Search query' } },
                    required: ['query'],
                },
            },
            {
                name: 'get_open_orders',
                description: 'Get list of open orders',
                inputSchema: { type: 'object', properties: {}, required: [] },
            },
            {
                name: 'cancel_order',
                description: 'Cancel an open order',
                inputSchema: {
                    type: 'object',
                    properties: { orderId: { type: 'string', description: 'Order ID to cancel' } },
                    required: ['orderId'],
                },
            },
            {
                name: 'execute_trade',
                description: 'Place a buy or sell order',
                inputSchema: {
                    type: 'object',
                    properties: {
                        symbol: { type: 'string' },
                        action: { type: 'string', enum: ['buy', 'sell', 'short', 'cover'] },
                        quantity: { type: 'number' },
                        orderType: { type: 'string', enum: ['market', 'limit', 'stop'] },
                        limitPrice: { type: 'number' },
                        stopPrice: { type: 'number' },
                        duration: { type: 'string', enum: ['day', 'gtc'] },
                    },
                    required: ['symbol', 'action', 'quantity', 'orderType'],
                },
            },
            {
                name: 'get_contest_rankings',
                description: 'Get contest rankings',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tournamentId: { type: 'string' },
                        rankingType: { type: 'string', enum: ['Overall', 'Weekly', 'Monthly'] },
                    },
                    required: [],
                },
            },
            {
                name: 'list_tournaments',
                description: 'List active tournaments',
                inputSchema: { type: 'object', properties: {}, required: [] },
            },
            {
                name: 'stock_lookup',
                description: 'Get detailed stock info and indicators',
                inputSchema: {
                    type: 'object',
                    properties: { symbol: { type: 'string' } },
                    required: ['symbol'],
                },
            },
            {
                name: 'tradingview_screener',
                description: 'Get a list of active stocks from TradingView screener',
                inputSchema: {
                    type: 'object',
                    properties: {
                        limit: { type: 'number' },
                        type: { type: 'string', enum: ['active', 'momentum'] }
                    },
                    required: [],
                },
            },
        ],
    };
});

// Handle tools (Synchronized with index.ts)
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'get_portfolio':
                return { content: [{ type: 'text', text: JSON.stringify(await getPortfolio(api), null, 2) }] };
            case 'get_quote':
                return { content: [{ type: 'text', text: JSON.stringify(await getQuote(api, (args as any).symbol), null, 2) }] };
            case 'search_symbol':
                return { content: [{ type: 'text', text: JSON.stringify(await searchSymbol(api, (args as any).query), null, 2) }] };
            case 'get_open_orders':
                return { content: [{ type: 'text', text: JSON.stringify(await getOpenOrders(api), null, 2) }] };
            case 'cancel_order':
                return { content: [{ type: 'text', text: JSON.stringify(await cancelOrder(api, (args as any).orderId), null, 2) }] };
            case 'execute_trade':
                return { content: [{ type: 'text', text: JSON.stringify(await executeTrade(api, args as any), null, 2) }] };
            case 'get_contest_rankings':
                return { content: [{ type: 'text', text: JSON.stringify(await getRankings(api, (args as any).tournamentId, (args as any).rankingType || 'Overall'), null, 2) }] };
            case 'list_tournaments':
                return { content: [{ type: 'text', text: JSON.stringify(await discoverTournaments(api), null, 2) }] };
            case 'tradingview_screener':
                return { content: [{ type: 'text', text: JSON.stringify(await getTradingViewScreener((args as any).limit, (args as any).type), null, 2) }] };
            case 'stock_lookup':
                return { content: [{ type: 'text', text: JSON.stringify(await getStockLookup((args as any).symbol), null, 2) }] };
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
});

const app = express();
app.use(express.json());

// Store transports by session ID to support multiple concurrent users
const transports = new Map<string, SSEServerTransport>();

// The /mcp or /sse endpoint for establishing the SSE stream (GET)
app.get('/mcp', async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;

    transports.set(sessionId, transport);

    transport.onclose = () => {
        transports.delete(sessionId);
    };

    try {
        await server.connect(transport);
    } catch (error) {
        console.error(`[Server] Failed to connect transport for session ${sessionId}:`, error);
        transports.delete(sessionId);
        if (!res.headersSent) {
            res.status(500).send('Failed to establish MCP connection');
        }
    }
});

// Messages endpoint for receiving client JSON-RPC requests (POST)
app.post('/messages', async (req, res) => {
    const sessionId = (req.query.sessionId as string) || (req.body?.sessionId as string);

    if (!sessionId) {
        res.status(400).send('Missing sessionId parameter');
        return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
        res.status(404).send(`Session ${sessionId} not found or expired`);
        return;
    }

    try {
        await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
        console.error(`[Server] Error handling message for session ${sessionId}:`, error);
        if (!res.headersSent) {
            res.status(500).send('Internal error');
        }
    }
});

// Alias /sse to /mcp for backward compatibility or variety (used by some tools)
app.get('/sse', (req, res) => res.redirect('/mcp'));

const PORT = process.env.PORT || 3000;

// Note: In a production environment, you might want to lazily authenticate per session
// or use a shared session pool. For simplicity and reliability in HTMW context, 
// we login once to verify credentials at startup.
auth.login().then(() => {
    app.listen(PORT, () => {
        console.error(`HTMW MCP SSE Server running on http://localhost:${PORT}/mcp`);
    });
}).catch(err => {
    console.error('Critical Failure: Could not initial-login to HTMW:', err);
    process.exit(1);
});
