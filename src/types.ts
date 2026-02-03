// Type definitions for HTMW MCP Server

export interface Config {
    username: string;
    password: string;
    baseUrl: string;
}

export interface Position {
    symbol: string;
    name: string;
    shares: number;
    avgCost: number;
    currentPrice: number;
    marketValue: number;
    gainLoss: number;
    gainLossPercent: number;
}

export interface Portfolio {
    portfolioValue: number;
    cashBalance: number;
    buyingPower: number;
    positions: Position[];
}

export interface Quote {
    symbol: string;
    name: string;
    lastPrice: number;
    change: number;
    changePercent: number;
    bid: number;
    ask: number;
    volume: number;
}

export interface OrderRequest {
    symbol: string;
    action: 'buy' | 'sell';
    quantity: number;
    orderType: 'market' | 'limit' | 'stop' | 'trailing_stop_dollar' | 'trailing_stop_percent';
    limitPrice?: number;
    stopPrice?: number;
    trailingAmount?: number;
}

export interface OrderResult {
    success: boolean;
    orderId?: string;
    message: string;
    filledPrice?: number;
    filledQuantity?: number;
}

export interface RankingEntry {
    rank: number;
    username: string;
    portfolioValue: number;
    percentGain: number;
}

export interface ContestRankings {
    contestName: string;
    tournamentId: string;
    rankingType: 'Overall' | 'Weekly' | 'Monthly';
    userRank?: number;
    userPercentGain?: number;
    topRankings: RankingEntry[];
    bottomRankings: RankingEntry[];
    totalParticipants: number;
}

export interface SymbolSearchResult {
    symbol: string;
    name: string;
    exchange: string;
    securityType: string;
}
