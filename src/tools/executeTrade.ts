
import type { ApiClient } from '../api.js';
import { getQuote } from './lookup.js';
import * as cheerio from 'cheerio';

export interface TradeParams {
    symbol: string;
    action: 'buy' | 'sell' | 'short' | 'cover';
    quantity: number;
    orderType: 'market' | 'limit' | 'stop';
    limitPrice?: number;
    stopPrice?: number;
    duration?: 'day' | 'gtc';
}

/**
 * Execute a buy or sell trade
 */
export async function executeTrade(api: ApiClient, params: TradeParams): Promise<{ success: boolean; message: string; orderId?: string }> {
    const { symbol, action, quantity, orderType, limitPrice, stopPrice, duration } = params;

    // 1. Get Context (AccountID, TournamentID) and Market Status from Trading Page
    const $ = await api.getHtml('/trading/equities');

    let accountId = $('.summary').attr('data-accountid') || $('.summary').attr('data-accountId') || $('input[name="AccountID"]').val() || $('input[name="Accountid"]').val();
    let tournamentId = $('#ddlTournaments').val() || $('input[name="TournamentID"]').val() || $('input[name="Tournamentid"]').val();
    const isMarketOpenScraped = $('input[name="IsMarketOpen"]').val() || 'False';
    const requestVerificationToken = $('input[name="__RequestVerificationToken"]').val();

    // Fallback if not found correctly
    if (!accountId || !tournamentId || accountId === '0' || tournamentId === '0') {
        const rankings = await api.getHtml('/accounting/rankings');
        tournamentId = (tournamentId && tournamentId !== '0') ? tournamentId : (rankings('#TournamentID').val() || rankings('select[name*="tournament"]').val());
        accountId = (accountId && accountId !== '0') ? accountId : (rankings('.summary').attr('data-accountid') || rankings('.summary').attr('data-accountId') || rankings('input[name="AccountID"]').val());
    }

    if (!accountId || !tournamentId || accountId === '0' || tournamentId === '0') {
        throw new Error(`Could not find valid AccountID (${accountId}) or TournamentID (${tournamentId}) on trading page`);
    }

    // 2. Get current price context
    let lastPrice = 0;
    try {
        const quote = await getQuote(api, symbol);
        lastPrice = quote.lastPrice;
    } catch (e) {
        console.warn('Quote failed during trade setup, proceeding:', e);
    }

    // 3. Construct Payload mapping
    const sideMap: Record<string, string> = {
        buy: '1',
        sell: '2',
        short: '3',
        cover: '4',
    };

    const typeMap: Record<string, string> = {
        market: '1',
        limit: '2',
        stop: '3',
    };

    let submitPrice = lastPrice;
    if (orderType === 'limit') {
        submitPrice = limitPrice || lastPrice;
    } else if (orderType === 'stop') {
        submitPrice = stopPrice || lastPrice;
    }

    const payload = new URLSearchParams();
    payload.set('TournamentID', String(tournamentId));
    payload.set('AccountID', String(accountId));
    payload.set('OrderSide', sideMap[action]);
    payload.set('Symbol', symbol.toUpperCase());
    payload.set('Quantity', quantity.toString());
    payload.set('OrderType', typeMap[orderType]);
    payload.set('Price', submitPrice.toFixed(2));
    payload.set('OrderExpiration', duration === 'gtc' ? '2' : '1');
    payload.set('Exchange', 'US');
    payload.set('SecurityType', 'Equities');
    payload.set('IsMarketOpen', isMarketOpenScraped as string);
    payload.set('QuantityType', 'Amount');
    payload.set('Currency', '9'); // 9 is usually USD Context in HTMW

    // ASP.NET hidden fields
    payload.set('hidOrderSide', sideMap[action]);
    payload.set('hidOrderType', orderType === 'market' ? '1' : '0');
    payload.set('hidExchange', 'US');
    payload.set('hidTournamentID', String(tournamentId));
    payload.set('hidAccountID', String(accountId));

    if (requestVerificationToken) {
        payload.set('__RequestVerificationToken', String(requestVerificationToken));
    }

    // 4. Send preview request
    const previewResponse = await api.post('/trading/previeworderv2', payload, {
        'Referer': 'https://app.howthemarketworks.com/trading/equities',
        'X-Requested-With': 'XMLHttpRequest'
    });

    if (!previewResponse.ok) {
        const text = await previewResponse.text();
        throw new Error(`Order preview failed (${previewResponse.status}): ${text.substring(0, 100)}`);
    }

    const previewData = await previewResponse.json() as any;
    if (!previewData.Success) {
        throw new Error(previewData.ErrorMessage || 'Preview failed');
    }

    // 5. Send place order request
    const placeResponse = await api.post('/trading/placeorderv2', payload, {
        'Referer': 'https://app.howthemarketworks.com/trading/equities',
        'X-Requested-With': 'XMLHttpRequest'
    });

    if (!placeResponse.ok) {
        const text = await placeResponse.text();
        return { success: false, message: `Order placement failed (${placeResponse.status}): ${text.substring(0, 100)}` };
    }

    const placeData = await placeResponse.json() as any;

    // 6. Handle response
    if (placeData.Success) {
        const $success = cheerio.load(placeData.TradeButtonsHtml || '');
        const successMsg = $success('.alert-box.success, .callout.success').text().trim() || 'Order placed successfully';

        return {
            success: true,
            message: successMsg,
            orderId: placeData.OrderConf || undefined,
        };
    } else {
        return {
            success: false,
            message: placeData.ErrorMessage || 'Trade failed',
        };
    }
}
