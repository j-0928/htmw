# HowTheMarketWorks (HTMW) MCP Server

A self-hosted Model Context Protocol (MCP) server for programmatic trading on [HowTheMarketWorks.com](https://www.howthemarketworks.com).

This server allows AI agents (like Claude Desktop, Poke, etc.) to:
- View portfolio holdings, cash balance, and buying power.
- Search for stock symbols.
- Execute trades (Buy/Sell, Market/Limit/Stop orders).
- View contest rankings and performance.

## Features

- **Authentication**: Usage of your existing HTMW credentials via session cookies.
- **Portfolio Management**: Real-time view of your open positions and account value.
- **Trade Execution**: Support for Market, Limit, Stop, Trailing Stop ($ and %) orders.
- **Rankings**: View top players and your standing in the current tournament.

## Prerequisites

- Node.js (v18 or higher)
- A HowTheMarketWorks.com account

## Setup

1. **Clone/Download** this repository.
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Build the project**:
   ```bash
   npm run build
   ```

## Configuration

The server requires your HTMW authentication credentials. You can provide these via environment variables or command line arguments.

**Environment Variables:**
- `HTMW_USERNAME`: Your login username.
- `HTMW_PASSWORD`: Your login password.

## Running the Server

### Standalone (Stdio)

You can run the server directly using `node`. This is how most MCP clients will interact with it.

```bash
export HTMW_USERNAME="your_username"
export HTMW_PASSWORD="your_password"
node dist/index.js
```

### Poke / Claude Desktop Configuration

Add the following configuration to your MCP settings file (e.g., `~/Library/Application Support/Claude/claude_desktop_config.json` or Poke config).

```json
{
  "mcpServers": {
    "htmw": {
      "command": "node",
      "args": [
        "/absolute/path/to/htmw-mcp/dist/index.js"
      ],
      "env": {
        "HTMW_USERNAME": "your_username",
        "HTMW_PASSWORD": "your_password"
      }
    }
  }
}
```

## Tools Available

1. **`get_portfolio`**
   - Returns current account summary (Value, Cash, Buying Power) and open positions.

2. **`search_symbol`**
   - Search for a stock symbol (e.g., "AAPL") to get its exchange and type.

3. **`get_quote`**
   - Get the current price (last, bid, ask) for a symbol.

4. **`execute_trade`**
   - Place an order.
   - Parameters:
     - `symbol` (e.g., "AAPL")
     - `action` ("buy" or "sell")
     - `quantity` (number of shares)
     - `orderType` ("market", "limit", "stop", etc.)
     - `limitPrice` / `stopPrice` (optional)

5. **`get_contest_rankings`**
   - Get top 5 and bottom 5 players in the active contest, plus your own ranking.

## Troubleshooting

- **Login Failed**: Ensure your username/password are correct. The server handles session cookies (including ASP.NET specific `HTMWLOG` and `__HTMW` cookies).
- **Session Expiry**: The server automatically attempts to re-authenticate if a session expires.
- **Quote Errors**: The `get_quote` endpoint may fail for some security types. Trade execution will proceed with a warning even if pre-trade quote validation fails (orders are validated by the server upon submission).

## License

MIT
