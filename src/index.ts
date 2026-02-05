#!/usr/bin/env node
// HTMW MCP Server - Main Entry Point
import 'dotenv/config';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
import { getTransactionHistory } from './tools/transactions.js';
import type { Config, OrderRequest } from './types.js';

// Load configuration from environment variables
const config: Config = {
    username: process.env.HTMW_USERNAME || '',
    password: process.env.HTMW_PASSWORD || '',
    baseUrl: 'https://app.howthemarketworks.com',
};

if (!config.username || !config.password) {
    console.error('Error: HTMW_USERNAME and HTMW_PASSWORD environment variables are required');
    process.exit(1);
}

// Initialize auth and API client
const auth = new AuthManager(config);
const api = new ApiClient(auth);

// Check if running in a web environment (Render sets PORT)
if (process.env.PORT) {
    console.error('Detected PORT environment variable. Switching to Web/SSE mode...');
    await import('./server.js');
    // server.js handles its own execution
} else {
    // Proceed with Stdio transport for CLI/Desktop use
    const server = new Server(
        {
            name: 'htmw-mcp',
            version: '1.0.0',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );


    // Define available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'get_portfolio',
                    description: 'Get current portfolio holdings, positions, account balances (cash, buying power, total value), AND all open orders (stop-losses, profit-taking, buy/sell orders). Returns everything needed to manage positions and orders together.',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'get_quote',
                    description: 'Get real-time quote for a stock symbol',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            symbol: {
                                type: 'string',
                                description: 'Stock ticker symbol (e.g., AAPL, MSFT)',
                            },
                        },
                        required: ['symbol'],
                    },
                },
                {
                    name: 'search_symbol',
                    description: 'Search for stock symbols by name or partial ticker',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: 'Search query (company name or partial symbol)',
                            },
                        },
                        required: ['query'],
                    },
                },
                {
                    name: 'get_open_orders',
                    description: 'Get a list of currently open trading orders (pending orders)',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'cancel_order',
                    description: 'Cancel a pending trading order using its Order ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            orderId: {
                                type: 'string',
                                description: 'The Order ID (OrderConf) of the order to cancel',
                            },
                        },
                        required: ['orderId'],
                    },
                },
                {
                    name: 'execute_trade',
                    description: 'Place a buy or sell order for a stock. Supports Market, Limit, and Stop order types.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            symbol: {
                                type: 'string',
                                description: 'Stock ticker symbol',
                            },
                            action: {
                                type: 'string',
                                enum: ['buy', 'sell', 'short', 'cover'],
                                description: 'Action to perform',
                            },
                            quantity: {
                                type: 'number',
                                description: 'Number of shares to trade',
                            },
                            orderType: {
                                type: 'string',
                                enum: ['market', 'limit', 'stop'],
                                description: 'Type of order',
                            },
                            limitPrice: {
                                type: 'number',
                                description: 'Limit price (required for limit orders)',
                            },
                            stopPrice: {
                                type: 'number',
                                description: 'Stop price (required for stop orders)',
                            },
                            duration: {
                                type: 'string',
                                enum: ['day', 'gtc'],
                                description: 'Order duration (default: day)',
                            },
                        },
                        required: ['symbol', 'action', 'quantity', 'orderType'],
                    },
                },
                {
                    name: 'get_contest_rankings',
                    description: 'Get contest rankings showing top 5 participants and your own ranking',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            tournamentId: {
                                type: 'string',
                                description: 'Tournament ID (optional - auto-discovered)',
                            },
                            rankingType: {
                                type: 'string',
                                enum: ['Overall', 'Weekly', 'Monthly'],
                                description: 'Type of ranking (default: Overall)',
                            },
                        },
                        required: [],
                    },
                },
                {
                    name: 'list_tournaments',
                    description: 'List active tournaments/contests for the account',
                    inputSchema: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                },
                {
                    name: 'stock_lookup',
                    description: 'Get extremely detailed stock information including pre/post market data and technical indicators',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            symbol: {
                                type: 'string',
                                description: 'Stock ticker symbol (e.g. AAPL)',
                            },
                        },
                        required: ['symbol'],
                    },
                },
                {
                    name: 'tradingview_screener',
                    description: 'Get a list of active stocks from TradingView screener (America market, sorted by volume)',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                description: 'Number of results to return (default: 50, max: 100)',
                            },
                            type: {
                                type: 'string',
                                enum: ['active', 'momentum'],
                                description: 'Type of screener to run (default: active)',
                            },
                        },
                        required: [],
                    },
                },
                {
                    name: 'get_transaction_history',
                    description: 'Get historical transactions including filled orders, dividends, and cash adjustments.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            days: {
                                type: 'number',
                                description: 'Number of days to look back (default: 30)',
                            },
                        },
                        required: [],
                    },
                },
            ],
        };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            switch (name) {
                case 'get_portfolio': {
                    const portfolio = await getPortfolio(api);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(portfolio, null, 2) }],
                    };
                }

                case 'get_quote': {
                    const { symbol } = args as { symbol: string };
                    const quote = await getQuote(api, symbol);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(quote, null, 2) }],
                    };
                }

                case 'search_symbol': {
                    const { query } = args as { query: string };
                    const results = await searchSymbol(api, query);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                    };
                }

                case 'get_open_orders': {
                    const orders = await getOpenOrders(api);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(orders, null, 2) }],
                    };
                }

                case 'cancel_order': {
                    const { orderId } = args as { orderId: string };
                    const result = await cancelOrder(api, orderId);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    };
                }

                case 'execute_trade': {
                    const params = args as any;
                    const result = await executeTrade(api, params);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                    };
                }

                case 'get_contest_rankings': {
                    const { tournamentId, rankingType } = args as {
                        tournamentId?: string;
                        rankingType?: 'Overall' | 'Weekly' | 'Monthly'
                    };
                    const rankings = await getRankings(api, tournamentId, rankingType || 'Overall');
                    return {
                        content: [{ type: 'text', text: JSON.stringify(rankings, null, 2) }],
                    };
                }

                case 'list_tournaments': {
                    const tournaments = await discoverTournaments(api);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(tournaments, null, 2) }],
                    };
                }

                case 'tradingview_screener': {
                    const { limit, type } = args as { limit?: number; type?: 'active' | 'momentum' };
                    const results = await getTradingViewScreener(limit, type);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
                    };
                }

                case 'get_transaction_history': {
                    const days = Number(args?.days) || 30;
                    return {
                        content: [{ type: 'text', text: JSON.stringify(await getTransactionHistory(api, days), null, 2) }],
                    };
                }

                case 'stock_lookup': {
                    const { symbol } = args as { symbol: string };
                    const details = await getStockLookup(symbol);
                    return {
                        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
                    };
                }

                default:
                    return {
                        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                        isError: true,
                    };
            }
        } catch (error) {
            return {
                content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                isError: true,
            };
        }
    });

    // Start server
    async function main() {
        console.error('HTMW MCP Server starting...');
        await auth.login();
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('HTMW MCP Server running on stdio');
    }

    main().catch(console.error);
}
