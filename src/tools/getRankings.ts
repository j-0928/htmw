// Get contest rankings and account info

import type { ApiClient } from '../api.js';
import type { ContestRankings, RankingEntry } from '../types.js';
import { logInfo, logWarn, logError, logDebug } from '../logger.js';
import * as cheerio from 'cheerio';

interface RankingsApiResponse {
    Data: Array<{
        Rank: number;
        Username: string;
        PortfolioValue: number;
        PercentGain: number;
        DisplayName?: string;
    }>;
    TotalCount: number;
}

interface TournamentInfo {
    TournamentID: string;
    TournamentName: string;
    IsActive: boolean;
}

export async function discoverTournaments(api: ApiClient): Promise<TournamentInfo[]> {
    const tournaments: TournamentInfo[] = [];

    // Method 1: Check cookies for TournamentID
    try {
        const cookieString = await api.auth.getCookieString();
        const htmwCookie = cookieString.match(/__HTMW=([^;]+)/);
        if (htmwCookie) {
            const tournamentMatch = htmwCookie[1].match(/TournamentID=([^&]+)/);
            if (tournamentMatch) {
                tournaments.push({
                    TournamentID: decodeURIComponent(tournamentMatch[1]),
                    TournamentName: 'Current Contest (from Cookie)',
                    IsActive: true,
                });
            }
        }
    } catch (e) {
        console.warn('Error reading cookies for tournament:', e);
    }

    // Method 2: Page scraping (fallback)
    try {
        const $ = await api.getHtml('/accounting/rankings');
        $('select[name*="tournament"], #tournamentSelect, [data-tournament-id]').find('option, [data-tournament-id]').each((_, el) => {
            const $el = $(el);
            const id = $el.val()?.toString() || $el.attr('data-tournament-id');
            const name = $el.text().trim() || $el.attr('data-tournament-name') || 'Unknown Contest';

            if (id && !tournaments.find(t => t.TournamentID === id)) {
                tournaments.push({
                    TournamentID: id,
                    TournamentName: name,
                    IsActive: true,
                });
            }
        });

        // Method 3: Embedded JSON in scripts
        $('script').each((_, el) => {
            const content = $(el).html() || '';
            const match = content.match(/tournamentID["\s:]+["']([^"']+)["']/i);
            if (match && !tournaments.find(t => t.TournamentID === match[1])) {
                tournaments.push({
                    TournamentID: match[1],
                    TournamentName: 'Current Contest (Script)',
                    IsActive: true,
                });
            }
        });
    } catch (e) {
        console.warn('Error scraping tournaments:', e);
    }

    return tournaments;
}

export async function getRankings(
    api: ApiClient,
    tournamentId?: string,
    rankingType: 'Overall' | 'Weekly' | 'Monthly' = 'Overall'
): Promise<ContestRankings> {
    // Priority 1: Hardcoded environment variable
    // Priority 2: Provided tournamentId parameter
    // Priority 3: Discovered from cookies/scraping
    let actualTournamentId = process.env.HTMW_TOURNAMENT_ID || tournamentId;
    let contestName = 'Unknown Contest';

    logDebug('RANKINGS', `Initial tournament ID: ${actualTournamentId || 'none'}`);

    // Only discover if we don't have an ID yet
    if (!actualTournamentId) {
        logInfo('RANKINGS', 'No tournament ID provided, discovering...');
        const tournaments = await discoverTournaments(api);
        if (tournaments.length > 0) {
            const tournament = tournaments.find(t => t.IsActive) || tournaments[0];
            actualTournamentId = tournament.TournamentID;
            logInfo('RANKINGS', `Discovered tournament: ${tournament.TournamentName} (${actualTournamentId})`);
        }
    }

    if (actualTournamentId) {
        // Try to find name from discovery (optional, for display purposes)
        try {
            const tournaments = await discoverTournaments(api);
            const found = tournaments.find(t => t.TournamentID === actualTournamentId);
            if (found) {
                contestName = found.TournamentName;
            }
        } catch (e) {
            logWarn('RANKINGS', 'Could not discover tournament name, using ID', e);
        }
    }

    if (!actualTournamentId) {
        logError('RANKINGS', 'No tournament ID available from any source');
        throw new Error('No active tournament found. Please set HTMW_TOURNAMENT_ID or provide a tournamentId.');
    }

    logInfo('RANKINGS', `Using tournament ID: ${actualTournamentId}`);

    // Get current date for the API
    const today = new Date();
    const dateStr = `${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getDate().toString().padStart(2, '0')}/${today.getFullYear()}`;

    // Fetch rankings
    const path = `/accounting/getrankings?pageIndex=0&pageSize=100&tournamentID=${encodeURIComponent(actualTournamentId)}&rankingType=${rankingType}&date=${dateStr}`;

    const response = await api.get(path);
    // The API returns HTML in a JSON property named 'Html' (or Data if standard, but logs showed Html)
    // We try to interpret whatever we get.
    const responseData = await response.json() as any;

    // Debug log
    // console.log('Rankings API Response Keys:', Object.keys(responseData));

    const allRankings: RankingEntry[] = [];
    let totalParticipants = 0;

    // Handle HTML embedded in JSON (Scenario observed in logs)
    if (responseData.Html) {
        const $ = cheerio.load(responseData.Html);
        $('tr').each((_, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 4) {
                // Determine rank (first cell)
                const rankText = $(cells[0]).text().trim();
                const rank = parseInt(rankText, 10);

                // Username is usually in 3rd cell (index 2) - "JerryYong"
                // But avatar might comprise a cell.
                // Log: Cell 0: Rank, Cell 1: Avatar, Cell 2: Name, Cell 3: Value
                const username = $(cells[2]).text().trim();
                const valueText = $(cells[3]).text().trim().replace(/[$,]/g, '');
                const portfolioValue = parseFloat(valueText);

                // Gain % is in cell 5 div data-percentage
                const percentText = $(cells[5]).find('.percent').text().trim().replace('%', '');
                const percentGain = parseFloat(percentText);

                if (!isNaN(rank)) {
                    allRankings.push({
                        rank,
                        username,
                        portfolioValue: isNaN(portfolioValue) ? 0 : portfolioValue,
                        percentGain: isNaN(percentGain) ? 0 : percentGain
                    });
                }
            }
        });
        totalParticipants = responseData.TotalCount || 0;
    }
    // Handle standard data array (Fallback)
    else if (responseData.Data && Array.isArray(responseData.Data)) {
        allRankings.push(...responseData.Data.map((entry: any) => ({
            rank: entry.Rank,
            username: entry.DisplayName || entry.Username,
            portfolioValue: entry.PortfolioValue,
            percentGain: entry.PercentGain,
        })));
        totalParticipants = responseData.TotalCount || 0;
    } else {
        console.warn('Rankings data missing or malformed:', Object.keys(responseData));
    }

    // Sort by rank to ensure proper order
    allRankings.sort((a, b) => a.rank - b.rank);

    // Get top 5 and bottom 5
    const topRankings = allRankings.slice(0, 5);
    const bottomRankings = allRankings.length > 5
        ? allRankings.slice(-5).reverse()
        : [];

    // Try to find user's own ranking
    // The username should match the logged-in user
    const targetUsername = (process.env.HTMW_USERNAME || 'jerry').toLowerCase();
    const userRanking = allRankings.find(r =>
        r.username.toLowerCase().includes(targetUsername)
    );

    return {
        contestName,
        tournamentId: actualTournamentId,
        rankingType,
        userRank: userRanking?.rank,
        userPercentGain: userRanking?.percentGain,
        topRankings,
        bottomRankings,
        totalParticipants: totalParticipants || allRankings.length,
    };
}
