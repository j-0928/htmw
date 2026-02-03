
import type { ApiClient } from '../api.js';
import type { Portfolio, Position } from '../types.js';
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

    // 2. Fetch Positions via AJAX
    const positions: Position[] = [];

    if (accountId && portfolioId) {
        try {
            // Try openpositionsbysecuritytype first (seems more robust in some parts of HTMW)
            // It requires a hash which we can scrape from the page
            const hashMatch = html.match(/hash\s*:\s*['"]([^'"]+)['"]/);
            const hash = hashMatch ? hashMatch[1] : 'ldwqlZhVssbrTxxvcZ32D6mpzBkQB9ofsawz5f8JveZbRNETguepDg==';

            const query = new URLSearchParams();
            query.append('pageIndex', '0');
            query.append('pageSize', '20');
            query.append('securityType', 'Equities');
            query.append('sortField', 'CreateDate');
            query.append('sortDirection', 'DESC');
            query.append('hash', hash);

            console.log(`[DEBUG] getPortfolio using openpositionsbysecuritytype. Hash: ${hash}`);

            const response = await api.get(`/accounting/openpositionsbysecuritytype?${query.toString()}`, {
                'Referer': 'https://app.howthemarketworks.com/accounting/openpositions',
                'X-Requested-With': 'XMLHttpRequest'
            });

            const text = await response.text();
            let json: any;
            try {
                json = JSON.parse(text);
            } catch (e) {
                console.error(`Failed to parse JSON from openpositionsbysecuritytype. Status: ${response.status}. Body: ${text.substring(0, 500)}`);
            }

            let positionsHtml = '';
            if (json && json.Html) {
                positionsHtml = json.Html;
            } else {
                console.warn('openpositionsbysecuritytype failed, trying gettrimmedopenpositions as POST...');
                const formData = new URLSearchParams();
                formData.append('pageIndex', '0');
                formData.append('pageSize', '20');
                formData.append('accountID', String(accountId));
                formData.append('portfolioID', String(portfolioId));
                formData.append('securityType', 'Equities');
                formData.append('sortField', 'CreateDate');
                formData.append('sortDirection', 'DESC');

                const postResponse = await api.post('/accounting/gettrimmedopenpositions', formData, {
                    'Referer': 'https://app.howthemarketworks.com/accounting/openpositions',
                    'X-Requested-With': 'XMLHttpRequest'
                });
                const postText = await postResponse.text();
                try {
                    const postJson = JSON.parse(postText);
                    if (postJson && postJson.Html) {
                        positionsHtml = postJson.Html;
                    }
                } catch (e) { }
            }

            if (positionsHtml) {
                const $p = cheerio.load(`<table><tbody class="openpositions-data">${positionsHtml}</tbody></table>`);

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
                        // Get the name. It's usually after the first <a> but before icons.
                        // Or just use the title if we can find it.
                        // Actually, cell 0 has the symbol and partial name. 
                        // Let's just use the symbol for now, it's the most important.
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
            }

        } catch (e) {
            console.error('Failed to fetch AJAX positions:', e);
        }
    }

    return {
        portfolioValue,
        cashBalance,
        buyingPower,
        positions,
    };
}
