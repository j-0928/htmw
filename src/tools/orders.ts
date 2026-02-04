
import type { ApiClient } from '../api.js';
import { logInfo, logDebug, logError } from '../logger.js';
import * as cheerio from 'cheerio';

export interface OpenOrder {
    orderId: string;
    symbol: string;
    action: string;
    quantity: number;
    orderType: string;
    price?: number;
    status: string;
    date: string;
}

/**
 * Get list of currently open trading orders (with full pagination)
 */
export async function getOpenOrders(api: ApiClient): Promise<OpenOrder[]> {
    const $ = await api.getHtml('/trading/orderhistory');
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

    const now = new Date();
    now.setDate(now.getDate() + 1);
    const past = new Date('2000-01-01');

    const formatDate = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

    const PAGE_SIZE = 100;
    let pageIndex = 0;
    const allOrders: OpenOrder[] = [];

    logDebug('ORDERS', 'Starting paginated order fetch');

    while (true) {
        const formData = new URLSearchParams();
        if (accountId) formData.append('accountID', String(accountId));
        if (tournamentId) formData.append('tournamentID', String(tournamentId));
        if (token) formData.append('__RequestVerificationToken', String(token));

        formData.append('pageIndex', String(pageIndex));
        formData.append('pageSize', String(PAGE_SIZE));
        formData.append('sortField', 'CreateDate');
        formData.append('sortDirection', 'DESC');
        formData.append('status', '');
        formData.append('startDate', formatDate(past));
        formData.append('endDate', formatDate(now));

        try {
            const response = await api.post('/trading/getorderlist', formData, {
                'Referer': 'https://app.howthemarketworks.com/trading/orderhistory',
                'X-Requested-With': 'XMLHttpRequest'
            });

            const json = await response.json() as any;
            if (!json || !json.Html) {
                logDebug('ORDERS', `Page ${pageIndex} returned no HTML, ending pagination`);
                break;
            }

            const pageOrders = parseOrdersFromHtml(json.Html);
            allOrders.push(...pageOrders);

            logDebug('ORDERS', `Page ${pageIndex}: found ${pageOrders.length} orders (total: ${allOrders.length})`);

            // If we got fewer than PAGE_SIZE, we've reached the end
            if (pageOrders.length < PAGE_SIZE) break;

            pageIndex++;
        } catch (e) {
            logError('ORDERS', `Failed to fetch order page ${pageIndex}`, e);
            break;
        }
    }

    // Filter to only open orders
    const openOrders = allOrders.filter(o => o.status === 'Open' || o.status.includes('Open'));
    logInfo('ORDERS', `Fetched ${openOrders.length} open orders across ${pageIndex + 1} pages`);

    return openOrders;
}

/**
 * Parse orders from the HTML fragment returned by the API
 */
function parseOrdersFromHtml(htmlFragment: string): OpenOrder[] {
    const $orders = cheerio.load(`<table><tbody>${htmlFragment}</tbody></table>`);
    const orders: OpenOrder[] = [];

    $orders('tr').each((_, row) => {
        const cells = $orders(row).find('td');
        if (cells.length >= 10) {
            const date = $orders(cells[0]).text().trim();
            const orderStr = $orders(cells[1]).text().trim();
            const symbol = $orders(cells[2]).text().trim();
            const quantityStr = $orders(cells[3]).text().trim().replace(/,/g, '');
            const priceText = $orders(cells[4]).text().trim().replace(/[$,]/g, '');

            const action = orderStr.split('-')[1]?.trim() || '';
            const orderType = orderStr.split('-')[0]?.trim() || '';
            const quantity = parseFloat(quantityStr);
            const price = parseFloat(priceText);

            let orderId = '';
            let status = '';

            const cancelBtn = $orders(cells[9]).find('.btn-cancel-order');
            if (cancelBtn.length > 0) {
                status = 'Open';
                orderId = cancelBtn.attr('data-order-conf') || '';
            } else {
                status = $orders(cells[9]).text().trim();
                const notesBtn = $orders(cells[10]).find('a[data-order-conf]');
                if (notesBtn.length > 0) orderId = notesBtn.attr('data-order-conf') || '';
            }

            if (!orderId) orderId = $orders(cells[8]).text().trim();

            if (orderId) {
                orders.push({ orderId, symbol, action, quantity, orderType, price: isNaN(price) ? 0 : price, status, date });
            }
        }
    });

    return orders;
}

/**
 * Cancel a pending trading order
 */
export async function cancelOrder(api: ApiClient, orderId: string): Promise<{ success: boolean; message: string }> {
    const $ = await api.getHtml('/trading/orderhistory');
    const html = $.html();

    let accountId = $('input[name="AccountID"]').val() || $('section.summary').attr('data-accountid');
    if (!accountId) {
        const match = html.match(/var\s+accountID\s*=\s*['"]?(\d+)['"]?/i) || html.match(/AccountID\s*:\s*['"]?(\d+)['"]?/i);
        if (match) accountId = match[1];
    }

    const token = $('input[name="__RequestVerificationToken"]').val();

    if (!accountId) return { success: false, message: 'Failed to scrape AccountID' };

    const formData = new URLSearchParams();
    formData.append('accountID', String(accountId));
    formData.append('orderConf', orderId);
    if (token) formData.append('__RequestVerificationToken', String(token));

    const response = await api.post('/trading/cancelorder', formData);

    if (response.ok) {
        return { success: true, message: 'Order cancellation submitted.' };
    } else {
        const errorText = await response.text();
        return { success: false, message: `Failed: ${response.status}. ${errorText.substring(0, 100)}` };
    }
}
