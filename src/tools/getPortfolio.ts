
import type { ApiClient } from '../api.js';
import type { Portfolio, Position, PortfolioOrder } from '../types.js';
import { getOpenOrders, type OpenOrder } from './orders.js';
import { logInfo, logWarn, logError, logDebug, createTimer } from '../logger.js';
import * as cheerio from 'cheerio';

export async function getPortfolio(api: ApiClient): Promise<Portfolio> {
    // 1. Get Context (AccountID, PortfolioID) from Page
    const $ = await api.getHtml('/accounting/openpositions');

    // Scrape AccountID
    let accountId = $('section.summary').attr('data-accountid') || $('input[name="AccountID"]').val();
    const html = $.html();

    if (!accountId) {
        const match = html.match(/var\s+accountID\s*=\s*['"]?(\d+)['"]?/i) || html.match(/AccountID\s*:\s*['"]?(\d+)['"]?/i);
        if (match) accountId = match[1];
    }

    // Scrape TournamentID (usually in ddlTournaments or hidden input)
    let tournamentId = $('#ddlTournaments option:selected').val() || $('input[name="TournamentID"]').val();
    if (!tournamentId) {
        const match = html.match(/var\s+tournamentID\s*=\s*['"]?(\d+)['"]?/i) || html.match(/TournamentID\s*:\s*['"]?(\d+)['"]?/i);
        if (match) tournamentId = match[1];
    }

    // Scrape CSRF Token
    const token = $('input[name="__RequestVerificationToken"]').val();

    // Scrape PortfolioID from script: var portfolioID = 50013696;
    const portfolioMatch = html.match(/var\s+portfolioID\s*=\s*(\d+);/i);
    const portfolioId = portfolioMatch ? portfolioMatch[1] : '';

    if (!portfolioId) {
        console.warn('Could not find PortfolioID in page script. Attempting to proceed without it (may fail).');
    }

    // Parse Headers for Summary
    let portfolioValue = 0;
    let cashBalance = 0;
    let buyingPower = 0;
    const parseNumber = (text: string): number => {
        const match = text.replace(/[,$]/g, '').match(/[\d.]+/);
        return match ? parseFloat(match[0]) : 0;
    };

    const pvText = $('#portfolioValue').text();
    const cbText = $('#cashBalance').text();
    const bpText = $('#buyingPower').text();

    if (pvText) portfolioValue = parseNumber(pvText);
    if (cbText) cashBalance = parseNumber(cbText);
    if (bpText) buyingPower = parseNumber(bpText);

    // 2. Fetch Positions via AJAX (with pagination)
    const positions: Position[] = [];

    if (accountId && portfolioId) {
        const hashMatch = html.match(/hash\s*:\s*['"]([^'"]+)['"]/);
        const hash = hashMatch ? hashMatch[1] : 'ldwqlZhVssbrTxxvcZ32D6mpzBkQB9ofsawz5f8JveZbRNETguepDg==';

        const PAGE_SIZE = 50;
        let pageIndex = 0;

        logDebug('PORTFOLIO', `Starting paginated position fetch. Hash: ${hash}`);

        while (true) {
            try {
                const query = new URLSearchParams();
                query.append('pageIndex', String(pageIndex));
                query.append('pageSize', String(PAGE_SIZE));
                query.append('securityType', 'Equities');
                query.append('sortField', 'CreateDate');
                query.append('sortDirection', 'DESC');
                query.append('hash', hash);

                const response = await api.get(`/accounting/openpositionsbysecuritytype?${query.toString()}`, {
                    'Referer': 'https://app.howthemarketworks.com/accounting/openpositions',
                    'X-Requested-With': 'XMLHttpRequest'
                });

                const text = await response.text();
                let json: any;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    logError('PORTFOLIO', `Failed to parse JSON from page ${pageIndex}. Status: ${response.status}`, text.substring(0, 200));
                    break;
                }

                if (!json || !json.Html) {
                    logDebug('PORTFOLIO', `Page ${pageIndex} returned no HTML, ending pagination`);
                    break;
                }

                const pagePositions = parsePositionsFromHtml(json.Html);
                positions.push(...pagePositions);

                logDebug('PORTFOLIO', `Page ${pageIndex}: found ${pagePositions.length} positions (total: ${positions.length})`);

                // If we got fewer than PAGE_SIZE, we've reached the end
                if (pagePositions.length < PAGE_SIZE) break;

                pageIndex++;
            } catch (e) {
                logError('PORTFOLIO', `Failed to fetch position page ${pageIndex}`, e);
                break;
            }
        }

        logInfo('PORTFOLIO', `Fetched ${positions.length} positions across ${pageIndex + 1} pages`);
    }

    // Fetch and classify open orders
    let openOrders: PortfolioOrder[] = [];
    try {
        logDebug('PORTFOLIO', 'Fetching open orders');
        const rawOrders = await getOpenOrders(api);
        openOrders = rawOrders.map(order => ({
            ...order,
            classification: classifyOrder(order, positions),
        }));
        logInfo('PORTFOLIO', `Found ${openOrders.length} open orders`);
    } catch (e) {
        logWarn('PORTFOLIO', 'Failed to fetch open orders, returning empty array', e);
    }

    return {
        portfolioValue,
        cashBalance,
        buyingPower,
        positions,
        openOrders,
    };
}

/**
 * Classify an order based on its type, action, and existing positions
 */
function classifyOrder(order: OpenOrder, positions: Position[]): PortfolioOrder['classification'] {
    const pos = positions.find(p => p.symbol.toUpperCase() === order.symbol.toUpperCase());
    const orderTypeLower = order.orderType.toLowerCase();
    const actionLower = order.action.toLowerCase();

    // Stop orders are typically stop-losses
    if (orderTypeLower.includes('stop')) {
        return pos ? 'stop-loss' : 'other';
    }

    // Sell orders above avg cost are profit-taking
    if (actionLower === 'sell' && pos && order.price && order.price > pos.avgCost) {
        return 'profit-taking';
    }

    // Standard classifications
    if (actionLower === 'buy') return 'buy';
    if (actionLower === 'sell') return 'sell';

    return 'other';
}

/**
 * Parse positions from the HTML fragment returned by the API
 */
function parsePositionsFromHtml(htmlFragment: string): Position[] {
    const $p = cheerio.load(`<table><tbody class="openpositions-data">${htmlFragment}</tbody></table>`);
    const positions: Position[] = [];

    $p('tr').each((_, row) => {
        const cells = $p(row).find('td');
        if (cells.length >= 8) {
            // HTMW layout for Equities rows:
            // 0: Symbol (inside <a>)
            // 1: Icons
            // 2: Quantity
            // 3: Avg Price
            // 4: Last Price
            // 5: Day Change
            // 6: Market Value
            // 7: Total Gain/Loss (nested structure)

            const symbol = $p(cells[0]).find('a').first().text().trim();
            const name = $p(cells[0]).text().replace(symbol, '').trim();

            const shares = parseFloat($p(cells[2]).text().replace(/,/g, ''));
            const avgCost = parseFloat($p(cells[3]).text().replace(/[$,]/g, ''));
            const currentPrice = parseFloat($p(cells[4]).text().replace(/[$,]/g, ''));
            const marketValue = parseFloat($p(cells[6]).text().replace(/[$,]/g, ''));

            const gainLossValText = $p(cells[7]).find('span').text().trim();
            const gainLossPercentText = $p(cells[7]).find('small').text().trim();

            const gainLoss = parseFloat(gainLossValText.replace(/,/g, ''));
            const gainLossPercent = parseFloat(gainLossPercentText.replace(/[()%,]/g, ''));

            if (symbol && !isNaN(shares)) {
                positions.push({ symbol, name, shares, avgCost, currentPrice, marketValue, gainLoss, gainLossPercent });
            }
        }
    });

    return positions;
}
