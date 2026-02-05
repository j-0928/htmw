
import type { ApiClient } from '../api.js';
import type { Transaction } from '../types.js';
import { logInfo, logDebug, logError } from '../logger.js';
import * as cheerio from 'cheerio';

/**
 * Get transaction history with pagination
 * @param api ApiClient instance
 * @param days Number of days to look back (default: 30)
 */
export async function getTransactionHistory(api: ApiClient, days: number = 30): Promise<Transaction[]> {
    const $ = await api.getHtml('/accounting/transactionhistory');
    const html = $.html();

    let accountId = $('input[name="AccountID"]').val() || $('section.summary').attr('data-accountid');
    if (!accountId) {
        const match = html.match(/var\s+accountID\s*=\s*['"]?(\d+)['"]?/i) || html.match(/AccountID\s*:\s*['"]?(\d+)['"]?/i);
        if (match) accountId = match[1];
    }

    let tournamentId = $('input[name="TournamentID"]').val() || $('#ddlTournaments').val();
    if (!tournamentId) {
        const match = html.match(/var\s+tournamentID\s*=\s*['"]?(\d+)['"]?/i) || html.match(/TournamentID\s*:\s*['"]?(\d+)['"]?/i);
        if (match) tournamentId = match[1];
    }

    const token = $('input[name="__RequestVerificationToken"]').val();

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const formatDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

    const PAGE_SIZE = 100;
    let pageIndex = 0;
    const allTransactions: Transaction[] = [];

    logDebug('TRANSACTIONS', `Starting paginated transaction fetch for past ${days} days`);

    while (true) {
        const query = new URLSearchParams();
        if (accountId) query.append('accountID', String(accountId));
        // Transaction history page doesn't seem to require tournamentID in the GET param based on JS, 
        // but let's include it if it was there contextually, or stick to what the JS does.
        // JS uses: pageIndex, pageSize, startDate, endDate, sortField, sortDirection, accountID, transactionType.

        query.append('pageIndex', String(pageIndex));
        query.append('pageSize', String(PAGE_SIZE));
        query.append('startDate', formatDate(startDate));
        query.append('endDate', formatDate(endDate));
        query.append('transactionType', 'All');
        query.append('sortField', 'CreateDate');
        query.append('sortDirection', 'DESC');

        try {
            // Found via debug inspection: $.get('/accounting/gettransactions', data, ...)
            const response = await api.get(`/accounting/gettransactions?${query.toString()}`, {
                'Referer': 'https://app.howthemarketworks.com/accounting/transactionhistory',
                'X-Requested-With': 'XMLHttpRequest'
            });

            const json = await response.json() as any;
            if (!json || !json.Html) {
                logDebug('TRANSACTIONS', `Page ${pageIndex} returned no HTML, ending pagination`);
                break;
            }

            const pageTransactions = parseTransactionsFromHtml(json.Html);
            allTransactions.push(...pageTransactions);

            logDebug('TRANSACTIONS', `Page ${pageIndex}: found ${pageTransactions.length} transactions (total: ${allTransactions.length})`);

            if (pageTransactions.length < PAGE_SIZE) break;

            pageIndex++;
        } catch (e) {
            logError('TRANSACTIONS', `Failed to fetch transaction page ${pageIndex}`, e);
            break;
        }
    }

    logInfo('TRANSACTIONS', `Fetched ${allTransactions.length} transactions across ${pageIndex + 1} pages`);
    return allTransactions;
}

function parseTransactionsFromHtml(htmlFragment: string): Transaction[] {
    const $ = cheerio.load(`<table><tbody>${htmlFragment}</tbody></table>`);
    const transactions: Transaction[] = [];

    $('tr').each((_, row) => {
        const cells = $(row).find('td');
        // Column mapping:
        // [0] Icon
        // [1] Date
        // [2] Type / Description (e.g. "Market - Buy", "Market - Sell")
        // [3] Quantity
        // [4] Symbol
        // [5] Price
        // [6] Amount
        // [7] Notes button

        if (cells.length >= 7) {
            const date = $(cells[1]).text().trim();
            const typeRaw = $(cells[2]).text().trim();
            const quantityText = $(cells[3]).text().trim().replace(/,/g, '');
            const symbol = $(cells[4]).text().trim();
            const priceText = $(cells[5]).text().trim().replace(/[$,]/g, '');
            const amountText = $(cells[6]).text().trim().replace(/[$,]/g, '');

            const quantity = parseFloat(quantityText) || 0;
            const price = parseFloat(priceText) || 0;
            const amount = parseFloat(amountText) || 0;

            let action = '';
            const lowerType = typeRaw.toLowerCase();
            if (lowerType.includes('buy')) action = 'Buy';
            else if (lowerType.includes('sell')) action = 'Sell';
            else if (lowerType.includes('short')) action = 'Short';
            else if (lowerType.includes('cover')) action = 'Cover';
            else if (lowerType.includes('div')) action = 'Dividend';

            // If we have data, add it
            transactions.push({
                date,
                transactionType: typeRaw,
                symbol,
                action,
                quantity,
                price,
                amount,
                commission: 0,
                description: typeRaw
            });
        }
    });

    return transactions;
}
